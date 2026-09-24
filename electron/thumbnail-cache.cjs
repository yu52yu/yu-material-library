const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Keep expensive native image decoding off the UI thread and limit memory peaks.
function createThumbnailCache(directory, generate, concurrency = 2) {
  const pending = new Map();
  const queue = [];
  let active = 0;
  function schedule(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      drain();
    });
  }
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  }
  return async function thumbnail(filePath) {
    const stat = await fs.stat(filePath);
    const key = createHash('sha256').update(`${filePath}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.size}|512-v1`).digest('hex');
    if (pending.has(key)) return pending.get(key);
    const output = path.join(directory, `${key}.png`);
    const task = (async () => {
      try { return await fs.readFile(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return schedule(async () => {
        const bytes = await generate(filePath);
        await fs.mkdir(directory, { recursive: true });
        const temporary = `${output}.tmp`;
        try {
          await fs.writeFile(temporary, bytes);
          await fs.rename(temporary, output);
        } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
        return bytes;
      });
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}

module.exports = { createThumbnailCache };
