const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { descriptorForFile } = require('./library.cjs');

async function harness(root, options = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const picks = [];
  const confirmations = [];
  let confirmationCalls = 0;
  const app = new EventEmitter();
  const defaultProfile = path.join(root, 'installed-profile');
  const previewProfile = path.join(root, 'preview-profile');
  let userData = defaultProfile;
  app.setPath = (key, value) => { if (key === 'userData') userData = value; };
  app.getPath = key => { assert.equal(key, 'userData'); return userData; };
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.setAppUserModelId = () => {};
  app.quit = () => app.emit('will-quit');
  class BrowserWindow extends EventEmitter {
    constructor() { super(); this.webContents = { setWindowOpenHandler() {}, send() {}, isDestroyed: () => false }; }
    loadFile() {}
    loadURL() {}
    isDestroyed() { return false; }
    static getAllWindows() { return []; }
  }
  const image = { isEmpty: () => false, resize() { return this; }, toPNG: () => Buffer.from('preview') };
  const fakeElectron = {
    app, BrowserWindow,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, handler) => listeners.set(channel, handler) },
    dialog: {
      showOpenDialog: async () => picks.shift() || { canceled: true, filePaths: [] },
      showSaveDialog: async () => picks.shift() || { canceled: true },
      showMessageBox: async () => { confirmationCalls++; return { response: confirmations.shift() ?? 0 }; },
      showErrorBox: (_title, message) => { throw new Error(message); },
    },
    nativeImage: { createFromPath: () => image, createEmpty: () => image, createThumbnailFromPath: async () => image },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }], getPrimaryDisplay: () => ({ id: 1 }) },
    shell: { trashItem: options.trashItem || (async filePath => fs.rename(filePath, `${filePath}.recycled`)), openPath: async () => '', showItemInFolder() {} }, net: {},
  };
  const filename = path.join(__dirname, 'main.cjs');
  const nativeRequire = createRequire(filename);
  // Keep normal Node object prototypes, while substituting only the Electron
  // boundary. The production catalog intentionally rejects foreign objects.
  const initialize = new Function('require', '__dirname', '__filename', 'process', await fs.readFile(filename, 'utf8'));
  initialize(name => name === 'electron' ? fakeElectron : nativeRequire(name), __dirname, filename,
    { platform: process.platform, env: { YU_PREVIEW_USER_DATA: previewProfile } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(handlers.has('catalog:snapshot'));
  return {
    invoke: (channel, ...args) => handlers.get(channel)({}, ...args),
    pick: paths => picks.push({ canceled: false, filePaths: paths }),
    confirmationCalls: () => confirmationCalls,
    listeners, previewProfile, defaultProfile,
    close: () => app.emit('window-all-closed'),
  };
}

test('native pickers retain original paths, classify existing links and protect project originals', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-main-links-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'fish.png');
  await fs.writeFile(original, 'original image bytes');
  const desktop = await harness(root);
  try {
    desktop.pick([original]);
    const linked = await desktop.invoke('catalog:link-files', '下载素材');
    assert.equal(linked.assets.length, 1);
    assert.deepEqual(Array.from(linked.linkedAssetIds), [linked.assets[0].id]);
    assert.equal(linked.assets[0].fullPath, original);
    desktop.pick([original]);
    const again = await desktop.invoke('catalog:link-files', '下载素材');
    assert.equal(again.assets.length, 1);
    assert.equal(again.linkedAssetIds[0], linked.assets[0].id);
    let drag;
    desktop.listeners.get('library:start-file-drag')({ sender: { startDrag: payload => { drag = payload; }, isDestroyed: () => false, send() {} } }, [original]);
    assert.equal(drag.file, original);
    assert.equal(drag.files[0], original);
    assert.equal(await fs.readFile(original, 'utf8'), 'original image bytes');
    const projectOriginal = path.join(root, 'project.psd');
    await fs.writeFile(projectOriginal, 'project');
    await desktop.invoke('catalog:reconcile', [{ ...descriptorForFile(projectOriginal, await fs.stat(projectOriginal)), area: '项目素材', project: 'Project A', mode: '制作素材', category: '源文件' }], { complete: false });
    desktop.pick([projectOriginal]);
    await assert.rejects(desktop.invoke('catalog:link-files', '下载素材'), /已属于项目素材/);
    const snapshot = await desktop.invoke('catalog:snapshot');
    const project = snapshot.assets.find(asset => asset.fullPath === projectOriginal);
    assert.equal(project.area, '项目素材');
    assert.equal(project.context.project, 'Project A');
    assert.equal(snapshot.settings.referenceRoots.some(source => source.paths?.includes(projectOriginal)), false);
    await assert.rejects(fs.stat(desktop.defaultProfile));
    assert.ok((await fs.stat(path.join(desktop.previewProfile, 'catalog', 'catalog.sqlite'))).isFile());
  } finally { desktop.close(); }
});

