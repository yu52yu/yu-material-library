export const CATEGORY_DRAG_TYPE = "application/x-yu-material-category";

export function isCategoryDrag(transfer) {
  return Array.from(transfer?.types || []).includes(CATEGORY_DRAG_TYPE);
}

export function isFileDrag(transfer) {
  return !isCategoryDrag(transfer) && Array.from(transfer?.types || []).some((type) =>
    ["files", "text/uri-list", "downloadurl", "text/plain"].includes(type.toLowerCase()));
}

export function fileDropEffect(transfer, desktop) {
  if (!desktop) return "copy";
  const allowed = transfer?.effectAllowed || "uninitialized";
  if (["all", "uninitialized", "move", "copyMove", "linkMove"].includes(allowed)) return "move";
  return allowed === "link" ? "link" : "copy";
}

// Read synchronously: browsers clear the drag data store after the drop handler yields.
export function snapshotFileDrop(transfer, getPathForFile) {
  const paths = new Set();
  const files = [...Array.from(transfer?.files || [])];
  for (const item of Array.from(transfer?.items || [])) {
    if (item.kind === "file") {
      try { const file = item.getAsFile(); if (file) files.push(file); } catch { /* Try the other entries. */ }
    }
  }
  for (const file of files) {
    try { const path = getPathForFile(file); if (path) paths.add(path); } catch { /* A virtual item may not have a disk path. */ }
  }
  const read = (type) => {
    try { return transfer?.getData(type) || ""; } catch { return ""; }
  };
  return { paths: [...paths], uriList: read("text/uri-list"), text: read("text/plain"), downloadUrl: read("DownloadURL") };
}
