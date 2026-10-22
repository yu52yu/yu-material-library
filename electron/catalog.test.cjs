const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createCatalog, validateCatalogBackup } = require("./catalog.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yu-catalog-test-"));
  const originals = path.join(directory, "originals");
  const storage = path.join(directory, "catalog");
  fs.mkdirSync(originals);
  const catalogs = [];
  function open(location = storage) { const catalog = createCatalog(location); catalogs.push(catalog); return catalog; }
  t.after(() => { for (const catalog of catalogs) catalog.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  function file(name, contents = "original untouched bytes") {
    const fullPath = path.join(originals, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
    return fullPath;
  }
  function entry(fullPath, extra = {}) {
    const stat = fs.statSync(fullPath);
    return { fullPath, rootPath: originals, name: path.basename(fullPath), size: stat.size, modified: stat.mtimeMs,
      fileKey: `${stat.dev}:${stat.ino}`, area: "下载素材", ...extra };
  }
  return { directory, originals, storage, open, file, entry };
}
const hash = (filename) => createHash("sha256").update(fs.readFileSync(filename)).digest("hex");

test("durable UUID metadata, multiple memberships and hierarchy never change original files", (t) => {
  const f = fixture(t);
  const filename = f.file("fish.mp4", Buffer.from([0, 255, 14, 19, 200]));
  const original = { hash: hash(filename), stat: fs.statSync(filename) };
  const catalog = f.open();
  const asset = catalog.reconcile([f.entry(filename, { context: { relativePath: "fish.mp4", isImage: false }, categoryPath: ["动物", "鱼"] })], { rootPath: f.originals }).assets[0];
  assert.match(asset.id, /^[\da-f-]{36}$/i);
  assert.equal(asset.mediaType, "video");
  const underwater = catalog.createCategory({ area: "下载素材", name: "水下镜头" });
  catalog.assignCategories([asset.id], [underwater.id]);
  catalog.updateAssets([asset.id], { displayName: "鱼群游动", note: "详情页背景", favorite: true, tags: ["蓝色", "慢镜头", "蓝色"] });
  const expected = catalog.snapshot();
  assert.equal(expected.assets[0].categoryIds.length, 2);
  assert.deepEqual(expected.assets[0].tags, ["蓝色", "慢镜头"]);
  assert.equal(expected.assets[0].context.relativePath, "fish.mp4");
  assert.equal(hash(filename), original.hash);
  assert.equal(fs.statSync(filename).mtimeMs, original.stat.mtimeMs);
  assert.deepEqual(fs.readdirSync(f.originals), ["fish.mp4"]);
  catalog.close();
  assert.deepEqual(f.open().snapshot(), expected);
});

test("category validation rejects cycles, duplicate siblings and cross-area parenting atomically", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const animals = catalog.createCategory({ area: "下载素材", name: "动物" });
  const fish = catalog.createCategory({ area: "下载素材", name: "鱼", parentId: animals.id });
  const tropical = catalog.createCategory({ area: "下载素材", name: "热带鱼", parentId: fish.id });
  const other = catalog.createCategory({ area: "AI制作素材", name: "动物" });
  const before = catalog.snapshot();
  for (const action of [
    () => catalog.updateCategory(animals.id, { parentId: tropical.id }),
    () => catalog.updateCategory(fish.id, { parentId: fish.id }),
    () => catalog.updateCategory(fish.id, { parentId: other.id }),
    () => catalog.createCategory({ area: "下载素材", name: "鱼", parentId: animals.id }),
    () => catalog.createCategory({ area: "下载素材", name: "错误", parentId: "missing" }),
    () => catalog.updateCategory(fish.id, { area: "AI制作素材" }),
  ]) { assert.throws(action); assert.deepEqual(catalog.snapshot(), before); }
  catalog.updateCategory(tropical.id, { name: "观赏鱼", parentId: animals.id });
  assert.equal(catalog.snapshot().categories.find((row) => row.id === tropical.id).parentId, animals.id);
});

test("deleting a category removes descendants and assignments while retaining materials and metadata", (t) => {
  const f = fixture(t);
  const file = f.file("cat.png");
  const catalog = f.open();
  const state = catalog.reconcile([f.entry(file, { categoryPath: ["动物", "猫", "短毛猫"] })]);
  const id = state.assets[0].id;
  const unrelated = catalog.createCategory({ area: "下载素材", name: "可爱" });
  catalog.assignCategories([id], [unrelated.id]);
  catalog.updateAssets([id], { note: "保留", favorite: true });
  const after = catalog.deleteCategory(state.categories.find((category) => category.name === "动物").id);
  assert.deepEqual(after.categories, [unrelated]);
  assert.deepEqual(after.assets[0].categoryIds, [unrelated.id]);
  assert.equal(after.assets[0].note, "保留");
  assert.equal(fs.existsSync(file), true);
  catalog.reconcile([f.entry(file, { categoryPath: ["动物", "猫", "短毛猫"] })]);
  assert.deepEqual(catalog.snapshot().categories, [unrelated]);
});

test("batch updates and assignments validate the whole selection before any mutation", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const state = catalog.reconcile([f.entry(f.file("one.png")), f.entry(f.file("two.mp4"))]);
  const ids = state.assets.map((asset) => asset.id);
  const a = catalog.createCategory({ area: "下载素材", name: "参考" });
  const b = catalog.createCategory({ area: "AI制作素材", name: "参考" });
  const before = catalog.snapshot();
  assert.throws(() => catalog.updateAssets([ids[0], "missing"], { note: "不可部分写入" }));
  assert.throws(() => catalog.assignCategories(ids, [a.id, "missing"]));
  assert.throws(() => catalog.assignCategories(ids, [a.id, b.id]));
  assert.throws(() => catalog.updateAssets(ids, { favorite: "yes" }));
  assert.throws(() => catalog.updateAssets(ids, { tags: ["valid", 3] }));
  assert.deepEqual(catalog.snapshot(), before);
  catalog.assignCategories(ids, [a.id], { mode: "replace" });
  assert.ok(catalog.snapshot().assets.every((asset) => asset.categoryIds[0] === a.id));
  catalog.assignCategories([ids[0]], [a.id], { mode: "remove" });
  catalog.updateAssets([ids[1]], { area: "AI制作素材" });
  assert.ok(catalog.snapshot().assets.every((asset) => asset.categoryIds.length === 0));
});

