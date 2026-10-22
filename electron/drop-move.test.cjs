const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, test } = require("node:test");
const { moveFilesToDirectory, ensureLibraryStructure, scanLibrary } = require("./library.cjs");

async function fixture(context) {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yu-drop-move-"));
  context.after(() => fs.promises.rm(temporaryRoot, { recursive: true, force: true }));
  const root = path.join(temporaryRoot, "素材库");
  const downloads = path.join(temporaryRoot, "下载");
  await fs.promises.mkdir(root);
  await fs.promises.mkdir(downloads);
  return { temporaryRoot, root, downloads };
}

async function writeFile(directory, name, contents) {
  await fs.promises.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, name);
  await fs.promises.writeFile(filePath, contents);
  return filePath;
}

function codedError(code) {
  return Object.assign(new Error(`Simulated ${code}`), { code });
}

async function withFsMethods(replacements, action) {
  const originals = {};
  for (const [method, replacement] of Object.entries(replacements)) {
    originals[method] = fs.promises[method];
    fs.promises[method] = (...args) => replacement(originals[method], ...args);
  }
  try {
    return await action();
  } finally {
    for (const [method, original] of Object.entries(originals)) fs.promises[method] = original;
  }
}

function crossVolumeFor(source) {
  return (original, from, ...rest) => {
    if (from === source) throw codedError("EXDEV");
    return original(from, ...rest);
  };
}

async function junctionOrSkip(context, target, link) {
  try {
    await fs.promises.symlink(target, link, "junction");
    return true;
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(error.code)) throw error;
    context.skip(`Directory links are unavailable: ${error.code}`);
    return false;
  }
}

