import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORY_DRAG_TYPE, isCategoryDrag, isFileDrag, fileDropEffect, snapshotFileDrop } from "../src/file-drop.js";
import { currentDropTarget } from "../src/drop-target.js";

// These are metadata-only fixtures. No test reads or writes a user's files.
const libraryRoot = "Z:\\drop-fixture\\素材库";
const projectRoot = "Z:\\drop-fixture\\外部项目";

test("desktop move drops remain accepted from copy-only browser download sources", () => {
  for (const effectAllowed of ["all", "uninitialized", "move", "copyMove", "linkMove"]) {
    assert.equal(fileDropEffect({ effectAllowed }, true), "move");
  }
  for (const effectAllowed of ["copy", "copyLink"]) {
    assert.equal(fileDropEffect({ effectAllowed }, true), "copy");
  }
  assert.equal(fileDropEffect({ effectAllowed: "link" }, true), "link");
  assert.equal(fileDropEffect({ effectAllowed: "all" }, false), "copy");
});
const projectFile = (relativePath, extra = {}) => ({
  area: "项目素材", project: "示例项目", mode: "制作素材", category: "合成", relativePath, ...extra,
});
const reusableFile = (relativePath, extra = {}) => ({
  area: "下载素材", category: "图片", relativePath, ...extra,
});
const target = (extra = {}) => currentDropTarget({
  activeArea: "项目素材", project: "示例项目", mode: "制作素材", category: "合成", files: [],
  rootPath: libraryRoot, rootKind: "library", rootName: "素材库", linkedProjects: [], ...extra,
});

test("snapshots native files, item files, and text before the drag data store closes", () => {
  let closed = false;
  const reads = [];
  const fromFiles = { path: "Z:\\downloads\\first.png" };
  const fromItems = { path: "Z:\\downloads\\second.png" };
  const values = {
    "text/uri-list": "file:///Z:/downloads/third.png",
    "text/plain": "Z:\\downloads\\fourth.png",
    DownloadURL: "image/png:fifth.png:file:///Z:/downloads/fifth.png",
  };
  const whileOpen = (label, value) => {
    assert.equal(closed, false, `${label} must be read synchronously during drop`);
    reads.push(label);
    return value;
  };
  const transfer = {
    get files() { return whileOpen("files", { 0: fromFiles, length: 1 }); },
    get items() { return whileOpen("items", { 0: { kind: "file", getAsFile: () => whileOpen("getAsFile", fromItems) }, length: 1 }); },
    getData(type) { return whileOpen(type, values[type]); },
  };
  const payload = snapshotFileDrop(transfer, (file) => whileOpen("getPathForFile", file.path));
  closed = true;
  assert.equal(typeof payload?.then, "undefined", "the snapshot itself cannot yield to an async continuation");
  assert.deepEqual(payload, {
    paths: [fromFiles.path, fromItems.path], uriList: values["text/uri-list"],
    text: values["text/plain"], downloadUrl: values.DownloadURL,
  });
  for (const read of ["files", "items", "getAsFile", "getPathForFile", ...Object.keys(values)]) assert.ok(reads.includes(read));
});

test("one inaccessible virtual file cannot suppress other native or item files", () => {
  const usable = { path: "Z:\\downloads\\usable.png" };
  const virtual = { virtual: true };
  const itemOnly = { path: "Z:\\downloads\\item-only.png" };
  const payload = snapshotFileDrop({
    files: [virtual, usable],
    items: [
      { kind: "file", getAsFile() { throw new Error("virtual shell entry"); } },
      { kind: "file", getAsFile: () => null },
      { kind: "string", getAsFile() { assert.fail("string items must not be treated as files"); } },
      { kind: "file", getAsFile: () => itemOnly },
      { kind: "file", getAsFile: () => usable },
    ],
    getData(type) {
      if (type === "text/uri-list") throw new Error("format unavailable");
      return type === "text/plain" ? "Z:\\downloads\\text-only.png" : "";
    },
  }, (file) => {
    if (file.virtual) throw new Error("no disk path");
    return file.path;
  });
  assert.deepEqual(payload, {
    paths: [usable.path, itemOnly.path], uriList: "", text: "Z:\\downloads\\text-only.png", downloadUrl: "",
  });
});

test("deduplicates file payloads while retaining first-seen order and ignoring empty native paths", () => {
  const first = { path: "Z:\\downloads\\one.png" };
  const second = { path: "Z:\\downloads\\two.png" };
  assert.deepEqual(snapshotFileDrop({
    files: [first, {}, second],
    items: [first, second].map((file) => ({ kind: "file", getAsFile: () => file })),
  }, (file) => file.path), { paths: [first.path, second.path], uriList: "", text: "", downloadUrl: "" });
  assert.deepEqual(snapshotFileDrop(null, () => assert.fail("there are no files")), {
    paths: [], uriList: "", text: "", downloadUrl: "",
  });
});

