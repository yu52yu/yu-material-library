const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BOUNDS = { width: 1440, height: 940 };
const MINIMUM_SIZE = { width: 980, height: 680 };
const keepers = new WeakMap();

function validBounds(bounds) {
  return bounds && ["x", "y", "width", "height"].every((key) => (
    Number.isSafeInteger(bounds[key]) && Math.abs(bounds[key]) <= 1000000
  )) && bounds.width > 0 && bounds.height > 0;
}

function parseWindowState(value) {
  if (!value || value.version !== 1 || !validBounds(value.bounds) || typeof value.maximized !== "boolean") return null;
  const { x, y, width, height } = value.bounds;
  return { version: 1, bounds: { x, y, width, height }, maximized: value.maximized };
}

function intersectionArea(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

function constrainWindowState(saved, displays, primaryDisplayId) {
  const available = displays.filter((display) => validBounds(display.workArea));
  if (!available.length) throw new Error("No usable display work area");
  const primary = available.find((display) => display.id === primaryDisplayId) || available[0];
  const state = parseWindowState(saved);
  let display = primary;
  let overlap = 0;
  if (state) {
    for (const candidate of available) {
      const area = intersectionArea(state.bounds, candidate.workArea);
      if (area > overlap) { display = candidate; overlap = area; }
    }
  }

  const area = display.workArea;
  const minWidth = Math.min(MINIMUM_SIZE.width, area.width);
  const minHeight = Math.min(MINIMUM_SIZE.height, area.height);
  const source = state?.bounds || DEFAULT_BOUNDS;
  const width = Math.max(minWidth, Math.min(source.width, area.width));
  const height = Math.max(minHeight, Math.min(source.height, area.height));
  const x = state && overlap > 0 ? state.bounds.x : area.x + Math.round((area.width - width) / 2);
  const y = state && overlap > 0 ? state.bounds.y : area.y + Math.round((area.height - height) / 2);
  return {
    version: 1,
    bounds: {
      x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
      width,
      height,
    },
    maximized: state?.maximized || false,
    minWidth,
    minHeight,
  };
}

function restoreWindowState(filePath, displays, primaryDisplayId) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { /* First launch or invalid local settings. */ }
  return constrainWindowState(saved, displays, primaryDisplayId);
}

function saveWindowState(filePath, value) {
  const state = parseWindowState(value);
  if (!state) return false;
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Settings must not prevent closing. */ }
    return false;
  }
}

function trackWindowState(window, { filePath, initialState, delayMs = 250 }) {
  if (keepers.has(window)) return keepers.get(window);
  let state = parseWindowState(initialState);
  if (!state) throw new Error("A valid initial window state is required");
  let timer;
  let disposed = false;

  function capture() {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    state.maximized = window.isMaximized();
    if (state.maximized) return;
    const bounds = window.getBounds();
    if (validBounds(bounds)) state.bounds = { ...bounds };
  }

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (disposed) return false;
    capture();
    return saveWindowState(filePath, state);
  }

  function schedule() {
    capture();
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
    timer.unref?.();
  }

  function maximize() {
    // Electron retains the restored rectangle even if maximize follows a resize immediately.
    const bounds = window.getNormalBounds();
    if (validBounds(bounds)) state.bounds = { ...bounds };
    state.maximized = true;
    schedule();
  }
  function unmaximize() { state.maximized = false; schedule(); }
  const listeners = {
    move: schedule,
    resize: schedule,
    maximize,
    unmaximize,
    close: flush,
    closed: dispose,
  };
  function dispose() {
    clearTimeout(timer);
    disposed = true;
    for (const [event, listener] of Object.entries(listeners)) window.removeListener(event, listener);
    keepers.delete(window);
  }
  for (const [event, listener] of Object.entries(listeners)) window.on(event, listener);
  const keeper = { flush, dispose };
  keepers.set(window, keeper);
  return keeper;
}

module.exports = { constrainWindowState, parseWindowState, restoreWindowState, saveWindowState, trackWindowState };
