const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCatalogStorage } = require('./catalog-storage.cjs');
const { descriptorForFile } = require('./library.cjs');

test('moving metadata storage commits to a fresh directory and preserves original bytes', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-catalog-storage-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const userData = path.join(root, 'profile');
  const parent = path.join(root, 'chosen');
  await fs.mkdir(parent);
  await fs.writeFile(path.join(parent, 'catalog.sqlite'), 'do not overwrite');
  const original = path.join(root, 'original.png');
  await fs.writeFile(original, 'original image bytes');
  let storage = createCatalogStorage(userData, async () => Buffer.from('thumbnail'));
  try {
    const first = storage.catalog.reconcile([descriptorForFile(original, await fs.stat(original))], { complete: false });
    storage.catalog.updateAssets([first.assets[0].id], { tags: ['fish'], note: 'keep this' });
    const oldDirectory = (await storage.info()).directory;
    const moved = await storage.chooseDirectory(parent);
    assert.notEqual(moved.directory, parent);
    assert.notEqual(moved.directory, oldDirectory);
    assert.equal(storage.catalog.snapshot().assets[0].id, first.assets[0].id);
    assert.deepEqual(storage.catalog.snapshot().assets[0].tags, ['fish']);
    assert.equal(await fs.readFile(path.join(parent, 'catalog.sqlite'), 'utf8'), 'do not overwrite');
    assert.equal(await fs.readFile(original, 'utf8'), 'original image bytes');
    assert.equal((await fs.readdir(moved.directory)).includes('original.png'), false);
    assert.ok(moved.databaseBytes > 0);
    assert.ok(moved.backupBytes > 0);
    assert.equal(moved.originalsIncluded, false);
    storage.close();
    storage = createCatalogStorage(userData, async () => Buffer.from('thumbnail'));
    assert.equal((await storage.info()).directory, moved.directory);
    assert.equal(storage.catalog.snapshot().assets[0].note, 'keep this');
  } finally { storage.close(); }
});

test('invalid restores leave metadata intact and cache controls affect only previews', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-catalog-storage-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'original.png');
  await fs.writeFile(original, 'original');
  const storage = createCatalogStorage(path.join(root, 'profile'), async () => Buffer.from('preview'));
  try {
    const first = storage.catalog.reconcile([descriptorForFile(original, await fs.stat(original))], { complete: false });
    const backup = path.join(root, 'metadata.json');
    storage.backup(backup);
    const saved = JSON.parse(await fs.readFile(backup, 'utf8'));
    assert.equal(saved.data.assets[0].fullPath, original);
    assert.equal(JSON.stringify(saved).includes('b3JpZ2luYWw='), false);
    const invalid = path.join(root, 'invalid.json');
    await fs.writeFile(invalid, '{"not":"a backup"}');
    assert.throws(() => storage.restore(invalid), /格式|版本/);
    assert.equal(storage.catalog.snapshot().assets[0].id, first.assets[0].id);
    await storage.thumbnail(original);
    assert.equal((await storage.info()).cacheBytes, 7);
    assert.equal((await storage.setCacheLimit(128)).cacheLimitMB, 128);
    await assert.rejects(storage.setCacheLimit(127), /128/);
    assert.equal((await storage.clearCache()).cacheBytes, 0);
    assert.equal(await fs.readFile(original, 'utf8'), 'original');
    assert.equal(storage.catalog.snapshot().assets[0].id, first.assets[0].id);
    storage.catalog.updateAssets([first.assets[0].id], { note: 'changed' });
    const restored = storage.restore(backup);
    assert.equal(restored.assets[0].note, '');
    assert.ok((await fs.readdir(path.join((await storage.info()).directory, 'backups'))).length >= 2);
  } finally { storage.close(); }
});

test('malformed storage configuration never silently opens a replacement empty catalog', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-catalog-storage-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'catalog-location.json'), '{"directory":"relative"}');
  assert.throws(() => createCatalogStorage(root, async () => Buffer.from('png')), /位置记录无效/);
  await assert.rejects(fs.stat(path.join(root, 'catalog')));
});
