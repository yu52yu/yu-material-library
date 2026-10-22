const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createThumbnailCache } = require('./thumbnail-cache.cjs');

function cacheLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 128 || numeric > 4096) throw new Error('缓存上限应在 128–4096 MB 之间');
  return Math.round(numeric);
}

function atomicJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), { flag: 'wx' }); fs.renameSync(temporary, filePath); }
  finally { fs.rmSync(temporary, { force: true }); }
}

function bytesIn(directory, predicate = () => true) {
  let total = 0;
  if (!fs.existsSync(directory)) return total;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && predicate(entry.name)) total += fs.statSync(path.join(directory, entry.name)).size;
  }
  return total;
}

function createCatalogStorage(userData, generate, options = {}) {
  const { createCatalog, validateCatalogBackup } = options.catalogModule || require('./catalog.cjs');
  const configurationPath = path.join(path.resolve(userData), 'catalog-location.json');
  let configuration = { directory: path.join(path.resolve(userData), 'catalog'), cacheLimitMB: 512 };
  if (fs.existsSync(configurationPath)) {
    const saved = JSON.parse(fs.readFileSync(configurationPath, 'utf8'));
    if (typeof saved.directory !== 'string' || !path.isAbsolute(saved.directory)) throw new Error('资料库位置记录无效，请检查 catalog-location.json');
    configuration = { directory: path.resolve(saved.directory), cacheLimitMB: cacheLimit(saved.cacheLimitMB ?? 512), metadataDirectories: Array.isArray(saved.metadataDirectories) ? saved.metadataDirectories.filter(item => typeof item === 'string' && path.isAbsolute(item)) : [] };
  }
  fs.mkdirSync(configuration.directory, { recursive: true });
  let catalog = createCatalog(configuration.directory);
  let thumbnail = makeThumbnail();
  let switching = false;

  function makeThumbnail() {
    return createThumbnailCache(path.join(configuration.directory, 'thumbnails'), generate, 2, { maxBytes: configuration.cacheLimitMB * 1024 * 1024 });
  }
  function automaticBackup() {
    const directory = path.join(configuration.directory, 'backups');
    fs.mkdirSync(directory, { recursive: true });
    const filename = `catalog-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`;
    catalog.backup(path.join(directory, filename));
    const backups = fs.readdirSync(directory).filter(name => /^catalog-.*\.json$/.test(name)).sort().reverse();
    for (const old of backups.slice(10)) fs.unlinkSync(path.join(directory, old));
  }
  automaticBackup();
  async function info() {
    const cache = await thumbnail.info();
    return {
      directory: configuration.directory, cacheDirectory: cache.directory,
      databaseBytes: bytesIn(configuration.directory, name => /^catalog\.sqlite(?:-wal|-shm)?$/.test(name)),
      backupBytes: bytesIn(path.join(configuration.directory, 'backups'), name => /^catalog-.*\.json$/.test(name)),
      cacheBytes: cache.bytes, cacheLimitMB: configuration.cacheLimitMB, originalsIncluded: false,
    };
  }
  return {
    get directory() { return configuration.directory; },
    get excludedDirectories() { return [...new Set([path.join(path.resolve(userData), 'catalog'), configuration.directory, ...(configuration.metadataDirectories || [])])]; },
    get catalog() { return catalog; },
    get thumbnail() { return thumbnail; },
    info,
    validateBackup(filePath) { return validateCatalogBackup(fs.readFileSync(filePath, 'utf8')); },
    backup(filePath) { return catalog.backup(filePath); },
    restore(filePath) {
      this.validateBackup(filePath);
      automaticBackup();
      return catalog.restore(filePath);
    },
    async chooseDirectory(parentDirectory) {
      if (switching) throw new Error('正在切换资料库位置，请稍后再试');
      switching = true;
      let nextCatalog;
      let nextDirectory;
      try {
        const parent = path.resolve(parentDirectory);
        if (!fs.statSync(parent).isDirectory()) throw new Error('请选择文件夹');
        // A unique child is always created; an existing database is never replaced.
        nextDirectory = path.join(parent, `瑜素材资料库-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`);
        fs.mkdirSync(nextDirectory);
        const transfer = path.join(nextDirectory, 'transfer.json');
        catalog.backup(transfer);
        validateCatalogBackup(fs.readFileSync(transfer, 'utf8'));
        nextCatalog = createCatalog(nextDirectory);
        nextCatalog.restore(transfer);
        fs.unlinkSync(transfer);
        const nextConfiguration = { ...configuration, directory: nextDirectory,
          metadataDirectories: [...new Set([configuration.directory, nextDirectory, ...(configuration.metadataDirectories || [])])] };
        atomicJson(configurationPath, nextConfiguration);
        const previous = catalog;
        catalog = nextCatalog;
        nextCatalog = null;
        configuration = nextConfiguration;
        thumbnail = makeThumbnail();
        previous.close();
        automaticBackup();
        return await info();
      } catch (error) {
        nextCatalog?.close();
        // Keep any incomplete new directory available for diagnosis; the active
        // catalog/configuration remain in place until the atomic commit above.
        throw error;
      } finally { switching = false; }
    },
    async setCacheLimit(value) {
      const limit = cacheLimit(value);
      const next = { ...configuration, cacheLimitMB: limit };
      atomicJson(configurationPath, next);
      configuration = next;
      await thumbnail.setMaxBytes(limit * 1024 * 1024);
      return info();
    },
    async clearCache() { await thumbnail.clear(); return info(); },
    close() { catalog.close(); },
  };
}

module.exports = { createCatalogStorage, cacheLimit };
