const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { watchLibrary } = require("./watch-library.cjs");

test("native notifications track save, overwrite, rename and delete without polling", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yu-watch-test-"));
  let pending;
  const close = watchLibrary(root, (change) => {
    if (pending?.matches(change)) { clearTimeout(pending.timer); pending.resolve(change); pending = null; }
  });
  t.after(async () => { close(); await fs.rm(root, { recursive: true, force: true }); });
  function next(matches) {
    return new Promise((resolve, reject) => {
      pending = { matches, resolve, timer: setTimeout(() => reject(new Error("Missing filesystem notification")), 8000) };
    });
  }
  const file = path.join(root, "后2.png");
  let event = next((change) => change.files.some((entry) => entry.name === "后2.png"));
  await fs.writeFile(file, "first");
  assert.equal((await event).files[0].size, 5);
  event = next((change) => change.files.some((entry) => entry.size === 14));
  await fs.writeFile(file, "updated-render");
  assert.equal((await event).files[0].size, 14);
  const renamed = path.join(root, "后3.png");
  event = next((change) => change.files.some((entry) => entry.name === "后3.png"));
  await fs.rename(file, renamed);
  assert.equal((await event).files[0].fullPath, renamed);
  event = next((change) => change.replacedPath === renamed && change.files.length === 0);
  await fs.unlink(renamed);
  await event;
});
