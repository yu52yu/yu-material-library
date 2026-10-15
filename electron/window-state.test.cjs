const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { constrainWindowState, parseWindowState, restoreWindowState, saveWindowState, trackWindowState } = require("./window-state.cjs");

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const secondary = { id: 2, workArea: { x: -1600, y: 40, width: 1600, height: 860 } };
const savedState = (bounds = { x: 100, y: 80, width: 1200, height: 800 }, maximized = false) => ({ version: 1, bounds, maximized });

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yu-window-state-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "settings", "window-state.json");
}

class FakeWindow extends EventEmitter {
  constructor(bounds) {
    super();
    this.bounds = { ...bounds };
    this.normalBounds = { ...bounds };
    this.maximized = false;
    this.minimized = false;
    this.destroyed = false;
    this.fullscreen = false;
  }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  isMaximized() { return this.maximized; }
  isFullScreen() { return this.fullscreen; }
  getBounds() { return this.bounds; }
  getNormalBounds() { return this.normalBounds; }
}

test("first launch centers a usable default window in the primary work area", () => {
  const restored = constrainWindowState(null, [secondary, primary], 1);
  assert.deepEqual(restored.bounds, { x: 240, y: 50, width: 1440, height: 940 });
  assert.equal(restored.maximized, false);
  assert.equal(restored.minWidth, 980);
  assert.equal(restored.minHeight, 680);
});

test("restores a secondary screen with negative coordinates and maximum state", () => {
  const state = savedState({ x: -1500, y: 60, width: 1200, height: 800 }, true);
  const restored = constrainWindowState(state, [primary, secondary], 1);
  assert.deepEqual(restored.bounds, state.bounds);
  assert.equal(restored.maximized, true);
});

test("removed screens relocate the window to the primary display", () => {
  const restored = constrainWindowState(savedState({ x: -1500, y: 60, width: 1200, height: 800 }, true), [primary], 1);
  assert.deepEqual(restored.bounds, { x: 360, y: 120, width: 1200, height: 800 });
  assert.equal(restored.maximized, true);
});

test("uses the display with greatest overlap and clamps the whole window into view", () => {
  const restored = constrainWindowState(savedState({ x: -100, y: 900, width: 1700, height: 1000 }), [primary, secondary], 1);
  assert.deepEqual(restored.bounds, { x: 0, y: 40, width: 1700, height: 1000 });
});

test("enforces minimum size and adapts the minimum to smaller displays", () => {
  const restored = constrainWindowState(savedState({ x: 1900, y: 1000, width: 30, height: 20 }), [primary], 1);
  assert.deepEqual(restored.bounds, { x: 940, y: 360, width: 980, height: 680 });
  const small = { id: 3, workArea: { x: 20, y: 30, width: 800, height: 600 } };
  const fitted = constrainWindowState(savedState(), [small], 3);
  assert.deepEqual(fitted.bounds, { x: 20, y: 30, width: 800, height: 600 });
  assert.equal(fitted.minWidth, 800);
  assert.equal(fitted.minHeight, 600);
});

test("invalid schema and bounds fall back to safe defaults", () => {
  const invalid = [
    null,
    [],
    { ...savedState(), version: 99 },
    { ...savedState(), maximized: "true" },
    savedState({ x: NaN, y: 10, width: 1200, height: 800 }),
    savedState({ x: 0, y: 0, width: -1, height: 800 }),
    savedState({ x: 0.2, y: 0, width: 1200, height: 800 }),
    savedState({ x: 100000000, y: 0, width: 1200, height: 800 }),
  ];
  for (const value of invalid) {
    assert.equal(parseWindowState(value), null);
    assert.deepEqual(constrainWindowState(value, [primary], 1).bounds, { x: 240, y: 50, width: 1440, height: 940 });
  }
});

test("reads a missing or malformed local file safely and writes only window state", (t) => {
  const filePath = fixture(t);
  const defaultState = restoreWindowState(filePath, [primary], 1);
  assert.equal(defaultState.maximized, false);
  assert.equal(saveWindowState(filePath, { ...savedState(), unrelatedPath: "must not persist" }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), savedState());
  assert.deepEqual(restoreWindowState(filePath, [primary], 1).bounds, savedState().bounds);
  assert.equal(saveWindowState(filePath, savedState({ x: 200, y: 100, width: 1300, height: 850 }, true)), true);
  assert.equal(restoreWindowState(filePath, [primary], 1).maximized, true);
  fs.writeFileSync(filePath, "{ broken JSON");
  assert.deepEqual(restoreWindowState(filePath, [primary], 1), defaultState);
});

test("an unwritable settings location returns failure without crashing", (t) => {
  const filePath = fixture(t);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.mkdirSync(filePath);
  assert.equal(saveWindowState(filePath, savedState()), false);
  assert.equal(saveWindowState(filePath, null), false);
  assert.equal(fs.existsSync(`${filePath}.${process.pid}.tmp`), false);
});

test("resize and move save once on close, and reattaching does not duplicate listeners", (t) => {
  const filePath = fixture(t);
  const window = new FakeWindow(savedState().bounds);
  const options = { filePath, initialState: savedState(), delayMs: 10000 };
  const keeper = trackWindowState(window, options);
  t.after(keeper.dispose);
  assert.equal(trackWindowState(window, options), keeper);
  assert.equal(window.listenerCount("resize"), 1);
  window.bounds = { x: 310, y: 210, width: 1280, height: 820 };
  window.emit("move");
  window.emit("resize");
  assert.equal(fs.existsSync(filePath), false);
  window.emit("close");
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), savedState(window.bounds));
  window.destroyed = true;
  window.emit("closed");
  assert.equal(window.listenerCount("resize"), 0);
  assert.equal(keeper.flush(), false);
});

test("maximizing immediately after resize retains the normal rectangle, including when closed minimized", (t) => {
  const filePath = fixture(t);
  const window = new FakeWindow(savedState().bounds);
  const keeper = trackWindowState(window, { filePath, initialState: savedState(), delayMs: 10000 });
  t.after(keeper.dispose);
  window.normalBounds = { x: 210, y: 140, width: 1360, height: 840 };
  window.bounds = window.normalBounds;
  window.emit("resize");
  window.maximized = true;
  window.bounds = primary.workArea;
  window.emit("maximize");
  window.emit("resize");
  keeper.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), savedState(window.normalBounds, true));
  window.minimized = true;
  window.maximized = false;
  window.bounds = { x: -32000, y: -32000, width: 160, height: 28 };
  window.emit("move");
  window.emit("close");
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), savedState(window.normalBounds, true));
});

test("unmaximizing saves the restored size and clears the maximum state", (t) => {
  const filePath = fixture(t);
  const window = new FakeWindow(savedState().bounds);
  const keeper = trackWindowState(window, { filePath, initialState: savedState(undefined, true), delayMs: 10000 });
  t.after(keeper.dispose);
  window.bounds = { x: 150, y: 90, width: 1250, height: 830 };
  window.emit("unmaximize");
  window.emit("resize");
  window.emit("close");
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), savedState(window.bounds));
});
