const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const DEFAULT_LIMIT = 512 * 1024 * 1024;

// Only derivative previews live here. Pruning and clearing never follow source paths.
function createThumbnailCache(directory, generate, concurrency = 2, options = {}) {
  if (typeof concurrency === 'object') { options = concurrency; concurrency = 2; }
  const cacheDirectory = path.resolve(directory);
  const pending = new Map();
  const queue = [];
  let active = 0;
  let epoch = 0;
  let maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes >= 0 ? options.maxBytes : DEFAULT_LIMIT;
  let maintenance = Promise.resolve();
  function serial(task) {
    const result = maintenance.then(task);
    maintenance = result.catch(() => {});
    return result;
  }
  async function cachedFiles() {
    await fs.mkdir(cacheDirectory, { recursive: true });
    const names = await fs.readdir(cacheDirectory);
    const files = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.png$/.test(name)).map(async name => {
      const filePath = path.join(cacheDirectory, name);
      const stat = await fs.lstat(filePath).catch(() => null);
      return stat?.isFile() ? { path: filePath, size: stat.size, modified: stat.mtimeMs } : null;
    }));
    return files.filter(Boolean);
  }
  async function prune() {
    const files = await cachedFiles();
    let bytes = files.reduce((sum, file) => sum + file.size, 0);
    files.sort((a, b) => a.modified - b.modified);
    for (const file of files) {
      if (bytes <= maxBytes) break;
      await fs.unlink(file.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
      bytes -= file.size;
    }
    return { directory: cacheDirectory, bytes, maxBytes };
  }
  const initialized = serial(prune);
  function schedule(task) {
    return new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); drain(); });
  }
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  }
  const thumbnail = async function thumbnail(filePath) {
    await initialized;
    const stat = await fs.stat(filePath);
    const key = createHash('sha256').update(`${filePath}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.size}|512-v1`).digest('hex');
    if (pending.has(key)) return pending.get(key);
    const output = path.join(cacheDirectory, `${key}.png`);
    const requestEpoch = epoch;
    const task = (async () => {
      try {
        const bytes = await fs.readFile(output);
        const now = new Date();
        await fs.utimes(output, now, now).catch(() => {});
        return bytes;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return schedule(async () => {
        const bytes = await generate(filePath);
        await serial(async () => {
          if (requestEpoch !== epoch || bytes.length > maxBytes) return;
          await fs.mkdir(cacheDirectory, { recursive: true });
          const temporary = `${output}.${randomUUID()}.tmp`;
          try {
            await fs.writeFile(temporary, bytes);
            await fs.rename(temporary, output);
          } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
          await prune();
        });
        return bytes;
      });
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
  thumbnail.info = () => serial(prune);
  thumbnail.setMaxBytes = (value) => {
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid thumbnail cache limit');
    maxBytes = value;
    return serial(prune);
  };
  thumbnail.clear = () => {
    epoch++;
    return serial(async () => {
      for (const file of await cachedFiles()) await fs.unlink(file.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return { directory: cacheDirectory, bytes: 0, maxBytes };
    });
  };
  thumbnail.ready = initialized;
  return thumbnail;
}

module.exports = { createThumbnailCache };
