const fs = require("node:fs");
const path = require("node:path");

const MAX_FILES = 12000;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]);
const LIBRARY_DIRECTORIES = [
  "00_待整理",
  path.join("01_素材", "下载素材"),
  path.join("01_素材", "AI制作素材"),
  "02_项目素材",
];

function extensionOf(fileName) {
  return path.extname(fileName).slice(1).toLowerCase();
}

function safeSegment(value, fallback) {
  const cleaned = String(value || "").trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "");
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

function isInside(rootPath, targetPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function uniqueDestination(directory, fileName) {
  const parsed = path.parse(fileName);
  let destination = path.join(directory, parsed.base);
  let suffix = 2;
  while (fs.existsSync(destination)) {
    destination = path.join(directory, `${parsed.name}_${suffix}${parsed.ext}`);
    suffix += 1;
  }
  return destination;
}

function previewUrlFor(filePath) {
  const encoded = Buffer.from(filePath, "utf8").toString("base64url");
  return `yu-asset://file/${encoded}`;
}

async function assertDirectory(rootPath) {
  const resolved = path.resolve(rootPath);
  const stat = await fs.promises.stat(resolved);
  if (!stat.isDirectory()) throw new Error("选择的位置不是文件夹");
  return resolved;
}

async function ensureLibraryStructure(rootPath) {
  const resolved = path.resolve(rootPath);
  await fs.promises.mkdir(resolved, { recursive: true });
  await Promise.all(LIBRARY_DIRECTORIES.map((relativePath) => (
    fs.promises.mkdir(path.join(resolved, relativePath), { recursive: true })
  )));
  return resolved;
}

async function scanLibrary(rootPath) {
  const root = await assertDirectory(rootPath);
  const files = [];
  const isManagedLibrary = LIBRARY_DIRECTORIES.every((relativePath) => fs.existsSync(path.join(root, relativePath)));
  const pending = isManagedLibrary
    ? LIBRARY_DIRECTORIES.map((relativePath) => path.join(root, relativePath))
    : [root];

  while (pending.length && files.length < MAX_FILES) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        const stat = await fs.promises.stat(fullPath);
        const extension = extensionOf(entry.name);
        files.push({
          name: entry.name,
          fullPath,
          relativePath: path.relative(root, fullPath).split(path.sep).join("/"),
          extension,
          size: stat.size,
          modified: stat.mtimeMs,
          previewUrl: IMAGE_EXTENSIONS.has(extension) ? previewUrlFor(fullPath) : null,
          isImage: IMAGE_EXTENSIONS.has(extension),
        });
      } catch {
        // A file can disappear or become locked while a folder is being indexed.
      }
    }
  }

  files.sort((a, b) => b.modified - a.modified);
  return {
    rootPath: root,
    rootName: path.basename(root),
    files,
    isManagedLibrary,
    truncated: files.length >= MAX_FILES,
  };
}

async function prepareFilesForDeletion(rootPath, filePaths) {
  if (typeof rootPath !== "string" || !rootPath.trim() || !path.isAbsolute(rootPath) || rootPath.includes("\0")) {
    throw new Error("请先选择有效的素材库或项目文件夹");
  }
  if (!Array.isArray(filePaths) || filePaths.some((filePath) => (
    typeof filePath !== "string" || !filePath.trim() || !path.isAbsolute(filePath) || filePath.includes("\0")
  ))) throw new Error("删除文件路径无效");

  const root = await assertDirectory(rootPath);
  const realRoot = await fs.promises.realpath(root);
  const validated = [];
  const seen = new Set();
  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isInside(root, resolved) || path.relative(root, resolved) === "") throw new Error("只能删除当前素材库中的文件");
    const stat = await fs.promises.lstat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new Error("文件不存在、已经移动或不是普通文件");
    const realPath = await fs.promises.realpath(resolved);
    if (!isInside(realRoot, realPath) || path.relative(realRoot, realPath) === "") {
      throw new Error("只能删除当前素材库中的文件");
    }
    validated.push({ path: resolved, realPath, dev: stat.dev, ino: stat.ino });
  }
  return { realRoot, files: validated };
}

async function validateFilesInsideRoot(rootPath, filePaths) {
  return (await prepareFilesForDeletion(rootPath, filePaths)).files.map((file) => file.path);
}

async function trashFiles(rootPath, filePaths, trashItem) {
  if (typeof trashItem !== "function") throw new Error("回收站服务不可用");
  // Validate the entire request before changing any file, including real paths
  // behind junctions. Invalid selections must never partially mutate a library.
  const prepared = await prepareFilesForDeletion(rootPath, filePaths);
  const deleted = [];
  const failed = [];
  for (const file of prepared.files) {
    try {
      // Earlier recycle-bin operations may take time; a queued file can vanish
      // or be replaced while the batch is running. Recheck before handing its
      // original path to the OS, and never fall back to permanent deletion.
      const current = await prepareFilesForDeletion(rootPath, [file.path]);
      const currentFile = current.files[0];
      if (current.realRoot !== prepared.realRoot || currentFile.realPath !== file.realPath
        || currentFile.dev !== file.dev || currentFile.ino !== file.ino) {
        throw new Error("文件或所在文件夹已经变化，请刷新后再试");
      }
      await trashItem(file.path);
      deleted.push(file.path);
    } catch (error) {
      failed.push({ path: file.path, message: error?.message || "无法将文件移入回收站，请稍后重试" });
    }
  }
  return { deleted, failed };
}

