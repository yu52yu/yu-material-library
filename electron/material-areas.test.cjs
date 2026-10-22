const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_AREAS, listMaterialAreas, isMaterialArea, validateMaterialAreaName } = require("./material-areas.cjs");

test("material area names retain display text while duplicates compare normalized case", () => {
  assert.deepEqual(DEFAULT_AREAS, ["下载素材", "AI制作素材"]);
  assert.equal(validateMaterialAreaName("  作品素材  "), "作品素材");
  assert.equal(validateMaterialAreaName("Textures"), "Textures");
  for (const name of ["textures", "Ｔｅｘｔｕｒｅｓ", "TEXTURES"]) {
    assert.throws(() => validateMaterialAreaName(name, ["Textures"]), /同名/);
  }
  assert.throws(() => validateMaterialAreaName("ＡＩ制作素材"), /同名/);
});

test("material area validation rejects reserved sections and unsafe Windows folder names", () => {
  for (const name of [null, 1, "", " ", "　", "项目素材", "待整理", "全部", "关联素材", "我的收藏", "全库搜索",
    ".", "..", "...", "结束.", "．", "a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b",
    "a\0b", "a\nb", "CON", "con.txt", "NUL", "PRN", "aux.json", "COM1", "lpt9.svg", "ＣＯＮ", "COM¹",
    "名".repeat(41)]) {
    assert.throws(() => validateMaterialAreaName(name), `expected invalid name: ${JSON.stringify(name)}`);
  }
  for (const name of ["作品素材", "纹理与贴图", "个人作品 2026", "COM10", "icons.v2", "名".repeat(40)]) {
    assert.equal(validateMaterialAreaName(name), name);
  }
});

test("listing areas excludes malformed or duplicate saved values and membership uses exact persisted names", () => {
  const custom = ["作品素材", "Textures", "textures", "ＡＩ制作素材", "../escape", null, "全部"];
  assert.deepEqual(listMaterialAreas(custom), ["下载素材", "AI制作素材", "作品素材", "Textures"]);
  assert.deepEqual(listMaterialAreas(undefined), DEFAULT_AREAS);
  assert.deepEqual(listMaterialAreas({}), DEFAULT_AREAS);
  assert.equal(isMaterialArea("下载素材"), true);
  assert.equal(isMaterialArea("作品素材", custom), true);
  assert.equal(isMaterialArea("Textures", custom), true);
  assert.equal(isMaterialArea("textures", custom), false);
  assert.equal(isMaterialArea("项目素材", custom), false);
  assert.equal(isMaterialArea("../escape", custom), false);
  assert.deepEqual(custom, ["作品素材", "Textures", "textures", "ＡＩ制作素材", "../escape", null, "全部"]);
});