test("new arrivals follow renamed or moved virtual categories; deleted category mappings stay deleted", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const first = catalog.reconcile([f.entry(f.file("first.png"), { categoryPath: ["动物", "鱼"] })]);
  const animals = first.categories.find((category) => category.name === "动物");
  const fish = first.categories.find((category) => category.name === "鱼");
  const newParent = catalog.createCategory({ area: "下载素材", name: "水族" });
  catalog.updateCategory(animals.id, { name: "生物" });
  catalog.updateCategory(fish.id, { name: "观赏鱼", parentId: newParent.id });
  const secondFile = f.file("second.mp4");
  const second = catalog.reconcile([f.entry(secondFile, { categoryPath: ["动物", "鱼"] })], { complete: false });
  assert.equal(second.categories.length, 3);
  assert.deepEqual(second.assets.find((asset) => asset.fullPath === secondFile).categoryIds, [fish.id]);
  catalog.deleteCategory(fish.id);
  const backup = path.join(f.directory, "deleted-seeds.json");
  catalog.backup(backup);
  const restored = f.open(path.join(f.directory, "restored-seeds"));
  restored.restore(backup);
  const thirdFile = f.file("third.png");
  const third = restored.reconcile([f.entry(thirdFile, { categoryPath: ["动物", "鱼", "金鱼"] })], { complete: false });
  assert.equal(third.categories.length, 2);
  assert.deepEqual(third.assets.find((asset) => asset.fullPath === thirdFile).categoryIds, []);
  assert.ok(!third.categories.some((category) => ["动物", "鱼", "金鱼"].includes(category.name)));
});

test("a moved child keeps its source mapping after its former virtual parent is deleted", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const first = catalog.reconcile([f.entry(f.file("first.png"), { categoryPath: ["动物", "鱼"] })]);
  const animals = first.categories.find((category) => category.name === "动物");
  const fish = first.categories.find((category) => category.name === "鱼");
  catalog.updateCategory(fish.id, { parentId: null });
  catalog.deleteCategory(animals.id);
  const next = f.file("next.mp4");
  const state = catalog.reconcile([f.entry(next, { categoryPath: ["动物", "鱼"] })], { complete: false });
  assert.deepEqual(state.categories.map((category) => category.id), [fish.id]);
  assert.deepEqual(state.assets.find((asset) => asset.fullPath === next).categoryIds, [fish.id]);
});