test("category reordering is distinguished by its private marker even when it also carries text or files", () => {
  for (const types of [[CATEGORY_DRAG_TYPE], ["text/plain", CATEGORY_DRAG_TYPE], ["Files", "text/uri-list", CATEGORY_DRAG_TYPE]]) {
    const transfer = { types };
    assert.equal(isCategoryDrag(transfer), true);
    assert.equal(isFileDrag(transfer), false);
  }
  for (const type of ["Files", "files", "text/plain", "text/uri-list", "DownloadURL", "downloadurl"]) {
    assert.equal(isCategoryDrag({ types: [type] }), false);
    assert.equal(isFileDrag({ types: [type] }), true, `${type} remains available to external-drop validation`);
  }
  for (const transfer of [null, {}, { types: [] }, { types: ["text/html", "application/x-unrelated"] }]) {
    assert.equal(isCategoryDrag(transfer), false);
    assert.equal(isFileDrag(transfer), false);
  }
});

test("managed import chooses the open project's current mode and physical category rather than another visible project", () => {
  const files = [
    projectFile("02_项目素材/其他项目/制作素材/合成/other.png", { project: "其他项目" }),
    projectFile("02_项目素材/示例项目/参考素材/合成/reference.png", { mode: "参考素材" }),
    projectFile("02_项目素材/示例项目/制作素材/渲染图/render.png", { category: "渲染图" }),
    projectFile("02_项目素材/示例项目/制作素材/合成/nested/current.png"),
  ];
  assert.deepEqual(target({ files }), {
    root: libraryRoot, directory: "02_项目素材/示例项目/制作素材/合成", area: "项目素材",
    project: "示例项目", mode: "制作素材", category: "合成", label: "示例项目 · 制作素材 · 合成",
  });
});

test("retains ordered physical folder names instead of rebuilding them from display names", () => {
  for (const modeFolder of ["03_制作素材", "03-制作素材", "03 制作素材", "003制作素材", "03 _-制作素材"]) {
    const directory = `20_项目素材/04_示例项目/${modeFolder}/07_合成`;
    const result = target({ files: [projectFile(`${directory}/深层目录/image.png`)] });
    assert.equal(result.directory, directory);
    assert.equal(result.category, "合成");
  }
});

test("a new category preserves its existing project and mode folder prefixes", () => {
  assert.equal(target({
    category: "新分类", files: [projectFile("20_项目素材/04_示例项目/03_制作素材/07_合成/image.png")],
  }).directory, "20_项目素材/04_示例项目/03_制作素材/新分类");
});

test("the all-categories project view imports into 未分类 under the current physical mode", () => {
  assert.deepEqual(target({
    category: "全部", files: [projectFile("20_项目素材/04_示例项目/03_制作素材/07_合成/image.png")],
  }), {
    root: libraryRoot, directory: "20_项目素材/04_示例项目/03_制作素材/未分类", area: "项目素材",
    project: "示例项目", mode: "制作素材", category: "未分类", label: "示例项目 · 制作素材 · 未分类",
  });
});

test("the all-categories view reuses an existing ordered 未分类 folder instead of creating a second one", () => {
  for (const options of [
    { relativePath: "20_项目素材/04_示例项目/03_制作素材", root: libraryRoot, extra: {} },
    { relativePath: "03_制作素材", root: projectRoot, extra: { sourceRoot: projectRoot } },
  ]) {
    const result = target({
      category: "全部", files: [
        projectFile(`${options.relativePath}/07_合成/image.png`, options.extra),
        projectFile(`${options.relativePath}/00_未分类/image.png`, { ...options.extra, category: "未分类" }),
      ],
    });
    assert.equal(result.root, options.root);
    assert.equal(result.directory, `${options.relativePath}/00_未分类`);
    assert.equal(result.category, "未分类");
  }
});

test("an empty mode in an existing managed project keeps the physical project folder", () => {
  const result = target({
    mode: "参考素材", category: "全部",
    files: [projectFile("20_项目素材/04_示例项目/03_制作素材/07_合成/image.png")],
  });
  assert.equal(result.directory, "20_项目素材/04_示例项目/参考素材/未分类");
});

test("new managed project categories use the selected project and mode even before any file exists", () => {
  assert.equal(target({ mode: "参考素材", category: "全部" }).directory, "02_项目素材/示例项目/参考素材/未分类");
});

test("linked project imports use the external source root and retain its mode/category names", () => {
  const result = target({
    files: [projectFile("02_制作素材/09_合成/image.png", { sourceRoot: projectRoot })],
    linkedProjects: [{ name: "示例项目", path: projectRoot }],
  });
  assert.equal(result.root, projectRoot);
  assert.equal(result.directory, "02_制作素材/09_合成");
  assert.equal(result.project, "示例项目");
});

test("an empty linked project resolves by its saved link without writing inside the managed library", () => {
  const result = target({ linkedProjects: [{ name: "示例项目", path: projectRoot }] });
  assert.equal(result.root, projectRoot);
  assert.equal(result.directory, "制作素材/合成");
});

