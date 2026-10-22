import mediaExtensions from "../electron/media-types.json" with { type: "json" };
const array = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === "string" ? value : "";
const folded = (value) => text(value).normalize("NFKC").toLocaleLowerCase();

const extensionTypes = new Map(Object.entries(mediaExtensions).flatMap(([kind, extensions]) => extensions.split(" ").map((extension) => [extension, kind])));

/** Accept an extension, filename, or full path. No file access or content conversion. */
export function mediaTypeFor(extension) {
  const value = text(extension).split(/[\\/]/).at(-1).toLocaleLowerCase();
  return extensionTypes.get(value.includes(".") ? value.split(".").at(-1) : value) || "other";
}

/** Includes the selected category itself. Broken or cyclic branches terminate safely. */
export function categoryDescendants(categories, id) {
  const entries = array(categories);
  const root = entries.find((entry) => entry?.id === id);
  if (!root) return [];
  const found = new Set([id]);
  const queue = [id];
  for (let index = 0; index < queue.length; index += 1) {
    for (const entry of entries) {
      if (!entry?.id || entry.parentId !== queue[index] || found.has(entry.id) || (root.area && entry.area && root.area !== entry.area)) continue;
      found.add(entry.id);
      queue.push(entry.id);
    }
  }
  return [...found];
}

export function categoryBreadcrumb(categories, id) {
  const map = new Map(array(categories).filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
  const visited = new Set();
  const names = [];
  let current = map.get(id);
  const area = current?.area;
  while (current && !visited.has(current.id)) {
    if (area && current.area && current.area !== area) break;
    visited.add(current.id);
    if (text(current.name)) names.unshift(current.name);
    current = map.get(current.parentId);
  }
  return names.join(" / ");
}

/** Commas/newlines separate tags; spaces remain part of a tag. */
export function parseCatalogTags(value) {
  const values = Array.isArray(value) ? value : text(value).split(/[,，、;；\r\n]+/u);
  const unique = new Map();
  for (const entry of values) {
    const cleaned = text(entry).trim();
    if (cleaned && !unique.has(folded(cleaned))) unique.set(folded(cleaned), cleaned);
  }
  return [...unique.values()];
}

/** Filters remain independent; every query term and selected tag must match. */
export function matchesCatalogAsset(asset, options = {}) {
  if (!asset || typeof asset !== "object") return false;
  const { query = "", mediaType = "all", favoritesOnly = false, tags = [], categoryId = "all", categories = [] } = options;
  const kind = Object.hasOwn(mediaExtensions, asset.mediaType) || asset.mediaType === "other"
    ? asset.mediaType : mediaTypeFor(asset.extension || asset.name || asset.fullPath);
  if (mediaType && !["all", "全部"].includes(mediaType) && kind !== mediaType) return false;
  if (favoritesOnly && !asset.favorite) return false;
  const ownTags = new Set(array(asset.tags).map(folded));
  if (!array(tags).every((tag) => ownTags.has(folded(tag)))) return false;
  const memberships = array(asset.categoryIds);
  if (["uncategorized", "未分类"].includes(categoryId)) {
    if (memberships.length) return false;
  } else if (categoryId && !["all", "全部"].includes(categoryId)) {
    const branch = new Set(categoryDescendants(categories, categoryId));
    if (!memberships.some((id) => branch.has(id))) return false;
  }
  const terms = folded(query).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return true;
  const haystack = folded([
    asset.name, asset.displayName, asset.fullPath, asset.relativePath, asset.note,
    ...array(asset.tags), ...memberships.map((id) => categoryBreadcrumb(categories, id)),
  ].filter(Boolean).join("\n"));
  return terms.every((term) => haystack.includes(term));
}
