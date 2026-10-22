const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  copyFilesToArea,
  copyFilesToInbox,
  describePaths,
  ensureLibraryStructure,
  organizeFile,
  organizeFiles,
  scanLibrary,
  trashFiles,
  validateFilesInsideRoot,
} = require("./library.cjs");

test("creates the agreed minimal library structure", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-library-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));

  await ensureLibraryStructure(root);

  for (const relativePath of [
    "00_待整理",
    path.join("01_素材", "下载素材"),
    path.join("01_素材", "AI制作素材"),
    "02_项目素材",
  ]) {
    assert.equal((await fs.promises.stat(path.join(root, relativePath))).isDirectory(), true);
  }
});

test("imports directly to the active reusable material area", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-library-"));
  const sourceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-source-"));
  context.after(() => Promise.all([
    fs.promises.rm(root, { recursive: true, force: true }),
    fs.promises.rm(sourceRoot, { recursive: true, force: true }),
  ]));
  const source = path.join(sourceRoot, "小鱼.png");
  await fs.promises.writeFile(source, Buffer.from("fish"));

  const [destination] = await copyFilesToArea(root, [source], "AI制作素材", "动物");

  assert.equal(destination, path.join(root, "01_素材", "AI制作素材", "动物", "小鱼.png"));
  assert.equal(await fs.promises.readFile(source, "utf8"), "fish");
  assert.equal(await fs.promises.readFile(destination, "utf8"), "fish");
});

test("registered material areas support safe copying, organizing and managed rescanning", async context => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-custom-area-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const library = path.join(root, "library");
  const original = path.join(root, "作品.png");
  const areas = ["我的作品"];
  await fs.promises.writeFile(original, "original artwork");
  await assert.rejects(copyFilesToArea(library, [original], "未注册", "未分类", areas), /导入目标无效/);
  await assert.rejects(copyFilesToArea(library, [original], "../escape", "未分类", ["../escape"]), /导入目标无效/);
  assert.equal(fs.existsSync(library), false);

  const [copied] = await copyFilesToArea(library, [original], "我的作品", "未分类", areas);
  assert.equal(copied, path.join(library, "01_素材", "我的作品", "未分类", "作品.png"));
  assert.equal(await fs.promises.readFile(original, "utf8"), "original artwork");
  await assert.rejects(organizeFile(library, copied, { area: "未注册" }, areas), /整理目标无效/);
  const moved = await organizeFile(library, copied, { area: "我的作品", category: "平面作品" }, areas);
  const nested = path.join(path.dirname(moved), "海报");
  await fs.promises.mkdir(nested);
  await fs.promises.rename(moved, path.join(nested, "作品.png"));
  await fs.promises.writeFile(path.join(library, "Uninstall.exe"), "not a material");
  const scanned = await scanLibrary(library);
  assert.equal(scanned.isManagedLibrary, true);
  assert.equal(scanned.files.length, 1);
  assert.deepEqual(scanned.files[0].categoryPath, ["平面作品", "海报"]);
  assert.equal(scanned.files[0].relativePath, "01_素材/我的作品/平面作品/海报/作品.png");
  assert.equal(await fs.promises.readFile(original, "utf8"), "original artwork");
});

test("indexes local files and exposes image previews", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-library-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "02_项目素材", "三代喂食器", "制作素材", "详情页");
  await fs.promises.mkdir(target, { recursive: true });
  await fs.promises.writeFile(path.join(target, "首页.png"), Buffer.from("png"));
  await fs.promises.writeFile(path.join(target, "首页.psd"), Buffer.from("psd"));

  const result = await scanLibrary(root);

  assert.equal(result.files.length, 2);
  assert.equal(result.files.find((item) => item.extension === "png").previewUrl.startsWith("yu-asset://file/"), true);
  assert.equal(result.files.find((item) => item.extension === "psd").previewUrl, null);
  assert.equal(result.files[0].relativePath.includes("三代喂食器"), true);
});

test("imports to 待整理 without overwriting an existing file", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-library-"));
  const sourceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-source-"));
  context.after(() => Promise.all([
    fs.promises.rm(root, { recursive: true, force: true }),
    fs.promises.rm(sourceRoot, { recursive: true, force: true }),
  ]));
  const source = path.join(sourceRoot, "小鱼.png");
  await fs.promises.writeFile(source, Buffer.from("first"));

  await copyFilesToInbox(root, [source]);
  const second = await copyFilesToInbox(root, [source]);

  assert.equal(path.basename(second[0]), "小鱼_2.png");
  assert.equal(await fs.promises.readFile(path.join(root, "00_待整理", "小鱼.png"), "utf8"), "first");
});

