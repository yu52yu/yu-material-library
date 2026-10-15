const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, screen, shell } = require("electron");
const { createThumbnailCache } = require("./thumbnail-cache.cjs");
const { restoreWindowState, trackWindowState } = require("./window-state.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  IMAGE_EXTENSIONS,
  copyFilesToArea,
  copyFilesToInbox,
  describePaths,
  ensureLibraryStructure,
  organizeFile,
  renameFile,
  organizeFiles,
  scanLibrary,
  trashFiles,
} = require("./library.cjs");

protocol.registerSchemesAsPrivileged([{
  scheme: "yu-asset",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

let mainWindow;
const { watchLibrary } = require("./watch-library.cjs");
const libraryWatchers = new Map();
function sendLibraryEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
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

  mainWindow.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"));
  mainWindow.once("ready-to-show", () => {
    if (windowState.maximized) mainWindow.maximize();
    trackWindowState(mainWindow, { filePath: windowStatePath, initialState: windowState });
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function registerIpc() {
  ipcMain.on("library:start-file-drag", (event, filePaths) => {
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
    const key = path.resolve(rootPath).toLowerCase();
    if (!libraryWatchers.has(key)) {
      try {
        libraryWatchers.set(key, watchLibrary(rootPath,
          (change) => sendLibraryEvent("library:changed", change),
          () => sendLibraryEvent("library:watch-error", "文件夹监听暂时不可用，请手动刷新素材库")));
      } catch {
        sendLibraryEvent("library:watch-error", "该文件夹不支持自动监听，请手动刷新素材库");
      }
    }
    return scanLibrary(rootPath);
  });
  ipcMain.handle("library:retain-watchers", (_event, roots) => {
    const retained = new Set(roots.map((root) => path.resolve(root).toLowerCase()));
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
      title: "选择下载素材和 AI 素材的保存位置",
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
  ipcMain.handle("library:import-files-to-area", async (_event, rootPath, paths, area, category) => (
    copyFilesToArea(rootPath, paths, area, category)
  ));
  ipcMain.handle("library:pick-files-to-area", async (_event, rootPath, area, category) => {
    if (!rootPath) throw new Error("请先选择素材库保存位置");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `添加到${area}`,
      buttonLabel: "添加所选文件",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    return copyFilesToArea(rootPath, result.filePaths, area, category);
  });
  ipcMain.handle("library:rename-file", async (_event, rootPath, filePath, name) => renameFile(rootPath, filePath, name));
  ipcMain.handle("library:organize-file", async (_event, rootPath, filePath, target) => organizeFile(rootPath, filePath, target));
  ipcMain.handle("library:organize-files", async (_event, rootPath, filePaths, target) => organizeFiles(rootPath, filePaths, target));
  ipcMain.handle("library:trash-files", async (_event, rootPath, filePaths) => (
    trashFiles(rootPath, filePaths, (filePath) => shell.trashItem(filePath))
  ));

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
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.yu.materiallibrary");
    const thumbnail = createThumbnailCache(path.join(app.getPath("userData"), "thumbnails-v1"), async (filePath) => {
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
            return new Response(await thumbnail(filePath), { headers: {
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
  });
}

app.on("window-all-closed", () => {
  for (const close of libraryWatchers.values()) close();
  libraryWatchers.clear();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
