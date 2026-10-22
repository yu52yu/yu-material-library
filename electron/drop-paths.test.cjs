const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { resolveDroppedPaths } = require("./drop-paths.cjs");

const windows = process.platform === "win32";
const windowsTest = (name, callback) => test(name, { skip: !windows }, callback);
const sample = path.resolve("拖入测试", "金鱼 图片.png");
const sampleUrl = pathToFileURL(sample).href;

windowsTest("keeps Windows drive paths and normalizes separators and dot segments", () => {
  assert.deepEqual(resolveDroppedPaths({ paths: [
    "C:\\Users\\设计师\\Downloads\\金鱼 图片.png",
    "D:/素材/临时/../成品.png",
  ] }), [
    path.resolve("C:\\Users\\设计师\\Downloads\\金鱼 图片.png"),
    path.resolve("D:/素材/成品.png"),
  ]);
});

windowsTest("accepts UNC paths and file URLs using the platform URL conversion", () => {
  assert.deepEqual(resolveDroppedPaths({ paths: ["\\\\server\\share\\金鱼 图片.png"],
    uriList: "file://server/share/%E5%85%B6%E4%BB%96%20%E5%9B%BE.png" }), [
    path.resolve("\\\\server\\share\\金鱼 图片.png"),
    path.resolve("\\\\server\\share\\其他 图.png"),
  ]);
});

test("decodes local file URLs while preserving Chinese, spaces, percent and hash characters", () => {
  const filePath = path.resolve("拖入测试", "金鱼 空格 100% #1.png");
  assert.deepEqual(resolveDroppedPaths({ uriList: pathToFileURL(filePath).href }), [filePath]);
});

test("reads URI lists and ignores comments, blank lines and remote URLs", () => {
  assert.deepEqual(resolveDroppedPaths({ uriList: [
    "# File drag payload", "", " https://example.com/image.png ",
    sampleUrl, "  # ignored comment", "file:///bad%ZZ.png",
  ].join("\r\n") }), [sample]);
});

windowsTest("reads quoted absolute paths and local URLs from newline-separated plain text", () => {
  assert.deepEqual(resolveDroppedPaths({ text: [
    '"C:\\下载\\喂鱼器 合成.png"', "relative.png", sampleUrl,
  ].join("\n") }), [path.resolve("C:\\下载\\喂鱼器 合成.png"), sample]);
});

test("reads a file DownloadURL without truncating the drive colon", () => {
  assert.deepEqual(resolveDroppedPaths({
    downloadUrl: `image/png:金鱼 图片.png:${sampleUrl}`,
  }), [sample]);
});

test("rejects DownloadURL network payloads and malformed descriptors", () => {
  for (const downloadUrl of [
    "image/png:金鱼.png:https://example.com:8443/image.png",
    "image/png:金鱼.png:blob:https://example.com/id",
    "image/png:金鱼.png:data:image/png;base64,abcd",
    `image/png:${sampleUrl}`, `:${sampleUrl}`, `image/png::${sampleUrl}`,
  ]) assert.deepEqual(resolveDroppedPaths({ downloadUrl }), []);
});

windowsTest("deduplicates Windows paths case-insensitively across all payload formats", () => {
  const nativePath = "C:\\Downloads\\金鱼 图片.png";
  assert.deepEqual(resolveDroppedPaths({
    paths: [nativePath, "c:/downloads/金鱼 图片.png"],
    uriList: "file:///C:/Downloads/%E9%87%91%E9%B1%BC%20%E5%9B%BE%E7%89%87.png",
    text: nativePath,
    downloadUrl: `image/png:金鱼 图片.png:${pathToFileURL(nativePath).href}`,
  }), [path.resolve(nativePath)]);
});

test("rejects nonlocal schemes, relative paths and Windows drive-relative paths", () => {
  assert.deepEqual(resolveDroppedPaths({ paths: [
    "http://example.com/a.png", "https://example.com/a.png", "blob:abc", "data:image/png,abc",
    "javascript:alert(1)", "relative.png", "./relative.png", "../relative.png",
    "C:relative.png", "\\Downloads\\image.png", "file:relative.png", "/plain-posix-path.png",
  ] }), []);
});

test("rejects NUL and malformed percent encodings without losing valid batch entries", () => {
  assert.deepEqual(resolveDroppedPaths({ paths: [
    null, 42, "", "C:\\bad\0.png", "file:///C:/bad%00.png", "file:///C:/bad%ZZ.png",
    "file:///C:/bad%E0%A4.png", "file:///C:/bad%2Fname.png", "file:///C:/bad%5Cname.png",
    sampleUrl,
  ] }), [sample]);
});

test("rejects unescaped URL query or fragment rather than importing a different filename", () => {
  assert.deepEqual(resolveDroppedPaths({ paths: [`${sampleUrl}?download=1`, `${sampleUrl}#preview`] }), []);
});

windowsTest("preserves native filename percent sequences instead of treating them as URL encoding", () => {
  const nativePath = "C:\\Downloads\\100% 图片%ZZ.png";
  assert.deepEqual(resolveDroppedPaths({ paths: [nativePath] }), [path.resolve(nativePath)]);
});

test("empty or malformed payloads produce an empty list", () => {
  for (const payload of [undefined, null, "", 42, {}, { paths: "not an array", uriList: [], text: null, downloadUrl: 5 }]) {
    assert.deepEqual(resolveDroppedPaths(payload), []);
  }
});