// These tests patch shared fs.promises methods for one unique temporary source.
// Keep them serial and restore every method before leaving each test action.
describe("moving dropped files into the current category", { concurrency: false }, () => {
  test("moves downloaded images into a managed project, preserving contents and removing the download", async (context) => {
    const { root, downloads } = await fixture(context);
    await ensureLibraryStructure(root);
    const category = path.join("02_项目素材", "喂鱼器", "制作素材", "自定义 合成");
    const contents = Buffer.from([0, 1, 2, 255]);
    const source = await writeFile(downloads, "金鱼 合成 100% #1.png", contents);
    const destination = path.join(root, category, path.basename(source));

    assert.deepEqual(await moveFilesToDirectory(root, [source], category), [destination]);
    assert.deepEqual(await fs.promises.readFile(destination), contents);
    assert.equal(fs.existsSync(source), false);
    const indexed = await scanLibrary(root);
    assert.equal(indexed.isManagedLibrary, true);
    assert.ok(indexed.files.some((file) => file.fullPath === destination));
    assert.deepEqual(await fs.promises.readdir(downloads), []);
  });

  test("numbers collisions without overwriting existing files", async (context) => {
    const { root, downloads } = await fixture(context);
    const category = path.join("制作素材", "ai合成");
    const target = path.join(root, category);
    const source = await writeFile(downloads, "金鱼.png", "new image");
    const first = await writeFile(target, "金鱼.png", "first existing image");
    const second = await writeFile(target, "金鱼_2.png", "second existing image");
    const destination = path.join(target, "金鱼_3.png");

    assert.deepEqual(await moveFilesToDirectory(root, [source, source], category), [destination]);
    assert.equal(fs.existsSync(source), false);
    assert.equal(await fs.promises.readFile(destination, "utf8"), "new image");
    assert.equal(await fs.promises.readFile(first, "utf8"), "first existing image");
    assert.equal(await fs.promises.readFile(second, "utf8"), "second existing image");
  });

  test("leaves an original already in the selected directory in place", async (context) => {
    const { root } = await fixture(context);
    const category = path.join("制作素材", "渲染图");
    const source = await writeFile(path.join(root, category), "已有.png", "original image");

    assert.deepEqual(await moveFilesToDirectory(root, [source, source], category), []);
    assert.equal(await fs.promises.readFile(source, "utf8"), "original image");
    assert.deepEqual(await fs.promises.readdir(path.dirname(source)), ["已有.png"]);
  });

  test("moves into a direct linked project without creating managed-library folders", async (context) => {
    const { root, downloads } = await fixture(context);
    const category = path.join("制作素材", "自定义分类");
    const source = await writeFile(downloads, "下载.png", "downloaded image");
    const destination = path.join(root, category, "下载.png");

    assert.deepEqual(await moveFilesToDirectory(root, [source], category), [destination]);
    assert.equal(fs.existsSync(source), false);
    assert.equal(await fs.promises.readFile(destination, "utf8"), "downloaded image");
    assert.deepEqual(await fs.promises.readdir(root), ["制作素材"]);
    assert.equal((await scanLibrary(root)).isManagedLibrary, false);
  });

  test("supports a project root connected through a junction without duplicating its existing files", async (context) => {
    const { root, downloads, temporaryRoot } = await fixture(context);
    const linkedRoot = path.join(temporaryRoot, "项目链接");
    if (!await junctionOrSkip(context, root, linkedRoot)) return;
    const category = path.join("制作素材", "合成");
    const source = await writeFile(downloads, "下载.png", "downloaded image");
    const destination = path.join(linkedRoot, category, "下载.png");

    assert.deepEqual(await moveFilesToDirectory(linkedRoot, [source], category), [destination]);
    assert.equal(fs.existsSync(source), false);
    assert.deepEqual(await moveFilesToDirectory(linkedRoot, [destination], category), []);
    assert.equal(await fs.promises.readFile(destination, "utf8"), "downloaded image");
    assert.deepEqual(await fs.promises.readdir(path.join(root, category)), ["下载.png"]);
    assert.deepEqual(await fs.promises.readdir(root), ["制作素材"]);
  });

  test("rejects escaping, absolute and NUL destinations without changing the original", async (context) => {
    const { root, downloads, temporaryRoot } = await fixture(context);
    const source = await writeFile(downloads, "下载.png", "original download");
    const sentinel = await writeFile(root, "已有.png", "existing image");
    for (const category of [
      "..", path.join("..", "越界"), path.join("..", "素材库-旁边", "子目录"),
      root, path.join(temporaryRoot, "绝对目录"), "制作素材\0/分类", null, undefined,
    ]) {
      await assert.rejects(() => moveFilesToDirectory(root, [source], category));
    }
    assert.equal(await fs.promises.readFile(source, "utf8"), "original download");
    assert.equal(await fs.promises.readFile(sentinel, "utf8"), "existing image");
    assert.deepEqual(await fs.promises.readdir(root), ["已有.png"]);
    assert.deepEqual((await fs.promises.readdir(temporaryRoot)).sort(), ["下载", "素材库"].sort());
  });

  test("rejects existing and uncreated destination folders behind an escaping junction", async (context) => {
    const { root, downloads, temporaryRoot } = await fixture(context);
    const outside = path.join(temporaryRoot, "外部目录");
    await fs.promises.mkdir(outside);
    const sentinel = await writeFile(outside, "已有.png", "outside content");
    const source = await writeFile(downloads, "下载.png", "original download");
    if (!await junctionOrSkip(context, outside, path.join(root, "外部链接"))) return;

    for (const category of ["外部链接", path.join("外部链接", "未创建", "子目录")]) {
      await assert.rejects(() => moveFilesToDirectory(root, [source], category));
    }
    assert.deepEqual(await fs.promises.readdir(outside), ["已有.png"]);
    assert.equal(await fs.promises.readFile(source, "utf8"), "original download");
    assert.equal(await fs.promises.readFile(sentinel, "utf8"), "outside content");
  });

  test("copies exclusively and then removes the source when hard linking reports another volume", async (context) => {
    const { root, downloads } = await fixture(context);
    const source = await writeFile(downloads, "跨盘下载.png", "cross-volume image");
    const category = path.join("制作素材", "渲染图");
    const destination = path.join(root, category, path.basename(source));
    const copies = [];
    await withFsMethods({
      link: crossVolumeFor(source),
      copyFile: async (original, from, to, flags) => {
        if (from === source) copies.push({ from, to, flags });
        return original(from, to, flags);
      },
    }, async () => {
      assert.deepEqual(await moveFilesToDirectory(root, [source], category), [destination]);
    });

    assert.deepEqual(copies, [{ from: source, to: destination, flags: fs.constants.COPYFILE_EXCL }]);
    assert.equal(fs.existsSync(source), false);
    assert.equal(await fs.promises.readFile(destination, "utf8"), "cross-volume image");
  });

  test("rolls back the new cross-volume copy when deleting its original fails", async (context) => {
    const { root, downloads } = await fixture(context);
    const source = await writeFile(downloads, "锁定下载.png", "locked original");
    const category = path.join("制作素材", "合成");
    const target = path.join(root, category);
    const existing = await writeFile(target, "锁定下载.png", "existing image");
    const destination = path.join(target, "锁定下载_2.png");
    let copied = false;
    await withFsMethods({
      link: crossVolumeFor(source),
      copyFile: async (original, from, to, flags) => {
        const result = await original(from, to, flags);
        if (from === source) copied = true;
        return result;
      },
      unlink: (original, filePath) => {
        if (filePath === source) throw codedError("EACCES");
        return original(filePath);
      },
    }, async () => {
      await assert.rejects(() => moveFilesToDirectory(root, [source], category));
    });

    assert.equal(copied, true);
    assert.equal(await fs.promises.readFile(source, "utf8"), "locked original");
    assert.equal(await fs.promises.readFile(existing, "utf8"), "existing image");
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(await fs.promises.readdir(target), ["锁定下载.png"]);
  });

  test("keeps the original when the cross-volume copy fails", async (context) => {
    const { root, downloads } = await fixture(context);
    const source = await writeFile(downloads, "复制失败.png", "original download");
    const category = path.join("制作素材", "合成");
    const target = path.join(root, category);
    const existing = await writeFile(target, "已有.png", "existing image");
    await withFsMethods({
      link: crossVolumeFor(source),
      copyFile: (original, from, ...rest) => {
        if (from === source) throw codedError("EIO");
        return original(from, ...rest);
      },
    }, async () => {
      await assert.rejects(() => moveFilesToDirectory(root, [source], category));
    });

    assert.equal(await fs.promises.readFile(source, "utf8"), "original download");
    assert.equal(await fs.promises.readFile(existing, "utf8"), "existing image");
    assert.deepEqual(await fs.promises.readdir(target), ["已有.png"]);
  });

  test("does not remove a replacement source created while its cross-volume copy was running", async (context) => {
    const { root, downloads } = await fixture(context);
    const source = await writeFile(downloads, "被替换.png", "old downloaded image");
    const oldSource = `${source}.previous`;
    const category = path.join("制作素材", "合成");
    const destination = path.join(root, category, path.basename(source));
    await withFsMethods({
      link: crossVolumeFor(source),
      copyFile: async (original, from, to, flags) => {
        await original(from, to, flags);
        if (from === source) {
          await fs.promises.rename(source, oldSource);
          await fs.promises.writeFile(source, "new replacement download");
        }
      },
    }, async () => {
      await assert.rejects(() => moveFilesToDirectory(root, [source], category));
    });

    assert.equal(await fs.promises.readFile(source, "utf8"), "new replacement download");
    assert.equal(await fs.promises.readFile(oldSource, "utf8"), "old downloaded image");
    assert.equal(fs.existsSync(destination), false);
  });

  test("does not remove a source modified in place while its cross-volume copy was running", async (context) => {
    const { root, downloads } = await fixture(context);
    const source = await writeFile(downloads, "被修改.png", "original");
    const category = path.join("制作素材", "合成");
    const destination = path.join(root, category, path.basename(source));
    const before = await fs.promises.stat(source);
    await withFsMethods({
      link: crossVolumeFor(source),
      copyFile: async (original, from, to, flags) => {
        await original(from, to, flags);
        if (from === source) {
          await fs.promises.writeFile(source, "modified");
          await fs.promises.utimes(source, before.atime, new Date(before.mtimeMs + 5000));
        }
      },
    }, async () => {
      await assert.rejects(() => moveFilesToDirectory(root, [source], category));
    });

    assert.equal(await fs.promises.readFile(source, "utf8"), "modified");
    assert.equal((await fs.promises.stat(source)).ino, before.ino);
    assert.equal(fs.existsSync(destination), false);
  });

  test("rechecks the source after restoring destination timestamps before removing the original", async (context) => {
    const { root, downloads } = await fixture(context);
    const source = await writeFile(downloads, "设置时间时修改.png", "original");
    const category = path.join("制作素材", "合成");
    const destination = path.join(root, category, path.basename(source));
    const before = await fs.promises.stat(source);
    let destinationTimestampSet = false;
    await withFsMethods({
      link: crossVolumeFor(source),
      utimes: async (original, filePath, atime, mtime) => {
        await original(filePath, atime, mtime);
        if (filePath === destination) {
          destinationTimestampSet = true;
          await fs.promises.writeFile(source, "modified");
          await original(source, before.atime, new Date(before.mtimeMs + 5000));
        }
      },
    }, async () => {
      await assert.rejects(() => moveFilesToDirectory(root, [source], category));
    });

    assert.equal(destinationTimestampSet, true);
    assert.equal(await fs.promises.readFile(source, "utf8"), "modified");
    assert.equal(fs.existsSync(destination), false);
  });

  test("preserves a dangling destination junction and moves to the next numbered name", async (context) => {
    const { root, downloads, temporaryRoot } = await fixture(context);
    const source = await writeFile(downloads, "同名目标.png", "downloaded image");
    const category = path.join("制作素材", "合成");
    const target = path.join(root, category);
    await fs.promises.mkdir(target, { recursive: true });
    const dangling = path.join(target, path.basename(source));
    if (!await junctionOrSkip(context, path.join(temporaryRoot, "不存在的目录"), dangling)) return;
    const originalLink = await fs.promises.readlink(dangling);
    const destination = path.join(target, "同名目标_2.png");
    const attempts = [];
    assert.equal(fs.existsSync(dangling), false);
    assert.equal((await fs.promises.lstat(dangling)).isSymbolicLink(), true);
    await withFsMethods({
      link: (original, from, to) => {
        if (from === source) {
          attempts.push(to);
          // A regression must fail promptly instead of retrying the same name forever.
          if (attempts.length > 3) throw new Error("Repeated a dangling destination without advancing the suffix");
        }
        return original(from, to);
      },
    }, async () => {
      assert.deepEqual(await moveFilesToDirectory(root, [source], category), [destination]);
    });

    assert.deepEqual(attempts, [dangling, destination]);
    assert.equal(fs.existsSync(source), false);
    assert.equal(await fs.promises.readFile(destination, "utf8"), "downloaded image");
    assert.equal((await fs.promises.lstat(dangling)).isSymbolicLink(), true);
    assert.equal(await fs.promises.readlink(dangling), originalLink);
    assert.equal(fs.existsSync(dangling), false);
  });

  test("reports earlier successful moves when a later item fails and leaves remaining originals available", async (context) => {
    const { root, downloads } = await fixture(context);
    const first = await writeFile(downloads, "第一张.png", "first image");
    const locked = await writeFile(downloads, "锁定图片.png", "locked image");
    const last = await writeFile(downloads, "最后一张.png", "last image");
    const category = path.join("制作素材", "合成");
    const target = path.join(root, category);
    const firstDestination = path.join(target, path.basename(first));
    const completed = [];
    await withFsMethods({
      unlink: (original, filePath) => {
        if (filePath === locked) throw codedError("EACCES");
        return original(filePath);
      },
    }, async () => {
      await assert.rejects(() => moveFilesToDirectory(root, [first, locked, last], category, (move) => {
        completed.push(move);
      }));
    });

    assert.deepEqual(completed, [{ source: first, destination: firstDestination }]);
    assert.equal(fs.existsSync(first), false);
    assert.equal(await fs.promises.readFile(firstDestination, "utf8"), "first image");
    assert.equal(await fs.promises.readFile(locked, "utf8"), "locked image");
    assert.equal(await fs.promises.readFile(last, "utf8"), "last image");
    assert.deepEqual(await fs.promises.readdir(target), ["第一张.png"]);
  });
});