test("describes dropped project folders and organizes inbox files", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-library-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await ensureLibraryStructure(root);
  const inboxFile = path.join(root, "00_待整理", "详情页.png");
  await fs.promises.writeFile(inboxFile, Buffer.from("page"));

  const [description] = await describePaths([root]);
  assert.equal(description.isDirectory, true);

  const destination = await organizeFile(root, inboxFile, {
    area: "项目素材",
    project: "第三代",
    mode: "制作素材",
    category: "详情页",
  });
  assert.equal(destination, path.join(root, "02_项目素材", "第三代", "制作素材", "详情页", "详情页.png"));
  assert.equal(fs.existsSync(inboxFile), false);
  assert.equal(await fs.promises.readFile(destination, "utf8"), "page");
});

test("organizes several selected materials into one existing category", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-library-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await ensureLibraryStructure(root);
  const unclassified = path.join(root, "01_素材", "AI制作素材", "未分类");
  await fs.promises.mkdir(unclassified, { recursive: true });
  const first = path.join(unclassified, "小鱼一.png");
  const second = path.join(unclassified, "小鱼二.png");
  await fs.promises.writeFile(first, Buffer.from("one"));
  await fs.promises.writeFile(second, Buffer.from("two"));

  const moved = await organizeFiles(root, [first, second], { area: "AI制作素材", category: "动物" });

  assert.equal(moved.length, 2);
  assert.equal(moved[0].destination, path.join(root, "01_素材", "AI制作素材", "动物", "小鱼一.png"));
  assert.equal(moved[1].destination, path.join(root, "01_素材", "AI制作素材", "动物", "小鱼二.png"));
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
});

test("managed libraries ignore unrelated sibling application files", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-library-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await ensureLibraryStructure(root);
  await fs.promises.writeFile(path.join(root, "Uninstall.exe"), Buffer.from("app"));
  await fs.promises.writeFile(path.join(root, "00_待整理", "要整理.png"), Buffer.from("asset"));

  const result = await scanLibrary(root);

  assert.equal(result.isManagedLibrary, true);
  assert.deepEqual(result.files.map((item) => item.name), ["要整理.png"]);
});

test("moves production images to references in managed and direct projects without overwriting", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-project-move-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  for (const directProject of [false, true]) {
    const projectRoot = directProject ? root : path.join(root, "02_项目素材", "喂鱼器");
    const sourceDir = path.join(projectRoot, "制作素材", "渲染图");
    const targetDir = path.join(projectRoot, "参考素材", "渲染图");
    await fs.promises.mkdir(sourceDir, { recursive: true });
    await fs.promises.mkdir(targetDir, { recursive: true });
    const source = path.join(sourceDir, "image.png");
    await fs.promises.writeFile(source, "production");
    await fs.promises.writeFile(path.join(targetDir, "image.png"), "existing");
    const target = { directProject, area: "项目素材", project: "喂鱼器", mode: "参考素材", category: "渲染图" };
    const [move] = await organizeFiles(root, [source], target);
    assert.equal(move.destination, path.join(targetDir, "image_2.png"));
    assert.equal(fs.existsSync(source), false);
    assert.equal(await fs.promises.readFile(move.destination, "utf8"), "production");
    assert.equal(await fs.promises.readFile(path.join(targetDir, "image.png"), "utf8"), "existing");
    assert.equal(await organizeFile(root, move.destination, target), move.destination);
  }
});

test("rescanning observes external saves, overwrites and deletion", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-external-save-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  assert.equal((await scanLibrary(root)).files.length, 0);
  const file = path.join(root, "后2.png");
  await fs.promises.writeFile(file, "first");
  const added = await scanLibrary(root);
  assert.equal(added.files[0].name, "后2.png");
  await fs.promises.writeFile(file, "updated-render");
  const updated = await scanLibrary(root);
  assert.notEqual(updated.files[0].size, added.files[0].size);
  await fs.promises.unlink(file);
  assert.equal((await scanLibrary(root)).files.length, 0);
});

test("only validates files contained by the selected library for deletion", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-library-"));
  const outsideRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-outside-"));
  context.after(() => Promise.all([
    fs.promises.rm(root, { recursive: true, force: true }),
    fs.promises.rm(outsideRoot, { recursive: true, force: true }),
  ]));
  const inside = path.join(root, "inside.png");
  const outside = path.join(outsideRoot, "outside.png");
  await fs.promises.writeFile(inside, Buffer.from("inside"));
  await fs.promises.writeFile(outside, Buffer.from("outside"));

  assert.deepEqual(await validateFilesInsideRoot(root, [inside]), [inside]);
  await assert.rejects(() => validateFilesInsideRoot(root, [outside]), /只能删除当前素材库中的文件/);
});

