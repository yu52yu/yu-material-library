const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCatalog } = require('./catalog.cjs');
const { descriptorForFile } = require('./library.cjs');
const { applyReferenceChange, referenceEntry, validateReferenceLinks } = require('./catalog-references.cjs');

test('incremental single-file references follow a rename and reject unrelated sibling files', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-reference-change-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'originals');
  await fs.mkdir(directory);
  const original = path.join(directory, 'fish.mp4');
  const renamed = path.join(directory, 'fish-new.mp4');
  const sibling = path.join(directory, 'unrelated.mp4');
  await fs.writeFile(original, 'original video');
  await fs.writeFile(sibling, 'unrelated');
  const initial = descriptorForFile(original, await fs.stat(original), directory);
  const catalog = createCatalog(path.join(root, 'catalog'));
  try {
    const first = catalog.reconcile([referenceEntry(initial, '下载素材')], { complete: false });
    const id = first.assets[0].id;
    catalog.updateAssets([id], { note: 'keep note', tags: ['鱼'] });
    catalog.setSetting('referenceRoots', [{ kind: 'files', path: directory, area: '下载素材', paths: [original], fileKeys: { [original]: initial.fileKey } }]);
    await fs.rename(original, renamed);
    const snapshot = applyReferenceChange(catalog, {
      rootPath: directory, replacedPath: directory,
      files: [descriptorForFile(renamed, await fs.stat(renamed), directory), descriptorForFile(sibling, await fs.stat(sibling), directory)],
    });
    assert.equal(snapshot.assets.length, 1);
    assert.equal(snapshot.assets[0].id, id);
    assert.equal(snapshot.assets[0].fullPath, renamed);
    assert.equal(snapshot.assets[0].note, 'keep note');
    assert.deepEqual(snapshot.settings.referenceRoots[0].paths, [renamed]);
    await fs.unlink(renamed);
    const missing = applyReferenceChange(catalog, { rootPath: directory, replacedPath: renamed, files: [] });
    assert.equal(missing.assets[0].online, false);
    assert.equal(missing.assets[0].note, 'keep note');
    assert.deepEqual(missing.assets[0].tags, ['鱼']);
    assert.equal(await fs.readFile(sibling, 'utf8'), 'unrelated');
  } finally { catalog.close(); }
});

test('folder reference changes update only their changed subtree', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-reference-folder-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'originals');
  await fs.mkdir(directory);
  const first = path.join(directory, 'first.png');
  const second = path.join(directory, 'second.png');
  await fs.writeFile(first, 'first');
  await fs.writeFile(second, 'second');
  const catalog = createCatalog(path.join(root, 'catalog'));
  try {
    catalog.reconcile(await Promise.all([first, second].map(async filePath => referenceEntry(descriptorForFile(filePath, await fs.stat(filePath), directory), '下载素材'))), { complete: false });
    catalog.setSetting('referenceRoots', [{ kind: 'folder', path: directory, area: '下载素材' }]);
    await fs.unlink(first);
    const changed = applyReferenceChange(catalog, { rootPath: directory, replacedPath: first, files: [] });
    assert.equal(changed.assets.find(asset => asset.fullPath === first).online, false);
    assert.equal(changed.assets.find(asset => asset.fullPath === second).online, true);
  } finally { catalog.close(); }
});

test('reconnected project originals retain project context through future reference notifications', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-reference-project-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const originalDirectory = path.join(root, 'project');
  const relocatedDirectory = path.join(root, 'relocated');
  await fs.mkdir(originalDirectory);
  await fs.mkdir(relocatedDirectory);
  const original = path.join(originalDirectory, 'render.png');
  const relocated = path.join(relocatedDirectory, 'render.png');
  await fs.writeFile(original, 'render');
  const catalog = createCatalog(path.join(root, 'catalog'));
  const projectContext = { project: 'Project A', mode: '制作素材', category: '渲染图' };
  try {
    const initial = descriptorForFile(original, await fs.stat(original), originalDirectory);
    const first = catalog.reconcile([referenceEntry(initial, '项目素材', projectContext)], { complete: false });
    catalog.updateAssets([first.assets[0].id], { note: 'project note' });
    assert.throws(() => validateReferenceLinks(catalog, [initial], '下载素材'), /已属于项目素材/);
    assert.equal(catalog.snapshot().assets[0].context.project, 'Project A');
    await fs.rename(original, relocated);
    const entry = descriptorForFile(relocated, await fs.stat(relocated), relocatedDirectory);
    catalog.relink(first.assets[0].id, referenceEntry(entry, '项目素材', projectContext));
    catalog.setSetting('referenceRoots', [{ path: relocatedDirectory, kind: 'files', area: '项目素材', paths: [relocated], fileKeys: { [relocated]: entry.fileKey }, context: projectContext }]);
    await fs.writeFile(relocated, 'updated render');
    const next = applyReferenceChange(catalog, { rootPath: relocatedDirectory, replacedPath: relocated, files: [descriptorForFile(relocated, await fs.stat(relocated), relocatedDirectory)] });
    assert.equal(next.assets[0].id, first.assets[0].id);
    assert.equal(next.assets[0].area, '项目素材');
    assert.equal(next.assets[0].context.project, 'Project A');
    assert.equal(next.assets[0].context.mode, '制作素材');
    assert.equal(next.assets[0].context.category, '渲染图');
    assert.equal(next.assets[0].note, 'project note');
    assert.equal(await fs.readFile(relocated, 'utf8'), 'updated render');
  } finally { catalog.close(); }
});