test("an overwrite at the same path keeps UUID and classifications while refreshing file facts", (t) => {
  const f = fixture(t);
  const file = f.file("render.png", "v1");
  const catalog = f.open();
  const first = catalog.reconcile([f.entry(file, { fileKey: "old-inode", categoryPath: ["渲染"] })]).assets[0];
  catalog.updateAssets([first.id], { note: "选定图", tags: ["灯光"] });
  fs.writeFileSync(file, "overwritten content v2");
  const after = catalog.reconcile([f.entry(file, { fileKey: "new-inode", categoryPath: ["different physical directory"] })]).assets[0];
  assert.equal(after.id, first.id);
  assert.equal(after.note, "选定图");
  assert.equal(after.size, fs.statSync(file).size);
  assert.deepEqual(after.categoryIds, first.categoryIds);
  assert.equal(catalog.snapshot().categories.length, 1);
});

test("unique native identity follows an external rename and updates every project link", (t) => {
  const f = fixture(t);
  const original = f.file("before.png");
  const catalog = f.open();
  const first = catalog.reconcile([f.entry(original, { categoryPath: ["猫"] })]).assets[0];
  catalog.updateAssets([first.id], { note: "跟随重命名", favorite: true });
  catalog.setSetting("projectLinks", { version: 1, groups: [{ id: "g", createdAt: 1, members: [{ id: original, name: "before.png", role: "参考图" }] }] });
  const destination = path.join(f.originals, "after.png");
  fs.renameSync(original, destination);
  // New-path events can precede the old-path deletion event; stored online=true must not prevent recognition.
  const after = catalog.reconcile([f.entry(destination)], { rootPath: f.originals, complete: false, replacedPath: destination });
  assert.equal(after.assets.length, 1);
  assert.equal(after.assets[0].id, first.id);
  assert.equal(after.assets[0].fullPath, destination);
  assert.equal(after.assets[0].note, "跟随重命名");
  assert.deepEqual(after.settings.projectLinks.groups[0].members[0], { id: destination, name: "after.png", role: "参考图" });
  catalog.reconcile([], { rootPath: f.originals, complete: false, replacedPath: original });
  assert.equal(catalog.snapshot().assets[0].online, true);
});

test("ambiguous native identities and still-existing original paths never merge unrelated records", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const a = f.file("a.png"), b = f.file("b.png");
  catalog.reconcile([f.entry(a, { fileKey: "ambiguous" }), f.entry(b, { fileKey: "ambiguous" })]);
  fs.unlinkSync(a);
  const c = f.file("c.png");
  const after = catalog.reconcile([f.entry(b, { fileKey: "ambiguous" }), f.entry(c, { fileKey: "ambiguous" })], { rootPath: f.originals });
  assert.equal(after.assets.length, 3);
  assert.equal(after.assets.find((asset) => asset.fullPath === a).online, false);
  const d = f.file("d.png"), e = f.file("e.png");
  catalog.reconcile([f.entry(d, { fileKey: "one-identity" })], { complete: false });
  catalog.reconcile([f.entry(e, { fileKey: "one-identity" })], { complete: false });
  assert.equal(catalog.snapshot().assets.length, 5);
});

test("offline root scans retain metadata/context and do not affect independently connected roots", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const first = f.file("project/render.png");
  const second = f.file("download/fish.mp4");
  const projectRoot = path.dirname(first), downloadRoot = path.dirname(second);
  catalog.reconcile([f.entry(first, { rootPath: projectRoot, context: { project: "独立项目", category: "渲染图", relativePath: "render.png" } })], { rootPath: projectRoot });
  catalog.reconcile([f.entry(second, { rootPath: downloadRoot })], { rootPath: downloadRoot });
  const after = catalog.reconcile([], { rootPath: projectRoot });
  assert.equal(after.assets[0].online, false);
  assert.equal(after.assets[0].context.project, "独立项目");
  assert.equal(after.assets[1].online, true);
  catalog.reconcile([f.entry(first, { rootPath: projectRoot })], { rootPath: projectRoot });
  assert.equal(catalog.snapshot().assets[0].online, true);
});

test("incremental deletion marks only missing members of the affected subtree offline", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const a = f.file("animals/a.png"), b = f.file("animals/b.png"), c = f.file("other/c.png");
  catalog.reconcile([a, b, c].map((filename) => f.entry(filename)));
  fs.unlinkSync(a); fs.unlinkSync(c);
  const state = catalog.reconcile([], { rootPath: f.originals, complete: false, replacedPath: path.dirname(a) });
  assert.equal(state.assets.find((asset) => asset.fullPath === a).online, false);
  assert.equal(state.assets.find((asset) => asset.fullPath === b).online, true);
  assert.equal(state.assets.find((asset) => asset.fullPath === c).online, true);
  catalog.markDeleted([c]);
  assert.equal(catalog.snapshot().assets.find((asset) => asset.fullPath === c).online, false);
});

