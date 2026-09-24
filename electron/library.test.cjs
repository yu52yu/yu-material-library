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
const { renameFile } = require('./library.cjs');
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