test('native project relinking and partial physical moves retain metadata', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-main-relocations-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'project');
  await fs.mkdir(directory);
  const original = path.join(directory, 'render.png');
  const relocated = path.join(root, 'moved-render.png');
  await fs.writeFile(original, 'render');
  const desktop = await harness(root);
  try {
    const initial = await desktop.invoke('catalog:reconcile', [{ ...descriptorForFile(original, await fs.stat(original), directory), area: '项目素材', project: 'Project A', mode: '制作素材', category: '渲染图' }], { complete: false });
    const id = initial.assets[0].id;
    await desktop.invoke('catalog:update-assets', [id], { note: 'keep project note', tags: ['render'] });
    await fs.rename(original, relocated);
    desktop.pick([relocated]);
    const linked = await desktop.invoke('catalog:relink', id);
    assert.equal(linked.assets[0].id, id);
    assert.equal(linked.assets[0].context.project, 'Project A');
    const refreshed = await desktop.invoke('catalog:refresh-references');
    assert.equal(refreshed.assets[0].context.mode, '制作素材');
    assert.equal(refreshed.assets[0].context.category, '渲染图');
    assert.equal(refreshed.assets[0].note, 'keep project note');
    const first = path.join(directory, 'first.png');
    await fs.writeFile(first, 'first original');
    const before = await desktop.invoke('catalog:reconcile', [{ ...descriptorForFile(first, await fs.stat(first), directory), area: '项目素材', project: 'Project A', mode: '制作素材', category: '渲染图' }], { complete: false });
    const firstId = before.assets.find(asset => asset.fullPath === first).id;
    await desktop.invoke('catalog:update-assets', [firstId], { note: 'keep moved note' });
    const moved = await desktop.invoke('library:organize-files', directory, [first, path.join(directory, 'missing.png')], { directProject: true, area: '项目素材', mode: '参考素材', category: '渲染图' });
    assert.equal(moved.moves.length, 1);
    assert.ok(moved.error);
    const after = await desktop.invoke('catalog:snapshot');
    assert.equal(after.assets.find(asset => asset.id === firstId).fullPath, moved.moves[0].destination);
    assert.equal(after.assets.find(asset => asset.id === firstId).note, 'keep moved note');
    assert.equal(after.assets.find(asset => asset.id === firstId).context.mode, '参考素材');
    assert.equal(await fs.readFile(moved.moves[0].destination, 'utf8'), 'first original');
    // A previously reconnected original also keeps the new physical mode after
    // reference refresh, rather than restoring its earlier source context.
    const relinkedMove = await desktop.invoke('library:organize-files', root, [relocated], { directProject: true, area: '项目素材', project: 'Project A', mode: '参考素材', category: '渲染图' });
    assert.equal(relinkedMove.error, '');
    const refreshedMoved = await desktop.invoke('catalog:refresh-references');
    assert.equal(refreshedMoved.assets.find(asset => asset.id === id).context.mode, '参考素材');
    assert.equal(refreshedMoved.assets.find(asset => asset.id === id).context.project, 'Project A');
  } finally { desktop.close(); }
});

test('native restore validates a selected backup before asking to replace metadata', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-main-invalid-restore-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const invalid = path.join(root, 'invalid.json');
  await fs.writeFile(invalid, '{"invalid":true}');
  const desktop = await harness(root);
  try {
    desktop.pick([invalid]);
    await assert.rejects(desktop.invoke('catalog:restore'), /格式|版本/);
    assert.equal(desktop.confirmationCalls(), 0);
    assert.equal((await desktop.invoke('catalog:snapshot')).assets.length, 0);
  } finally { desktop.close(); }
});