test("one-time legacy migration retains raw settings and applies delayed metadata after reopen", (t) => {
  const f = fixture(t);
  const known = f.file("known.png"), late = path.join(f.originals, "late.mp4");
  let catalog = f.open();
  const id = catalog.reconcile([f.entry(known, { categoryPath: ["旧分类"] })]).assets[0].id;
  const legacy = { favorites: [known, late], notes: { [known]: "已载入", [late]: "稍后连接" },
    projectLinks: { version: 1, groups: [{ id: "g", members: [{ id: late, name: "late.mp4" }] }] },
    categoryLabels: { [JSON.stringify(["下载素材", "", "", "旧分类"])]: "已命名分类" },
    categoryOrders: { "下载素材": ["旧分类"] }, rootPath: f.originals, linkedProjects: [{ path: "unavailable" }] };
  catalog.migrateLegacy(legacy);
  assert.deepEqual(catalog.getSetting("legacyBackup"), legacy);
  assert.equal(catalog.snapshot().assets[0].favorite, true);
  assert.equal(catalog.snapshot().categories[0].name, "已命名分类");
  catalog.updateAssets([id], { note: "用户新备注", favorite: false });
  catalog.updateCategory(catalog.snapshot().categories[0].id, { name: "再次改名" });
  catalog.migrateLegacy(legacy);
  assert.equal(catalog.snapshot().assets[0].note, "用户新备注");
  assert.equal(catalog.snapshot().assets[0].favorite, false);
  catalog.close(); catalog = f.open();
  f.file("late.mp4");
  const state = catalog.reconcile([f.entry(late, { categoryPath: ["旧分类"] })], { complete: false });
  const loaded = state.assets.find((asset) => asset.fullPath === late);
  assert.equal(loaded.favorite, true);
  assert.equal(loaded.note, "稍后连接");
  assert.equal(state.categories.length, 1);
  assert.equal(state.categories[0].name, "再次改名");
  assert.deepEqual(state.settings.projectLinks, legacy.projectLinks);
  assert.deepEqual(state.settings.linkedProjects, legacy.linkedProjects);
});

test("explicit remapping supports swaps and moves deferred metadata/project references together", (t) => {
  const f = fixture(t);
  const a = f.file("a.png"), b = f.file("b.png");
  const catalog = f.open();
  const state = catalog.reconcile([f.entry(a), f.entry(b)]);
  catalog.updateAssets([state.assets[0].id], { note: "asset A" });
  catalog.updateAssets([state.assets[1].id], { note: "asset B" });
  const lateA = path.join(f.originals, "late-a.png"), lateB = path.join(f.originals, "late-b.png");
  catalog.migrateLegacy({ notes: { [lateA]: "late A", [lateB]: "late B" }, projectLinks: { version: 1, groups: [{ id: "g", members: [{ id: a }, { id: lateA }] }] } });
  const after = catalog.remapPaths([{ source: a, destination: b }, { source: b, destination: a },
    { source: lateA, destination: lateB }, { source: lateB, destination: lateA }]);
  assert.equal(after.assets.find((asset) => asset.fullPath === b).note, "asset A");
  assert.equal(after.assets.find((asset) => asset.fullPath === a).note, "asset B");
  f.file("late-a.png"); f.file("late-b.png");
  const loaded = catalog.reconcile([f.entry(lateA), f.entry(lateB)], { complete: false });
  assert.equal(loaded.assets.find((asset) => asset.fullPath === lateB).note, "late A");
  assert.equal(loaded.assets.find((asset) => asset.fullPath === lateA).note, "late B");
  assert.deepEqual(loaded.settings.projectLinks.groups[0].members.map((member) => member.id), [b, lateB]);
});

