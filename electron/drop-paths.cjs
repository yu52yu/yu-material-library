const path = require("node:path");
const { fileURLToPath } = require("node:url");

function isWindowsAbsolute(value) {
  return /^[a-z]:[\\/]/i.test(value)
    || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value);
}

function localPath(value) {
  if (typeof value !== "string" || value.includes("\0")) return null;
  let candidate = value.trim();
  if (candidate.startsWith('"') && candidate.endsWith('"')) candidate = candidate.slice(1, -1);
  if (!candidate || candidate.startsWith("#")) return null;

  try {
    if (/^file:\/\//i.test(candidate)) {
      const url = new URL(candidate);
      // Fragments and queries must be escaped when they belong to a filename.
      // Otherwise fileURLToPath would silently discard part of that filename.
      if (url.protocol !== "file:" || url.search || url.hash) return null;
      candidate = fileURLToPath(url);
    } else if (process.platform !== "win32" || !isWindowsAbsolute(candidate)) {
      return null;
    }

    if (candidate.includes("\0") || !path.isAbsolute(candidate)) return null;
    if (process.platform === "win32" && !isWindowsAbsolute(candidate)) return null;
    return path.resolve(candidate);
  } catch {
    // One malformed URL must not prevent valid files in the same drop.
    return null;
  }
}

function textLines(value) {
  return typeof value === "string" ? value.split(/\r\n|\n|\r/) : [];
}

function resolveDroppedPaths(payload = {}) {
  if (!payload || typeof payload !== "object") return [];
  const candidates = [
    ...(Array.isArray(payload.paths) ? payload.paths : []),
    ...textLines(payload.uriList),
    ...textLines(payload.text),
  ];

  if (typeof payload.downloadUrl === "string") {
    // DownloadURL is type:filename:url. Split only its first two colons:
    // file:///C:/... and names inside the URL can contain more colons.
    const firstColon = payload.downloadUrl.indexOf(":");
    const secondColon = payload.downloadUrl.indexOf(":", firstColon + 1);
    if (firstColon > 0 && secondColon > firstColon + 1) {
      const url = payload.downloadUrl.slice(secondColon + 1).trim();
      if (/^file:\/\//i.test(url)) candidates.push(url);
    }
  }

  const seen = new Set();
  const resolved = [];
  for (const candidate of candidates) {
    const filePath = localPath(candidate);
    if (!filePath) continue;
    const key = process.platform === "win32" ? filePath.toLowerCase() : filePath;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(filePath);
  }
  return resolved;
}

module.exports = { resolveDroppedPaths };