test("trashes pictures in managed libraries and direct projects through the provided recycle-bin service", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-trash-projects-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const recycled = path.join(root, "recycled");
  await fs.promises.mkdir(recycled);

  for (const managed of [true, false]) {
    const selectedRoot = path.join(root, managed ? "managed" : "linked-project");
    if (managed) await ensureLibraryStructure(selectedRoot);
    const directory = managed
      ? path.join(selectedRoot, "02_项目素材", "喂鱼器", "制作素材", "渲染图")
      : path.join(selectedRoot, "参考素材", "图片");
    await fs.promises.mkdir(directory, { recursive: true });
    const file = path.join(directory, managed ? "managed.png" : "linked.png");
    await fs.promises.writeFile(file, "image contents");
    const calls = [];
    const result = await trashFiles(selectedRoot, [file, file], async (filePath) => {
      calls.push(filePath);
      await fs.promises.rename(filePath, path.join(recycled, path.basename(filePath)));
    });

    assert.deepEqual(result, { deleted: [file], failed: [] });
    assert.deepEqual(calls, [file]);
    assert.equal(fs.existsSync(file), false);
    assert.equal(await fs.promises.readFile(path.join(recycled, path.basename(file)), "utf8"), "image contents");
  }
});

test("reports partial recycle-bin failures and continues without permanently deleting failed files", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-trash-partial-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const locked = path.join(root, "locked.png");
  const available = path.join(root, "available.png");
  await fs.promises.writeFile(locked, "locked");
  await fs.promises.writeFile(available, "available");
  const calls = [];

  const result = await trashFiles(root, [locked, available], async (filePath) => {
    calls.push(filePath);
    if (filePath === locked) throw new Error("文件被 Photoshop 占用");
    await fs.promises.rename(filePath, `${filePath}.recycled`);
  });

  assert.deepEqual(result, {
    deleted: [available],
    failed: [{ path: locked, message: "文件被 Photoshop 占用" }],
  });
  assert.deepEqual(calls, [locked, available]);
  assert.equal(await fs.promises.readFile(locked, "utf8"), "locked");
  assert.equal(await fs.promises.readFile(`${available}.recycled`, "utf8"), "available");
});

test("rejects malformed requests, directories, and outside files before invoking the recycle bin", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-trash-invalid-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selectedRoot = path.join(root, "project");
  await fs.promises.mkdir(selectedRoot);
  const inside = path.join(selectedRoot, "inside.png");
  const outside = path.join(root, "outside.png");
  await fs.promises.writeFile(inside, "inside");
  await fs.promises.writeFile(outside, "outside");
  let called = false;
  const recycle = async () => { called = true; };

  for (const [deletionRoot, paths] of [
    [null, [inside]], ["", [inside]], ["relative-root", [inside]],
    [inside, [inside]], [path.join(root, "missing"), [inside]],
    [selectedRoot, null], [selectedRoot, inside], [selectedRoot, [inside, null]],
    [selectedRoot, [inside, "relative.png"]], [selectedRoot, [inside, ""]],
    [selectedRoot, [inside, outside]], [selectedRoot, [inside, selectedRoot]],
    [selectedRoot, [inside, path.join(selectedRoot, "missing.png")]],
  ]) {
    await assert.rejects(() => trashFiles(deletionRoot, paths, recycle));
  }

  assert.equal(called, false);
  assert.equal(await fs.promises.readFile(inside, "utf8"), "inside");
  assert.equal(await fs.promises.readFile(outside, "utf8"), "outside");
  assert.deepEqual(await trashFiles(selectedRoot, [], recycle), { deleted: [], failed: [] });
});

test("blocks deletion through a junction that escapes the selected project but accepts a linked root", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-trash-junction-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selectedRoot = path.join(root, "project");
  const outsideRoot = path.join(root, "outside");
  await fs.promises.mkdir(selectedRoot);
  await fs.promises.mkdir(outsideRoot);
  const inside = path.join(selectedRoot, "inside.png");
  const outside = path.join(outsideRoot, "outside.png");
  await fs.promises.writeFile(inside, "inside");
  await fs.promises.writeFile(outside, "outside");
  const junction = path.join(selectedRoot, "junction");
  const linkedRoot = path.join(root, "linked-root");
  await fs.promises.symlink(outsideRoot, junction, "junction");
  await fs.promises.symlink(selectedRoot, linkedRoot, "junction");
  const calls = [];
  const recycle = async (filePath) => { calls.push(filePath); };

  await assert.rejects(() => trashFiles(selectedRoot, [inside, path.join(junction, "outside.png")], recycle), /只能删除/);
  assert.deepEqual(calls, []);
  const linkedImage = path.join(linkedRoot, "inside.png");
  assert.deepEqual(await trashFiles(linkedRoot, [linkedImage], recycle), { deleted: [linkedImage], failed: [] });
  assert.deepEqual(calls, [linkedImage]);
  assert.equal(await fs.promises.readFile(outside, "utf8"), "outside");
});