test("manual relink preserves UUID and organization and rejects linking to an existing asset", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const a = f.file("a.png"), b = f.file("b.png");
  const state = catalog.reconcile([f.entry(a, { categoryPath: ["动物"] }), f.entry(b)]);
  catalog.updateAssets([state.assets[0].id], { note: "保留", displayName: "显示名称", tags: ["标签"] });
  const before = catalog.snapshot();
  assert.throws(() => catalog.relink(state.assets[0].id, f.entry(b)));
  assert.deepEqual(catalog.snapshot(), before);
  const c = f.file("c.png");
  catalog.markDeleted([a]);
  const after = catalog.relink(state.assets[0].id, f.entry(c));
  assert.equal(after.assets.length, 2);
  assert.equal(after.assets[0].fullPath, c);
  assert.equal(after.assets[0].id, state.assets[0].id);
  assert.equal(after.assets[0].displayName, "显示名称");
  assert.deepEqual(after.assets[0].categoryIds, state.assets[0].categoryIds);
  assert.equal(after.assets[0].online, true);
});

test("portable backup restores every row and delayed migration without copying originals", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const a = f.file("fish.mp4");
  const late = path.join(f.originals, "late.png");
  const asset = catalog.reconcile([f.entry(a, { categoryPath: ["动物", "鱼"], context: { category: "鱼", isImage: false } })]).assets[0];
  catalog.updateAssets([asset.id], { displayName: "鱼群", note: "透明背景？", tags: ["水下"], favorite: true });
  catalog.setSetting("referenceRoots", [{ path: f.originals }]);
  catalog.migrateLegacy({ notes: { [late]: "待连接" } });
  const expected = catalog.snapshot();
  const backup = path.join(f.directory, "backup.json");
  assert.deepEqual(catalog.backup(backup), { path: backup, assetCount: 1, categoryCount: 2 });
  const parsed = validateCatalogBackup(fs.readFileSync(backup, "utf8"));
  assert.equal(parsed.data.assets[0].fileKey, f.entry(a).fileKey);
  const restored = f.open(path.join(f.directory, "restored"));
  assert.deepEqual(restored.restore(backup), expected);
  f.file("late.png");
  assert.equal(restored.reconcile([f.entry(late)], { complete: false }).assets[1].note, "待连接");
  assert.deepEqual(fs.readdirSync(f.originals).sort(), ["fish.mp4", "late.png"]);
  assert.throws(() => catalog.backup(a), /原始素材/);
  assert.throws(() => catalog.backup(path.join(f.storage, "catalog.sqlite")), /资料库/);
});

test("invalid backups leave the active catalog unchanged and restore failure rolls back transaction", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const a = f.file("a.png");
  const asset = catalog.reconcile([f.entry(a, { categoryPath: ["动物", "鱼"] })]).assets[0];
  catalog.updateAssets([asset.id], { note: "可靠保留" });
  const before = catalog.snapshot();
  const validFile = path.join(f.directory, "valid.json");
  catalog.backup(validFile);
  const valid = JSON.parse(fs.readFileSync(validFile, "utf8"));
  const invalids = ["broken", {}, { ...valid, version: 2 }];
  for (const change of [
    (data) => { data.categories[0].parentId = data.categories[1].id; },
    (data) => { data.categories[1].area = "AI制作素材"; },
    (data) => { data.assets.push({ ...data.assets[0], id: "different-id" }); },
    (data) => { data.assets[0].categoryIds = ["nonexistent"]; },
    (data) => { data.assets[0].tags = ["one", "one"]; },
    (data) => { data.assets[0].online = 1; },
    (data) => { data.categories[0].id = " padded "; },
    (data) => { delete data.assets[0].size; },
    (data) => { data.categorySeeds[0].categoryId = "nonexistent"; },
    (data) => { data.categorySeeds.push(data.categorySeeds[0]); },
  ]) { const copy = structuredClone(valid); change(copy.data); invalids.push(copy); }
  const invalidFile = path.join(f.directory, "invalid.json");
  for (const invalid of invalids) {
    fs.writeFileSync(invalidFile, typeof invalid === "string" ? invalid : JSON.stringify(invalid));
    assert.throws(() => catalog.restore(invalidFile));
    assert.deepEqual(catalog.snapshot(), before);
  }
  // Inject a database write failure after successful validation to exercise transaction rollback.
  const external = new DatabaseSync(path.join(f.storage, "catalog.sqlite"));
  external.exec("CREATE TRIGGER injected_restore_failure BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");
  external.close();
  assert.doesNotThrow(() => validateCatalogBackup(valid));
  assert.throws(() => catalog.restore(validFile), /injected write failure/);
  assert.deepEqual(catalog.snapshot(), before);
  assert.equal(hash(a), createHash("sha256").update("original untouched bytes").digest("hex"));
});

