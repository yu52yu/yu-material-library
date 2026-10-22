import assert from "node:assert/strict";
import test from "node:test";
import { categoryBreadcrumb, categoryDescendants, matchesCatalogAsset, mediaTypeFor, parseCatalogTags } from "../src/catalog-view.js";

const categories = [
  { id: "animals", name: "动物", area: "下载素材", parentId: null },
  { id: "fish", name: "鱼", area: "下载素材", parentId: "animals" },
  { id: "marine", name: "海水鱼", area: "下载素材", parentId: "fish" },
  { id: "cat", name: "猫", area: "下载素材", parentId: "animals" },
  { id: "underwater", name: "水下镜头", area: "下载素材", parentId: null },
  { id: "ai", name: "AI分类", area: "AI制作素材", parentId: "animals" },
];
const asset = { id: "uuid", name: "fish-school.MP4", displayName: "鱼群游动", fullPath: "D:\\下载\\fish-school.MP4", categoryIds: ["marine", "underwater"], tags: ["慢镜头", "Blue water"], note: "详情页背景，参考灯光", favorite: true, online: false };

test("video, image, source and other file types are independent of names and case", () => {
  for (const [value, kind] of [[".MP4", "video"], ["C:\\片段\\鱼.MOV", "video"], ["JPEG", "image"], ["a.blend", "source"], ["a.PSD", "source"], ["a.svg", "image"], ["x.pdf", "document"], ["otf", "font"], ["x.flac", "audio"], ["foo.xyz", "other"], [undefined, "other"]]) assert.equal(mediaTypeFor(value), kind);
});

test("category ancestors aggregate descendants without crossing areas", () => {
  assert.deepEqual(categoryDescendants(categories, "animals"), ["animals", "fish", "cat", "marine"]);
  assert.deepEqual(categoryDescendants(categories, "fish"), ["fish", "marine"]);
  assert.deepEqual(categoryDescendants(categories, "missing"), []);
  assert.equal(categoryBreadcrumb(categories, "marine"), "动物 / 鱼 / 海水鱼");
  assert.equal(categoryBreadcrumb(categories, "ai"), "AI分类");
  assert.equal(categoryBreadcrumb(null, "missing"), "");
  const cyclic = [{ id: "a", name: "甲", parentId: "b" }, { id: "b", name: "乙", parentId: "a" }];
  assert.deepEqual(categoryDescendants(cyclic, "a"), ["a", "b"]);
  assert.equal(categoryBreadcrumb(cyclic, "a"), "乙 / 甲");
});

test("multiword tags remain intact, unicode separators and duplicate casing are normalized", () => {
  assert.deepEqual(parseCatalogTags(" blue water,猫，鱼\n慢镜头；BLUE WATER、 猫\n白色　背景 "), ["blue water", "猫", "鱼", "慢镜头", "白色　背景"]);
  assert.deepEqual(parseCatalogTags([" 猫 ", "鱼", "猫", null]), ["猫", "鱼"]);
});

test("search combines filename, display name, notes, tags, full path and category ancestors with AND terms", () => {
  for (const query of ["鱼群 灯光", "动物 slow".replace("slow", "慢镜头"), "BLUE WATER", "d:\\下载", "海水鱼 MP4"]) assert.equal(matchesCatalogAsset(asset, { query, categories }), true, query);
  assert.equal(matchesCatalogAsset(asset, { query: "鱼群 不存在", categories }), false);
  assert.equal(matchesCatalogAsset(asset, { query: "fish-school", categories }), true);
});

test("type, favorite, tags and category conditions compose and preserve offline entries", () => {
  const options = { categories, categoryId: "animals", mediaType: "video", favoritesOnly: true, tags: ["Blue water", "慢镜头"], query: "灯光" };
  assert.equal(matchesCatalogAsset(asset, options), true);
  assert.equal(matchesCatalogAsset(asset, { ...options, categoryId: "cat" }), false);
  assert.equal(matchesCatalogAsset(asset, { ...options, tags: ["Blue"] }), false);
  assert.equal(matchesCatalogAsset(asset, { ...options, mediaType: "image" }), false);
  assert.equal(matchesCatalogAsset({ ...asset, favorite: false }, options), false);
  assert.equal(matchesCatalogAsset(asset, { categories, categoryId: "underwater" }), true);
  assert.equal(matchesCatalogAsset(asset, { categories, categoryId: "uncategorized" }), false);
  assert.equal(matchesCatalogAsset({ ...asset, categoryIds: [] }, { categoryId: "uncategorized" }), true);
  assert.equal(matchesCatalogAsset({ ...asset, categoryIds: [] }, { categoryId: "未分类" }), true);
  assert.equal(matchesCatalogAsset(null), false);
});