test('custom material areas retain original links through refresh and native file changes', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-main-custom-links-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const looseDirectory = path.join(root, 'loose');
  const folder = path.join(root, 'artwork');
  await fs.mkdir(looseDirectory);
  await fs.mkdir(path.join(folder, '平面', '海报'), { recursive: true });
  const loose = path.join(looseDirectory, '作品.png');
  const nested = path.join(folder, '平面', '海报', '海报.png');
  await fs.writeFile(loose, 'loose original');
  await fs.writeFile(nested, 'nested original');
  const desktop = await harness(root);
  try {
    const created = await desktop.invoke('catalog:create-material-area', '我的作品');
    assert.deepEqual(created.settings.customAreas, ['我的作品']);
    await assert.rejects(desktop.invoke('catalog:link-files', '未注册'), /素材区域无效/);
    desktop.pick([loose]);
    const linked = await desktop.invoke('catalog:link-files', '我的作品');
    const id = linked.assets.find(asset => asset.fullPath === loose).id;
    await desktop.invoke('catalog:update-assets', [id], { note: 'keep custom artwork note' });
    desktop.pick([folder]);
    const linkedFolder = await desktop.invoke('catalog:link-folder', '我的作品');
    const nestedAsset = linkedFolder.assets.find(asset => asset.fullPath === nested);
    assert.equal(nestedAsset.area, '我的作品');
    assert.equal(nestedAsset.categoryIds.length, 1);
    const categories = linkedFolder.categories;
    const leaf = categories.find(category => category.id === nestedAsset.categoryIds[0]);
    assert.equal(leaf.name, '海报');
    assert.equal(categories.find(category => category.id === leaf.parentId).name, '平面');
    assert.equal(categories.some(category => category.name === '我的作品'), false);

    const renamed = path.join(looseDirectory, 'renamed.png');
    await fs.rename(loose, renamed);
    await desktop.invoke('catalog:apply-reference-change', { rootPath: looseDirectory, replacedPath: loose,
      files: [descriptorForFile(renamed, await fs.stat(renamed), looseDirectory)] });
    const refreshed = await desktop.invoke('catalog:refresh-references');
    const asset = refreshed.assets.find(item => item.id === id);
    assert.equal(asset.fullPath, renamed);
    assert.equal(asset.area, '我的作品');
    assert.equal(asset.note, 'keep custom artwork note');
    assert.equal(asset.online, true);
    assert.equal(refreshed.assets.find(item => item.id === nestedAsset.id).area, '我的作品');
    assert.equal(refreshed.settings.referenceRoots.length, 2);
    assert.deepEqual(refreshed.settings.referenceRoots.find(source => source.kind === 'files').paths, [renamed]);
    assert.equal(await fs.readFile(renamed, 'utf8'), 'loose original');
    assert.equal(await fs.readFile(nested, 'utf8'), 'nested original');
  } finally { desktop.close(); }
});

test('custom material areas copy picker files and track explicit physical moves in the right managed folder', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-main-custom-import-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const { ensureLibraryStructure } = require('./library.cjs');
  const library = path.join(root, 'library');
  await ensureLibraryStructure(library);
  const original = path.join(root, '原稿.png');
  await fs.writeFile(original, 'picker original');
  const oldDirectory = path.join(library, '01_素材', '下载素材', '未分类');
  await fs.mkdir(oldDirectory);
  const first = path.join(oldDirectory, 'first.png');
  const second = path.join(oldDirectory, 'second.png');
  await fs.writeFile(first, 'organize original');
  await fs.writeFile(second, 'drop original');
  const desktop = await harness(root);
  try {
    await desktop.invoke('catalog:create-material-area', '我的作品');
    desktop.pick([original]);
    const copied = await desktop.invoke('library:pick-files-to-area', library, '我的作品', '未分类');
    assert.deepEqual(copied, [path.join(library, '01_素材', '我的作品', '未分类', '原稿.png')]);
    const imported = await desktop.invoke('library:import-files-to-area', library, [original], '我的作品', '平面');
    assert.deepEqual(imported, [path.join(library, '01_素材', '我的作品', '平面', '原稿.png')]);
    assert.equal(await fs.readFile(original, 'utf8'), 'picker original');
    await assert.rejects(desktop.invoke('library:import-files-to-area', library, [original], '../escape', '未分类'), /导入目标无效/);
    desktop.pick([first, second]);
    const linked = await desktop.invoke('catalog:link-files', '下载素材');
    const ids = linked.assets.map(asset => asset.id);
    await desktop.invoke('catalog:update-assets', ids, { note: 'retain metadata through moves' });
    const organized = await desktop.invoke('library:organize-files', library, [first], { area: '我的作品', category: '平面' });
    assert.equal(organized.error, '');
    assert.equal(organized.moves[0].destination, path.join(library, '01_素材', '我的作品', '平面', 'first.png'));
    const moved = await desktop.invoke('library:move-dropped-files', library, [second], path.join('01_素材', '我的作品', '平面'));
    assert.equal(moved.error, '');
    const refreshed = await desktop.invoke('catalog:refresh-references');
    for (const id of ids) {
      const asset = refreshed.assets.find(item => item.id === id);
      assert.equal(asset.area, '我的作品');
      assert.equal(asset.context.area, '我的作品');
      assert.equal(asset.context.category, '平面');
      assert.equal(asset.context.project, '');
      assert.equal(asset.note, 'retain metadata through moves');
      assert.equal(asset.online, true);
      assert.equal(path.dirname(asset.fullPath), path.join(library, '01_素材', '我的作品', '平面'));
    }
    assert.equal(refreshed.settings.referenceRoots.every(source => source.area === '我的作品'), true);
    const scanned = await desktop.invoke('library:scan', library);
    assert.equal(scanned.files.length, 4);
    assert.equal(scanned.files.every(file => !file.categoryPath.includes('我的作品')), true);
  } finally { desktop.close(); }
});