test("settings validate JSON and closing/reopening is safe", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  catalog.setSetting("__proto__", { safe: true });
  assert.deepEqual(catalog.getSetting("__proto__"), { safe: true });
  assert.equal(Object.getPrototypeOf(catalog.snapshot().settings), Object.prototype);
  assert.throws(() => catalog.setSetting("bad", { missing: undefined }));
  assert.throws(() => catalog.setSetting("bad", Infinity));
  catalog.close(); catalog.close();
  assert.throws(() => catalog.snapshot(), /关闭/);
  assert.deepEqual(f.open().getSetting("__proto__"), { safe: true });
});

test("media type facts use the shared image/video/audio/source/document/font map", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const cases = { "photo.heic": "image", "camera.mts": "video", "voice.opus": "audio", "art.cdr": "source", "art.eps": "source", "data.csv": "document", "font.ttc": "font", "unknown.xyz": "other" };
  const state = catalog.reconcile(Object.keys(cases).map((name) => f.entry(f.file(name))));
  for (const asset of state.assets) assert.equal(asset.mediaType, cases[asset.name]);
});

test("explicit forgetting removes active metadata and memberships while offline marking retains them", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  const removed = f.file("removed.png"), retained = f.file("retained.png");
  const deferred = path.join(f.originals, "deferred.png");
  const initial = catalog.reconcile([f.entry(removed, { categoryPath: ["动物", "鱼"] }), f.entry(retained, { categoryPath: ["动物", "鱼"] })]);
  const removedId = initial.assets.find(asset => asset.fullPath === removed).id;
  const retainedId = initial.assets.find(asset => asset.fullPath === retained).id;
  catalog.updateAssets([removedId, retainedId], { favorite: true, note: "keep only when offline" });
  catalog.migrateLegacy({ notes: { [deferred]: "must not be reapplied" }, projectLinks: { version: 1, groups: [{ id: "g", members: [{ id: removed }, { id: retained }, { id: deferred }] }] } });
  catalog.setSetting("referenceRoots", [{ path: f.originals, kind: "files", area: "下载素材", paths: [removed, retained, deferred], fileKeys: { [removed]: "first", [retained]: "second" } }]);
  const before = catalog.snapshot();
  assert.throws(() => catalog.forgetPaths([removed, "relative.png"]));
  assert.deepEqual(catalog.snapshot(), before);
  catalog.markDeleted([retained]);
  const offline = catalog.snapshot().assets.find(asset => asset.id === retainedId);
  assert.equal(offline.online, false);
  assert.equal(offline.note, "keep only when offline");
  const forgotten = catalog.forgetPaths([removed, deferred]);
  assert.equal(forgotten.assets.length, 1);
  assert.equal(forgotten.assets[0].id, retainedId);
  assert.deepEqual(forgotten.settings.projectLinks.groups[0].members.map(member => member.id), [retained]);
  assert.deepEqual(forgotten.settings.referenceRoots[0].paths, [retained]);
  assert.deepEqual(forgotten.settings.referenceRoots[0].fileKeys, { [retained]: "second" });
  assert.equal(forgotten.categories.length, initial.categories.length);
  const external = new DatabaseSync(path.join(f.storage, "catalog.sqlite"));
  try {
    assert.equal(external.prepare("SELECT COUNT(*) AS count FROM asset_categories WHERE asset_id = ?").get(removedId).count, 0);
    assert.equal(external.prepare("SELECT COUNT(*) AS count FROM pending_legacy").get().count, 0);
    assert.deepEqual(external.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { external.close(); }
  const backup = path.join(f.directory, "after-forget.json");
  catalog.backup(backup);
  const payload = validateCatalogBackup(fs.readFileSync(backup, "utf8"));
  assert.deepEqual(payload.data.assets.map(asset => asset.id), [retainedId]);
  assert.deepEqual(payload.data.pendingLegacy, []);
  const restored = f.open(path.join(f.directory, "restored"));
  assert.deepEqual(restored.restore(backup), forgotten);
  f.file("deferred.png");
  const loaded = restored.reconcile([f.entry(removed), f.entry(deferred)], { complete: false });
  assert.notEqual(loaded.assets.find(asset => asset.fullPath === removed).id, removedId);
  assert.equal(loaded.assets.find(asset => asset.fullPath === removed).note, "");
  assert.equal(loaded.assets.find(asset => asset.fullPath === deferred).note, "");
  assert.equal(hash(removed), createHash("sha256").update("original untouched bytes").digest("hex"));
});