function targetDirectoryForArea(root, area, category) {
  if (area === "待整理") return path.join(root, "00_待整理");
  if (area === "下载素材") return path.join(root, "01_素材", "下载素材", safeSegment(category, "未分类"));
  if (area === "AI制作素材") return path.join(root, "01_素材", "AI制作素材", safeSegment(category, "未分类"));
  throw new Error("导入目标无效");
}

async function copyFilesToArea(rootPath, sourcePaths, area = "待整理", category = "未分类") {
  const root = await ensureLibraryStructure(rootPath);
  const targetDirectory = targetDirectoryForArea(root, area, category);
  await fs.promises.mkdir(targetDirectory, { recursive: true });
  const imported = [];

  for (const sourcePath of sourcePaths) {
    const stat = await fs.promises.stat(sourcePath).catch(() => null);
    if (!stat?.isFile()) continue;

    const destination = uniqueDestination(targetDirectory, path.basename(sourcePath));
    await fs.promises.copyFile(sourcePath, destination, fs.constants.COPYFILE_EXCL);
    imported.push(destination);
  }
  return imported;
}

async function copyFilesToInbox(rootPath, sourcePaths) {
  return copyFilesToArea(rootPath, sourcePaths, "待整理");
}

async function describePaths(sourcePaths) {
  const results = [];
  for (const sourcePath of sourcePaths || []) {
    const resolved = path.resolve(sourcePath);
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat) continue;
    results.push({ path: resolved, name: path.basename(resolved), isDirectory: stat.isDirectory(), isFile: stat.isFile() });
  }
  return results;
}

async function organizeFile(rootPath, filePath, target) {
  const root = await assertDirectory(rootPath);
  const source = path.resolve(filePath);
  if (!isInside(root, source)) throw new Error("链接项目中的文件请在原文件夹里整理");
  const stat = await fs.promises.stat(source).catch(() => null);
  if (!stat?.isFile()) throw new Error("文件不存在或已经移动");

  let parts;
  if (target.directProject) {
    if (target.area !== "项目素材") throw new Error("关联项目只能在当前项目内整理");
    parts = [
      ["参考素材", "制作素材"].includes(target.mode) ? target.mode : "制作素材",
      safeSegment(target.category, "源文件"),
    ];
  } else if (target.area === "下载素材") {
    parts = ["01_素材", "下载素材", safeSegment(target.category, "未分类")];
  } else if (target.area === "AI制作素材") {
    parts = ["01_素材", "AI制作素材", safeSegment(target.category, "未分类")];
  } else if (target.area === "项目素材") {
    parts = [
      "02_项目素材",
      safeSegment(target.project, "未命名项目"),
      ["参考素材", "制作素材"].includes(target.mode) ? target.mode : "制作素材",
      safeSegment(target.category, "源文件"),
    ];
  } else {
    throw new Error("整理目标无效");
  }

  const directory = path.join(root, ...parts);
  if (path.dirname(source) === directory) return source;
  await fs.promises.mkdir(directory, { recursive: true });
  const destination = uniqueDestination(directory, path.basename(source));
  try {
    await fs.promises.rename(source, destination);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    await fs.promises.unlink(source);
  }
  return destination;
}

async function organizeFiles(rootPath, filePaths, target) {
  const moved = [];
  for (const filePath of filePaths || []) {
    const destination = await organizeFile(rootPath, filePath, target);
    moved.push({ source: filePath, destination });
  }
  return moved;
}

async function renameFile(rootPath, filePath, newStem) {
  const root = await fs.promises.realpath(await assertDirectory(rootPath));
  const source = path.resolve(filePath);
  const realSource = await fs.promises.realpath(source);
  if (!isInside(root, realSource) || !(await fs.promises.lstat(source)).isFile()) throw new Error("只能重命名当前素材库或链接项目中的文件");
  if (typeof newStem !== "string" || !newStem.trim() || /[<>:"/\\|?*\u0000-\u001f]/.test(newStem) || /[. ]$/.test(newStem) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(newStem) || [".", ".."].includes(newStem)) throw new Error("文件名无效，请去掉特殊字符、末尾空格或句点");
  const destination = path.join(path.dirname(source), newStem + path.extname(source));
  if (destination === source) return destination;
  // Hard-link creation is exclusive: an existing destination can never be overwritten.
  try {
    await fs.promises.link(source, destination);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("同名文件已存在，请换一个名称（仅修改大小写时请先使用临时名称）");
    throw error;
  }
  try { await fs.promises.unlink(source); }
  catch (error) { await fs.promises.unlink(destination); throw error; }
  return destination;
}

module.exports = {
  renameFile,
  IMAGE_EXTENSIONS,
  assertDirectory,
  copyFilesToArea,
  copyFilesToInbox,
  describePaths,
  ensureLibraryStructure,
  organizeFile,
  organizeFiles,
  scanLibrary,
  trashFiles,
  validateFilesInsideRoot,
};