test('explicit inbox organization updates area and context only for successful originals', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-main-inbox-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const { ensureLibraryStructure } = require('./library.cjs');
  const libraryRoot = path.join(root, 'library');
  await ensureLibraryStructure(libraryRoot);
  const first = path.join(libraryRoot, '00_待整理', 'reference.png');
  await fs.writeFile(first, 'reference original');
  const desktop = await harness(root);
  try {
    const before = await desktop.invoke('catalog:reconcile', [{ ...descriptorForFile(first, await fs.stat(first), libraryRoot), area: '待整理', project: '', mode: '', category: '未分类' }], { complete: false });
    const id = before.assets[0].id;
    await desktop.invoke('catalog:update-assets', [id], { note: 'keep this note' });
    const moved = await desktop.invoke('library:organize-files', libraryRoot, [first, path.join(libraryRoot, '00_待整理', 'missing.png')], { area: '项目素材', project: 'Project A', mode: '参考素材', category: '图片' });
    assert.equal(moved.moves.length, 1);
    assert.ok(moved.error);
    const after = await desktop.invoke('catalog:snapshot');
    const asset = after.assets.find(item => item.id === id);
    assert.equal(asset.area, '项目素材');
    assert.equal(asset.context.project, 'Project A');
    assert.equal(asset.context.mode, '参考素材');
    assert.equal(asset.context.category, '图片');
    assert.equal(asset.note, 'keep this note');
    assert.equal(await fs.readFile(asset.fullPath, 'utf8'), 'reference original');
  } finally { desktop.close(); }
});

test('explicit recycle-bin deletion forgets only successful files and never resurrects them as offline assets', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-main-trash-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const originals = path.join(root, 'originals');
  await fs.mkdir(originals);
  const removed = path.join(originals, 'removed.png');
  const locked = path.join(originals, 'locked.png');
  await fs.writeFile(removed, 'removed original');
  await fs.writeFile(locked, 'locked original');
  const desktop = await harness(root, { trashItem: async filePath => {
    if (filePath === locked) throw new Error('file is locked');
    await fs.rename(filePath, path.join(root, 'recycled.png'));
  } });
  try {
    desktop.pick([removed, locked]);
    const linked = await desktop.invoke('catalog:link-files', '下载素材');
    await desktop.invoke('catalog:update-assets', linked.assets.map(asset => asset.id), { note: 'keep failed file metadata' });
    const result = await desktop.invoke('library:trash-files', originals, [removed, locked]);
    assert.deepEqual(result.deleted, [removed]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].path, locked);
    const snapshot = await desktop.invoke('catalog:snapshot');
    assert.equal(snapshot.assets.length, 1);
    assert.equal(snapshot.assets[0].fullPath, locked);
    assert.equal(snapshot.assets[0].online, true);
    assert.equal(snapshot.assets[0].note, 'keep failed file metadata');
    assert.deepEqual(snapshot.settings.referenceRoots[0].paths, [locked]);
    const refreshed = await desktop.invoke('catalog:refresh-references');
    assert.equal(refreshed.assets.length, 1);
    assert.equal(refreshed.assets[0].fullPath, locked);
    assert.equal(await fs.readFile(locked, 'utf8'), 'locked original');
    assert.equal(await fs.readFile(path.join(root, 'recycled.png'), 'utf8'), 'removed original');
  } finally { desktop.close(); }
});