test("an empty mode in a linked project retains its external root and any containing physical folders", () => {
  const result = target({
    mode: "参考素材", category: "全部",
    files: [projectFile("工作目录/02_制作素材/09_合成/image.png", { sourceRoot: projectRoot })],
  });
  assert.equal(result.root, projectRoot);
  assert.equal(result.directory, "工作目录/参考素材/未分类");
});

test("direct projects use the opened project root and never add the managed-library hierarchy", () => {
  const result = target({ rootKind: "project", rootPath: projectRoot, rootName: "示例项目", category: "全部" });
  assert.equal(result.root, projectRoot);
  assert.equal(result.directory, "制作素材/未分类");
});

test("unstructured direct and linked folders preserve their first physical category, including order prefixes", () => {
  for (const options of [
    { rootKind: "project", rootPath: projectRoot, rootName: "示例项目" },
    { linkedProjects: [{ name: "示例项目", path: projectRoot }] },
  ]) {
    const result = target({ ...options, files: [projectFile("07_合成/原稿/多层/image.png", { sourceRoot: projectRoot })] });
    assert.equal(result.root, projectRoot);
    assert.equal(result.directory, "07_合成");
  }
});

test("an inferred category for direct project root files still targets their existing physical root", () => {
  const result = target({
    rootKind: "project", rootPath: projectRoot, rootName: "示例项目", category: "渲染图",
    files: [projectFile("root-image.png", { category: "渲染图", sourceRoot: projectRoot })],
  });
  assert.equal(result.root, projectRoot);
  assert.equal(result.directory, "");
});

test("reusable materials select the current area and preserve the existing physical category", () => {
  for (const area of ["下载素材", "AI制作素材"]) {
    const result = target({ activeArea: area, category: "图片", files: [
      reusableFile("01_素材/下载素材/错误分类/other.png", { area: "无关区域" }),
      reusableFile(`12_素材/03_${area}/08_图片/nested/image.png`, { area }),
    ] });
    assert.deepEqual(result, {
      root: libraryRoot, directory: `12_素材/03_${area}/08_图片`, area,
      category: "图片", label: `${area} · 图片`,
    });
  }
});

test("the reusable all-categories view uses 未分类 while retaining its physical area", () => {
  const result = target({
    activeArea: "下载素材", category: "全部", files: [reusableFile("12_素材/03_下载素材/08_图片/image.png")],
  });
  assert.equal(result.directory, "12_素材/03_下载素材/未分类");
  assert.equal(result.category, "未分类");
});

test("the reusable all-categories view prefers the existing physical 未分类 folder", () => {
  const result = target({
    activeArea: "下载素材", category: "全部", files: [
      reusableFile("12_素材/03_下载素材/08_图片/image.png"),
      reusableFile("12_素材/03_下载素材/00_未分类/image.png", { category: "未分类" }),
    ],
  });
  assert.equal(result.directory, "12_素材/03_下载素材/00_未分类");
  assert.equal(result.category, "未分类");
});

test("an empty reusable area inherits the existing physical material parent from the other area", () => {
  for (const [existingArea, emptyArea] of [["下载素材", "AI制作素材"], ["AI制作素材", "下载素材"]]) {
    const result = target({
      activeArea: emptyArea, category: "全部",
      files: [reusableFile(`12_素材/03_${existingArea}/08_图片/image.png`, { area: existingArea })],
    });
    assert.equal(result.root, libraryRoot);
    assert.equal(result.directory, `12_素材/${emptyArea}/未分类`);
    assert.equal(result.area, emptyArea);
  }
});

test("reusable imports without a managed library leave the root empty so the caller requests a save location", () => {
  for (const area of ["下载素材", "AI制作素材"]) {
    for (const options of [
      { rootKind: "", rootPath: "", rootName: "" },
      { rootKind: "project", rootPath: projectRoot, rootName: "示例项目" },
    ]) {
      const result = target({ ...options, activeArea: area, category: "全部" });
      assert.equal(result.root, "");
      assert.equal(result.directory, `01_素材/${area}/未分类`);
      assert.equal(result.area, area);
    }
  }
});

test("the virtual associated-materials view never yields a physical import folder", () => {
  assert.equal(target({ mode: "关联素材", files: [projectFile("02_项目素材/示例项目/制作素材/合成/image.png")] }), null);
  assert.equal(target({ mode: "关联素材", linkedProjects: [{ name: "示例项目", path: projectRoot }] }), null);
});

test("inbox imports remain under 待整理 and also request a save location when only a project is connected", () => {
  assert.deepEqual(target({ activeArea: "待整理" }), {
    root: libraryRoot, directory: "00_待整理", area: "待整理", category: "全部", label: "待整理",
  });
  assert.equal(target({ activeArea: "待整理", rootKind: "project", rootPath: projectRoot }).root, "");
});
