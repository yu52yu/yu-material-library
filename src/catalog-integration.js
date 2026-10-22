import { DEFAULT_MATERIAL_AREAS, reusablePath } from "./material-areas.js";
export const normalizedPath = (value = "") => value.replaceAll("\\", "/").toLowerCase();

// Directory information is used only to seed an asset's first classification.
export function catalogEntry(record, fallbackRoot = "", materialAreas = DEFAULT_MATERIAL_AREAS) {
  const classification = reusablePath(record.relativePath || record.name || "", materialAreas);
  const categoryPath = classification?.area === record.area ? classification.categoryPath : [];
  return {
    fullPath: record.fullPath,
    rootPath: record.sourceRoot || record.rootPath || fallbackRoot,
    fileKey: record.fileKey || null,
    name: record.originalName || record.name,
    extension: record.extension,
    size: record.sizeBytes || 0,
    modified: record.modifiedAt || 0,
    area: record.area,
    categoryPath,
    context: {
      relativePath: record.relativePath,
      project: record.project || "",
      mode: record.mode || "",
      category: record.category || "未分类",
      sourceRoot: record.sourceRoot || "",
      directoryTags: record.tags || [],
      isImage: Boolean(record.isImage),
    },
  };
}

export function mergeCatalogRecords(records, snapshot, formatBytes) {
  if (!snapshot) return records;
  const byPath = new Map(records.map((record) => [normalizedPath(record.fullPath), record]));
  const result = [];
  for (const asset of snapshot.assets) {
    const original = byPath.get(normalizedPath(asset.fullPath));
    const context = asset.context || {};
    const isImage = original?.isImage ?? context.isImage ?? false;
    const originalName = asset.name || original?.name || asset.fullPath.split(/[\\/]/).at(-1);
    result.push({
      ...context, ...original,
      id: asset.fullPath, assetId: asset.id,
      fullPath: asset.fullPath,
      rootPath: asset.rootPath,
      sourceRoot: Object.hasOwn(context,"sourceRoot") ? context.sourceRoot : original?.sourceRoot || "",
      relativePath: context.relativePath || original?.relativePath || originalName,
      originalName, name: asset.displayName || originalName,
      extension: asset.extension || "",
      type: (asset.extension || "FILE").toUpperCase(),
      area: asset.area,
      category: context.category || original?.category || "未分类",
      project: context.project || original?.project || "",
      mode: context.mode || original?.mode || "",
      tags: [...new Set([...(context.directoryTags || original?.tags || []), ...asset.tags])],
      userTags: asset.tags, note: asset.note, favorite: asset.favorite,
      displayName: asset.displayName, categoryIds: asset.categoryIds,
      mediaType: asset.mediaType, online: asset.online,
      isImage,
      sizeBytes: asset.size, size: formatBytes(asset.size), modifiedAt: asset.modified,
      modified: asset.modified ? new Intl.DateTimeFormat("zh-CN").format(asset.modified) : "—",
      previewUrl: asset.online && isImage
        ? `yu-asset://file/${btoa(unescape(encodeURIComponent(asset.fullPath))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}?v=${asset.modified}-${asset.size}`
        : asset.online ? original?.previewUrl || null : null,
    });
    byPath.delete(normalizedPath(asset.fullPath));
  }
  // During an asynchronous index update, newly read files remain visible.
  return [...result, ...byPath.values()];
}

export function legacyCatalogPayload(storage) {
  const read = (key, fallback) => {
    try { return JSON.parse(storage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
  };
  return {
    favorites: read("yu-favorites", []), notes: read("yu-notes", {}),
    projectLinks: read("yu-project-links", { version: 1, groups: [] }),
    categoryLabels: read("yu-category-labels", {}), categoryOrders: read("yu-category-orders", {}),
    rootPath: storage.getItem("yu-library-root") || "",
    linkedProjects: read("yu-linked-projects", []),
  };
}
