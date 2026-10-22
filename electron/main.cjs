const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, screen, shell } = require("electron");
const { createCatalogStorage } = require("./catalog-storage.cjs");
const { applyReferenceChange, referenceEntry, validateReferenceLinks } = require("./catalog-references.cjs");
const { restoreWindowState, trackWindowState } = require("./window-state.cjs");
const { resolveDroppedPaths } = require("./drop-paths.cjs");
const { isMaterialArea } = require("./material-areas.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  IMAGE_EXTENSIONS,
  copyFilesToArea,
  moveFilesToDirectory,
  copyFilesToInbox,
  describePaths,
  descriptorForFile,
  ensureLibraryStructure,
  organizeFile,
  renameFile,
  organizeFiles,
  scanLibrary,
  trashFiles,
} = require("./library.cjs");

// Review builds run against an isolated profile and never open installed metadata.
if (process.env.YU_PREVIEW_USER_DATA) {
  if (!path.isAbsolute(process.env.YU_PREVIEW_USER_DATA)) throw new Error("YU_PREVIEW_USER_DATA must be absolute");
  fs.mkdirSync(process.env.YU_PREVIEW_USER_DATA, { recursive: true });
  app.setPath("userData", path.resolve(process.env.YU_PREVIEW_USER_DATA));
}