test("rechecks queued pictures that disappear or are replaced during a batch", async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-trash-race-"));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const files = ["first.png", "gone.png", "replaced.png", "last.png"].map((name) => path.join(root, name));
  for (const file of files) await fs.promises.writeFile(file, "original");
  const calls = [];
  const result = await trashFiles(root, files, async (filePath) => {
    calls.push(filePath);
    if (filePath === files[0]) {
      await fs.promises.unlink(files[1]);
      await fs.promises.rename(files[2], `${files[2]}.old`);
      await fs.promises.writeFile(files[2], "new content");
    }
    await fs.promises.rename(filePath, `${filePath}.recycled`);
  });

  assert.deepEqual(result.deleted, [files[0], files[3]]);
  assert.deepEqual(result.failed.map((failure) => failure.path), [files[1], files[2]]);
  assert.match(result.failed[0].message, /文件不存在/);
  assert.match(result.failed[1].message, /已经变化/);
  assert.deepEqual(calls, [files[0], files[3]]);
  assert.equal(await fs.promises.readFile(files[2], "utf8"), "new content");
});
const { renameFile } = require('./library.cjs');

test('reports successful batch moves before a later failure so metadata can follow them', async context => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yu-move-partial-'));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await ensureLibraryStructure(root);
  const source = path.join(root, '00_待整理', 'first.png');
  const missing = path.join(root, '00_待整理', 'missing.png');
  await fs.promises.writeFile(source, 'original');
  let failure;
  try { await organizeFiles(root, [source, missing], { area: '下载素材', category: '动物' }); }
  catch (error) { failure = error; }
  assert.ok(failure);
  assert.equal(failure.moves.length, 1);
  assert.equal(failure.moves[0].source, source);
  assert.equal(await fs.promises.readFile(failure.moves[0].destination, 'utf8'), 'original');
  assert.equal(fs.existsSync(source), false);
});

test('scanner preserves nested reusable categories and native identity across external rename', async context => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yu-scan-nested-'));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await ensureLibraryStructure(root);
  const directory = path.join(root, '01_素材', '下载素材', '动物', '鱼', '观赏鱼');
  await fs.promises.mkdir(directory, { recursive: true });
  const source = path.join(directory, 'fish.mp4');
  const destination = path.join(directory, 'renamed.mp4');
  await fs.promises.writeFile(source, 'video bytes');
  const first = await scanLibrary(root);
  await fs.promises.rename(source, destination);
  const next = await scanLibrary(root);
  assert.deepEqual(first.files[0].categoryPath, ['动物', '鱼', '观赏鱼']);
  assert.equal(first.files[0].fileKey, next.files[0].fileKey);
  const exact = await fs.promises.stat(destination, { bigint: true });
  assert.equal(first.files[0].fileKey, `${exact.dev}:${exact.ino}:${exact.birthtimeNs}`);
  assert.equal(first.complete, true);
  assert.equal(first.truncated, false);
});

test('scanner excludes metadata and cache folders even when stored inside a connected source', async context => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yu-scan-cache-'));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const metadataDirectory = path.join(root, 'catalog');
  await fs.promises.mkdir(path.join(metadataDirectory, 'thumbnails'), { recursive: true });
  await fs.promises.writeFile(path.join(root, 'original.png'), 'original');
  await fs.promises.writeFile(path.join(metadataDirectory, 'catalog.sqlite'), 'metadata');
  await fs.promises.writeFile(path.join(metadataDirectory, 'thumbnails', 'preview.png'), 'preview');
  const scanned = await scanLibrary(root, { excludePaths: [metadataDirectory] });
  assert.deepEqual(scanned.files.map(file => file.name), ['original.png']);
});
test('rename preserves contents and rejects collisions and invalid names', async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yu-rename-'));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'original.png');
  await fs.promises.writeFile(source, 'original');
  const destination = await renameFile(root, source, 'renamed');
  assert.equal(path.basename(destination), 'renamed.png');
  assert.equal(await fs.promises.readFile(destination, 'utf8'), 'original');
  assert.equal(fs.existsSync(source), false);
  await fs.promises.writeFile(source, 'other');
  await assert.rejects(renameFile(root, destination, 'original'), /同名/);
  for (const name of ['', '../escape', 'CON', 'bad.', 'bad ', 'a/b']) await assert.rejects(renameFile(root, destination, name));
  await fs.promises.mkdir(path.join(root, 'nested'));
  await assert.rejects(renameFile(path.join(root, 'nested'), destination, 'outside'));
  assert.equal(await fs.promises.readFile(source, 'utf8'), 'other');
});
