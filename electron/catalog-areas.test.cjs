const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCatalog, validateCatalogBackup } = require("./catalog.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yu-custom-areas-test-"));
  const storage = path.join(directory, "catalog");
  const catalogs = [];
  function open(location = storage) {
    const catalog = createCatalog(location);
    catalogs.push(catalog);
    return catalog;
  }
  t.after(() => {
    for (const catalog of catalogs) catalog.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, storage, open };
}

test("creating reusable material areas persists names and ordering across a catalog restart", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  assert.deepEqual(catalog.createMaterialArea("  作品素材  ").settings.customAreas, ["作品素材"]);
  assert.deepEqual(catalog.createMaterialArea("纹理与贴图").settings.customAreas, ["作品素材", "纹理与贴图"]);
  const expected = catalog.snapshot();
  catalog.close();
  assert.deepEqual(f.open().snapshot(), expected);
});

test("invalid or duplicate reusable area creation leaves every catalog setting and asset intact", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  catalog.setSetting("theme", "light");
  catalog.createMaterialArea("Textures");
  const before = catalog.snapshot();
  for (const name of ["", " ", "下载素材", "ＡＩ制作素材", "textures", "Ｔｅｘｔｕｒｅｓ", "项目素材", "待整理",
    "全部", "关联素材", "../escape", "A:B", "nul.txt", "x".repeat(41)]) {
    assert.throws(() => catalog.createMaterialArea(name));
    assert.deepEqual(catalog.snapshot(), before);
  }
  catalog.close();
  assert.deepEqual(f.open().snapshot(), before);
});

test("backup restore retains reusable areas, categories, asset metadata and directory category mappings", (t) => {
  const f = fixture(t);
  const original = f.open();
  original.createMaterialArea("作品素材");
  const fullPath = path.join(f.directory, "poster.png");
  fs.writeFileSync(fullPath, "unchanged original material");
  const state = original.reconcile([{ fullPath, rootPath: f.directory, area: "作品素材", categoryPath: ["海报", "个人设计"] }]);
  original.updateAssets([state.assets[0].id], { displayName: "我的海报", note: "作品组件", tags: ["个人"], favorite: true });
  const expected = original.snapshot();
  const backup = path.join(f.directory, "backup.json");
  original.backup(backup);
  const payload = validateCatalogBackup(fs.readFileSync(backup, "utf8"));
  assert.deepEqual(payload.data.settings.customAreas, ["作品素材"]);
  assert.equal(payload.data.categorySeeds.length, 2);
  const restored = f.open(path.join(f.directory, "restored"));
  assert.deepEqual(restored.restore(backup), expected);
  const nextPath = path.join(f.directory, "poster-next.png");
  fs.writeFileSync(nextPath, "next material");
  const next = restored.reconcile([{ fullPath: nextPath, rootPath: f.directory, area: "作品素材", categoryPath: ["海报", "个人设计"] }], { complete: false });
  assert.equal(next.categories.length, 2);
  assert.deepEqual(next.assets.find((asset) => asset.fullPath === nextPath).categoryIds, expected.assets[0].categoryIds);
  assert.equal(fs.readFileSync(fullPath, "utf8"), "unchanged original material");
});

test("restoring malformed reusable area settings rejects the backup before changing the catalog", (t) => {
  const f = fixture(t);
  const catalog = f.open();
  catalog.createMaterialArea("作品素材");
  const before = catalog.snapshot();
  const backup = path.join(f.directory, "backup.json");
  catalog.backup(backup);
  const baseline = JSON.parse(fs.readFileSync(backup, "utf8"));
  for (const customAreas of [null, {}, ["下载素材"], ["../escape"], ["Textures", "textures"], ["  作品素材  "]]) {
    const payload = structuredClone(baseline);
    payload.data.settings.customAreas = customAreas;
    fs.writeFileSync(backup, JSON.stringify(payload));
    assert.throws(() => catalog.restore(backup));
    assert.deepEqual(catalog.snapshot(), before);
  }
});