protocol.registerSchemesAsPrivileged([{
  scheme: "yu-asset",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

let mainWindow;
let catalogStorage;
const { watchLibrary } = require("./watch-library.cjs");
const libraryWatchers = new Map();
function sendLibraryEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function isCatalogData(target) {
  return catalogStorage?.excludedDirectories.some(directory => {
    const relative = path.relative(directory, target);
    return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }) || false;
}

function scanUserLibrary(rootPath) {
  return scanLibrary(rootPath, { excludePaths: catalogStorage?.excludedDirectories || [] });
}

function ensureWatcher(rootPath) {
  const key = path.resolve(rootPath).toLowerCase();
  if (libraryWatchers.has(key)) return;
  try {
    libraryWatchers.set(key, watchLibrary(rootPath,
      (change) => sendLibraryEvent("library:changed", change),
      () => sendLibraryEvent("library:watch-error", "文件夹监听暂时不可用，请手动刷新素材库"), { shouldIgnore: isCatalogData }));
  } catch { sendLibraryEvent("library:watch-error", "该文件夹不支持自动监听，请手动刷新素材库"); }
}

function referenceRoots() {
  const roots = catalogStorage.catalog.getSetting("referenceRoots");
  return Array.isArray(roots) ? roots : [];
}

function customMaterialAreas() {
  return catalogStorage.catalog.getSetting("customAreas") || [];
}

function addFileReferences(filePaths, area, context = {}) {
  const roots = referenceRoots();
  for (const filePath of filePaths) {
    const directory = path.dirname(filePath);
    let source = roots.find(item => item.kind === "files" && item.path === directory && item.area === area
      && (item.context?.project || '') === (context.project || '') && (item.context?.mode || '') === (context.mode || '') && (item.context?.category || '') === (context.category || ''));
    if (!source) { source = { path: directory, area, kind: "files", paths: [], context }; roots.push(source); }
    source.paths = [...new Set([...(source.paths || []), filePath])];
    source.fileKeys ||= {};
    try { source.fileKeys[filePath] = descriptorForFile(filePath, fs.statSync(filePath), directory).fileKey; } catch {}
    ensureWatcher(directory);
  }
  catalogStorage.catalog.setSetting("referenceRoots", roots);
}

function destinationContext(asset, destination, rootPath, target = {}) {
  const relativePath = path.relative(rootPath || asset.rootPath, destination).split(path.sep).join('/');
  const parts = relativePath.split('/');
  let area = target.area || asset.area;
  let project = asset.context?.project || '';
  let mode = asset.context?.mode || '';
  let category = asset.context?.category || '未分类';
  if (parts[0] === '01_素材' && isMaterialArea(parts[1], customMaterialAreas())) {
    area = parts[1]; project = ''; mode = ''; category = parts[2] || '未分类';
  } else if (parts[0] === '02_项目素材') {
    area = '项目素材'; project = parts[1] || project; mode = parts[2] || '制作素材'; category = parts[3] || '源文件';
  } else if (parts[0] === '00_待整理') {
    area = '待整理'; project = ''; mode = ''; category = '未分类';
  } else if (area === '项目素材') {
    project = target.project || project;
    mode = target.mode || (['参考素材', '制作素材'].includes(parts[0]) ? parts[0] : mode);
    category = target.category || (['参考素材', '制作素材'].includes(parts[0]) ? parts[1] : category) || '源文件';
  } else {
    project = ''; mode = ''; category = target.category || category;
  }
  return { area, context: { ...(asset.context || {}), area, project, mode, category, relativePath, sourceRoot: rootPath || asset.rootPath } };
}

function remapCatalog(moves, options = {}) {
  if (!moves?.length) return;
  const previous = new Map(catalogStorage.catalog.snapshot().assets.map(asset => [path.resolve(asset.fullPath).toLowerCase(), asset]));
  catalogStorage.catalog.remapPaths(moves);
  const updated = new Map();
  for (const move of moves) {
    const asset = previous.get(path.resolve(move.source).toLowerCase());
    if (!asset) continue;
    const classification = destinationContext(asset, move.destination, options.rootPath, options.target);
    if (classification.area !== asset.area) catalogStorage.catalog.updateAssets([asset.id], { area: classification.area });
    try {
      const stat = fs.statSync(move.destination, { bigint: true });
      const entry = descriptorForFile(move.destination, stat, options.rootPath || asset.rootPath);
      catalogStorage.catalog.reconcile([{ ...entry, ...classification, categoryPath: [] }], { complete: false });
    } catch (error) {
      // A subsequent external change must not undo a completed file move.
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
    updated.set(path.resolve(move.source).toLowerCase(), classification);
  }
  const mapping = new Map(moves.map(move => [path.resolve(move.source).toLowerCase(), move.destination]));
  const roots = referenceRoots();
  const relocated = [];
  for (const source of roots) {
    if (source.kind !== "files") continue;
    source.paths = (source.paths || []).filter(filePath => {
      const destination = mapping.get(path.resolve(filePath).toLowerCase());
      if (!destination) return true;
      const classification = updated.get(path.resolve(filePath).toLowerCase());
      relocated.push({ destination, area: classification?.area || source.area, context: classification?.context || source.context || {} });
      if (source.fileKeys) delete source.fileKeys[filePath];
      return false;
    });
  }
  catalogStorage.catalog.setSetting("referenceRoots", roots.filter(source => source.kind !== "files" || source.paths.length));
  for (const { destination, area, context } of relocated) addFileReferences([destination], area, context);
}

function linkedSnapshot(entries) {
  const snapshot = catalogStorage.catalog.snapshot();
  const linkedPaths = new Set(entries.map(entry => path.resolve(entry.fullPath).toLowerCase()));
  return { ...snapshot, linkedAssetIds: snapshot.assets.filter(asset => linkedPaths.has(path.resolve(asset.fullPath).toLowerCase())).map(asset => asset.id) };
}

async function refreshReferences() {
  const catalog = catalogStorage.catalog;
  for (const source of referenceRoots()) {
    if (!source?.path || !(source.area === "项目素材" || isMaterialArea(source.area, customMaterialAreas()))) continue;
    ensureWatcher(source.path);
    if (source.kind === "folder") {
      try {
        const scanned = await scanUserLibrary(source.path);
        catalog.reconcile(scanned.files.map(entry => referenceEntry(entry, source.area, source.context)), { rootPath: source.path, complete: scanned.complete });
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(error.code)) catalog.reconcile([], { rootPath: source.path, complete: true });
        else sendLibraryEvent("library:watch-error", `读取素材引用失败：${error.message}`);
      }
    } else if (source.kind === "files") {
      const entries = [];
      for (const filePath of source.paths || []) {
        try {
          const stat = await fs.promises.stat(filePath, { bigint: true });
          if (stat.isFile()) {
            const entry = referenceEntry(descriptorForFile(filePath, stat, source.path), source.area, source.context);
            entries.push(entry);
            source.fileKeys ||= {};
            source.fileKeys[filePath] = entry.fileKey;
          }
          else catalog.markDeleted([filePath]);
        } catch (error) {
          if (["ENOENT", "ENOTDIR"].includes(error.code)) catalog.markDeleted([filePath]);
          else sendLibraryEvent("library:watch-error", `读取素材引用失败：${error.message}`);
        }
      }
      catalog.reconcile(entries, { rootPath: source.path, complete: false });
      const roots = referenceRoots();
      const saved = roots.find(item => item.kind === 'files' && item.path === source.path && item.area === source.area && JSON.stringify(item.context || {}) === JSON.stringify(source.context || {}));
      if (saved) { saved.fileKeys = source.fileKeys || {}; catalog.setSetting('referenceRoots', roots); }
    }
  }
  return catalog.snapshot();
}

function createWindow() {
  const windowStatePath = path.join(app.getPath("userData"), "window-state.json");
  const windowState = restoreWindowState(windowStatePath, screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: windowState.minWidth,
    minHeight: windowState.minHeight,
    frame: false,
    show: false,
    backgroundColor: "#fbfcfa",
    icon: path.join(__dirname, "..", "build", "knight-silver.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.YU_DEV_URL) {
    const devUrl = new URL(process.env.YU_DEV_URL);
    if (!["127.0.0.1", "localhost"].includes(devUrl.hostname) || devUrl.protocol !== "http:") throw new Error("YU_DEV_URL must be a local HTTP preview");
    mainWindow.loadURL(devUrl.toString());
  } else mainWindow.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"));
  mainWindow.once("ready-to-show", () => {
    if (windowState.maximized) mainWindow.maximize();
    trackWindowState(mainWindow, { filePath: windowStatePath, initialState: windowState });
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function registerIpc() {
  ipcMain.handle("catalog:snapshot", () => catalogStorage.catalog.snapshot());
  ipcMain.handle("catalog:reconcile", (_event, entries, options) => catalogStorage.catalog.reconcile(entries, options));
  ipcMain.handle("catalog:update-assets", (_event, ids, patch) => catalogStorage.catalog.updateAssets(ids, patch));
  ipcMain.handle("catalog:create-category", (_event, input) => catalogStorage.catalog.createCategory(input));
  ipcMain.handle("catalog:create-material-area", (_event, name) => catalogStorage.catalog.createMaterialArea(name));
  ipcMain.handle("catalog:update-category", (_event, id, patch) => catalogStorage.catalog.updateCategory(id, patch));
  ipcMain.handle("catalog:delete-category", (_event, id) => catalogStorage.catalog.deleteCategory(id));
  ipcMain.handle("catalog:assign-categories", (_event, ids, categories, options) => catalogStorage.catalog.assignCategories(ids, categories, options));
  ipcMain.handle("catalog:migrate-legacy", (_event, payload) => catalogStorage.catalog.migrateLegacy(payload));
  ipcMain.handle("catalog:set-setting", (_event, key, value) => catalogStorage.catalog.setSetting(key, value));
  ipcMain.handle("catalog:refresh-references", () => refreshReferences());
  ipcMain.handle("catalog:apply-reference-change", (_event, change) => applyReferenceChange(catalogStorage.catalog, change));
  ipcMain.handle("catalog:storage-info", () => catalogStorage.info());
  ipcMain.handle("catalog:clear-cache", () => catalogStorage.clearCache());
  ipcMain.handle("catalog:set-cache-limit", (_event, value) => catalogStorage.setCacheLimit(value));
  ipcMain.handle("catalog:choose-storage", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "选择整理资料库和预览缓存的保存位置", buttonLabel: "使用此位置", properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : catalogStorage.chooseDirectory(result.filePaths[0]);
  });
  ipcMain.handle("catalog:backup", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "备份分类、标签和整理记录", buttonLabel: "保存备份",
      defaultPath: `瑜素材库整理备份-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "素材库整理记录", extensions: ["json"] }],
    });
    return result.canceled ? null : catalogStorage.backup(result.filePath);
  });
  ipcMain.handle("catalog:restore", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "选择整理资料库备份", buttonLabel: "选择备份", properties: ["openFile"], filters: [{ name: "素材库整理记录", extensions: ["json"] }] });
    if (result.canceled) return null;
    catalogStorage.validateBackup(result.filePaths[0]);
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "question", title: "恢复整理资料库", message: "使用这份备份恢复分类、标签和整理记录？",
      detail: "当前整理记录会先自动备份。恢复将替换整理资料库中的记录，原始图片、视频和源文件不会被移动或修改。",
      buttons: ["取消", "恢复整理记录"], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (confirmation.response !== 1) return null;
    const restored = catalogStorage.restore(result.filePaths[0]);
    for (const source of referenceRoots()) ensureWatcher(source.path);
    return restored;
  });
  ipcMain.handle("catalog:link-files", async (_event, area = "下载素材") => {
    if (!isMaterialArea(area, customMaterialAreas())) throw new Error("素材区域无效");
    const result = await dialog.showOpenDialog(mainWindow, { title: `原位连接文件到${area}`, buttonLabel: "原位连接", properties: ["openFile", "multiSelections"] });
    if (result.canceled) return null;
    const entries = [];
    for (const filePath of result.filePaths) {
      const stat = await fs.promises.stat(filePath, { bigint: true });
      if (!stat.isFile()) continue;
      entries.push(referenceEntry(descriptorForFile(filePath, stat), area));
    }
    validateReferenceLinks(catalogStorage.catalog, entries, area);
    catalogStorage.catalog.reconcile(entries, { complete: false });
    addFileReferences(entries.map(entry => entry.fullPath), area);
    return linkedSnapshot(entries);
  });
  ipcMain.handle("catalog:link-folder", async (_event, area = "下载素材") => {
    if (!isMaterialArea(area, customMaterialAreas())) throw new Error("素材区域无效");
    const result = await dialog.showOpenDialog(mainWindow, { title: `原位连接文件夹到${area}`, buttonLabel: "原位连接", properties: ["openDirectory"] });
    if (result.canceled) return null;
    const rootPath = result.filePaths[0];
    const scanned = await scanUserLibrary(rootPath);
    validateReferenceLinks(catalogStorage.catalog, scanned.files, area);
    const roots = referenceRoots();
    if (!roots.some(source => source.kind === "folder" && source.path === rootPath && source.area === area)) roots.push({ path: rootPath, area, kind: "folder" });
    catalogStorage.catalog.setSetting("referenceRoots", roots);
    ensureWatcher(rootPath);
    catalogStorage.catalog.reconcile(scanned.files.map(entry => referenceEntry(entry, area)), { rootPath, complete: scanned.complete });
    return linkedSnapshot(scanned.files);
  });
  ipcMain.handle("catalog:relink", async (_event, id) => {
    const asset = catalogStorage.catalog.snapshot().assets.find(item => item.id === id);
    if (!asset) throw new Error("素材记录不存在");
    const result = await dialog.showOpenDialog(mainWindow, { title: `重新定位原文件：${asset.displayName || asset.name || "素材"}`, buttonLabel: "连接此文件", properties: ["openFile"] });
    if (result.canceled) return null;
    const filePath = result.filePaths[0];
    const stat = await fs.promises.stat(filePath, { bigint: true });
    if (!stat.isFile()) throw new Error("请选择普通文件");
    const area = asset.area || asset.context?.area || "下载素材";
    const context = area === '项目素材' ? asset.context || {} : {};
    const entry = referenceEntry(descriptorForFile(filePath, stat), area, context);
    catalogStorage.catalog.relink(id, entry);
    const roots = referenceRoots();
    for (const source of roots) if (source.kind === "files") {
      source.paths = (source.paths || []).filter(old => old !== asset.fullPath);
      if (source.fileKeys) delete source.fileKeys[asset.fullPath];
    }
    catalogStorage.catalog.setSetting("referenceRoots", roots.filter(source => source.kind !== "files" || source.paths.length));
    addFileReferences([filePath], area, context);
    return catalogStorage.catalog.snapshot();
  });
  ipcMain.on("library:start-file-drag", (event, filePaths) => {
    try {
      const files = [...new Set(Array.isArray(filePaths) ? filePaths : [])]
        .filter((filePath) => typeof filePath === "string" && path.isAbsolute(filePath))
        .map((filePath) => path.resolve(filePath))
        .filter((filePath) => {
          try { return fs.statSync(filePath).isFile(); } catch { return false; }
        });
      if (!files.length) return;

      const iconPath = path.join(__dirname, "..", "build", "knight-silver.ico");
      let icon = IMAGE_EXTENSIONS.has(path.extname(files[0]).slice(1).toLowerCase())
        ? nativeImage.createFromPath(files[0]) : nativeImage.createEmpty();
      if (icon.isEmpty()) icon = nativeImage.createFromPath(iconPath);
      else icon = icon.resize({ width: 96, height: 96 });
      event.sender.startDrag({ file: files[0], files, icon });
    } finally {
      // Native Windows dragging can finish without a DOM dragend after preventDefault().
      if (!event.sender.isDestroyed()) event.sender.send("library:file-drag-ended");
    }
  });

  ipcMain.handle("library:pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择瑜の素材库文件夹",
      buttonLabel: "选择此文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("library:pick-project-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "添加项目素材文件夹",
      buttonLabel: "添加为项目",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("library:scan", async (_event, rootPath) => {
    ensureWatcher(rootPath);
    return scanUserLibrary(rootPath);
  });
  ipcMain.handle("library:retain-watchers", (_event, roots) => {
    const retained = new Set([...roots, ...referenceRoots().map(source => source.path)].map((root) => path.resolve(root).toLowerCase()));
    for (const [key, close] of libraryWatchers) {
      if (!retained.has(key)) { close(); libraryWatchers.delete(key); }
    }
  });
  ipcMain.handle("library:describe-paths", async (_event, paths) => describePaths(paths));

  ipcMain.handle("library:create-structure", async (_event, existingPath) => {
    let rootPath = existingPath;
    if (!rootPath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择素材库保存位置",
        buttonLabel: "在这里创建",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      rootPath = result.filePaths[0];
    }
    return ensureLibraryStructure(rootPath);
  });

  ipcMain.handle("library:prepare-asset-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择素材的保存位置",
      buttonLabel: "使用此文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    return ensureLibraryStructure(result.filePaths[0]);
  });

  ipcMain.handle("library:import-files", async (_event, rootPath) => {
    if (!rootPath) throw new Error("请先选择素材库文件夹");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "导入到待整理",
      buttonLabel: "导入所选文件",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    return copyFilesToInbox(rootPath, result.filePaths);
  });
  ipcMain.handle("library:import-dropped-files", async (_event, rootPath, paths) => copyFilesToInbox(rootPath, paths));
  ipcMain.handle("library:describe-drop", async (_event, payload) => describePaths(resolveDroppedPaths(payload)));
  ipcMain.handle("library:move-dropped-files", async (_event, rootPath, paths, directory) => {
    const moved = [];
    try {
      await moveFilesToDirectory(rootPath, paths, directory, (entry) => moved.push(entry));
      remapCatalog(moved, { rootPath });
      return { moved, error: "" };
    } catch (error) {
      remapCatalog(moved, { rootPath });
      return { moved, error: error?.message || "文件移动失败，未完成的原文件保留在原位置" };
    }
  });
  ipcMain.handle("library:import-files-to-area", async (_event, rootPath, paths, area, category) => (
    copyFilesToArea(rootPath, paths, area, category, customMaterialAreas())
  ));
  ipcMain.handle("library:pick-files-to-area", async (_event, rootPath, area, category) => {
    if (!rootPath) throw new Error("请先选择素材库保存位置");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `添加到${area}`,
      buttonLabel: "添加所选文件",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    return copyFilesToArea(rootPath, result.filePaths, area, category, customMaterialAreas());
  });
  ipcMain.handle("library:rename-file", async (_event, rootPath, filePath, name) => {
    const destination = await renameFile(rootPath, filePath, name);
    remapCatalog([{ source: filePath, destination }], { rootPath });
    return destination;
  });
  ipcMain.handle("library:organize-file", async (_event, rootPath, filePath, target) => {
    const destination = await organizeFile(rootPath, filePath, target, customMaterialAreas());
    remapCatalog([{ source: filePath, destination }], { rootPath, target });
    return destination;
  });
  ipcMain.handle("library:organize-files", async (_event, rootPath, filePaths, target) => {
    let moves = [];
    let message = "";
    try { moves = await organizeFiles(rootPath, filePaths, target, customMaterialAreas()); }
    catch (error) { moves = error.moves || []; message = error.message || "部分文件整理失败"; }
    remapCatalog(moves, { rootPath, target });
    return { moves, error: message };
  });
  ipcMain.handle("library:trash-files", async (_event, rootPath, filePaths) => {
    const result = await trashFiles(rootPath, filePaths, (filePath) => shell.trashItem(filePath));
    catalogStorage.catalog.forgetPaths(result.deleted);
    return result;
  });

  ipcMain.handle("system:open-path", async (_event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) throw new Error("文件不存在或已移动");
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle("system:reveal-path", async (_event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) throw new Error("文件不存在或已移动");
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.yu.materiallibrary");
    catalogStorage = createCatalogStorage(app.getPath("userData"), async (filePath) => {
      const image = await nativeImage.createThumbnailFromPath(filePath, { width: 512, height: 512 });
      if (image.isEmpty()) throw new Error("Thumbnail unavailable");
      return image.toPNG();
    });
    protocol.handle("yu-asset", async (request) => {
      try {
        const requestUrl = new URL(request.url);
        const encodedPath = requestUrl.pathname.slice(1);
        const filePath = Buffer.from(encodedPath, "base64url").toString("utf8");
        const extension = path.extname(filePath).slice(1).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension) || !fs.existsSync(filePath)) {
          return new Response("Not found", { status: 404 });
        }
        if (requestUrl.searchParams.get("thumbnail") === "1") {
          try {
            return new Response(await catalogStorage.thumbnail(filePath), { headers: {
              "Content-Type": "image/png",
              "Cache-Control": "private, max-age=31536000, immutable",
            } });
          } catch {
            // Unsupported native codecs still display through Chromium.
          }
        }
        return net.fetch(pathToFileURL(filePath).toString());
      } catch {
        return new Response("Bad request", { status: 400 });
      }
    });
    registerIpc();
    createWindow();
  }).catch(error => {
    dialog.showErrorBox("无法打开整理资料库", error.message || String(error));
    app.quit();
  });
}

app.on("window-all-closed", () => {
  for (const close of libraryWatchers.values()) close();
  libraryWatchers.clear();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => catalogStorage?.close());

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
