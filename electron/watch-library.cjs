const fs = require("node:fs");
const path = require("node:path");
const { IMAGE_EXTENSIONS } = require("./library.cjs");

// Native change notifications only: no polling and no periodic directory scans.
function watchLibrary(rootPath, notify, onError = () => {}) {
  const root = path.resolve(rootPath);
  const managed = fs.existsSync(path.join(root, "00_待整理")) && fs.existsSync(path.join(root, "02_项目素材"));
  const timers = new Map();
  let closed = false;
  let queue = Promise.resolve();
  async function describe(target, files) {
    let stat;
    try { stat = await fs.promises.lstat(target); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (stat.isDirectory()) {
      // A newly moved/created directory may contain files whose individual events were coalesced.
      for (const name of await fs.promises.readdir(target)) await describe(path.join(target, name), files);
    } else if (stat.isFile()) {
      const extension = path.extname(target).slice(1).toLowerCase();
      const isImage = IMAGE_EXTENSIONS.has(extension);
      files.push({ name: path.basename(target), fullPath: target,
        relativePath: path.relative(root, target).split(path.sep).join("/"),
        extension, size: stat.size, modified: stat.mtimeMs, isImage,
        previewUrl: isImage ? `yu-asset://file/${Buffer.from(target).toString("base64url")}` : null });
    }
  }
  function schedule(relative, attempt = 0) {
    const target = path.resolve(root, relative);
    const inside = path.relative(root, target);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return;
    if (managed && !/^(00_待整理|01_素材|02_项目素材)([\\/]|$)/.test(inside)) return;
    clearTimeout(timers.get(target));
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      queue = queue.then(async () => {
        if (closed) return;
        try {
          const files = [];
          await describe(target, files);
          if (!closed) notify({ rootPath: root, replacedPath: target, files });
        } catch (error) {
          if (!closed && attempt < 3) schedule(relative, attempt + 1);
          else if (!closed) onError(error);
        }
      });
    }, 500));
  }
  const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
    if (filename) schedule(String(filename));
  });
  watcher.on("error", onError);
  return () => {
    closed = true;
    watcher.close();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}

module.exports = { watchLibrary };
