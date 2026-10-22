export const DEFAULT_MATERIAL_AREAS = Object.freeze(["下载素材", "AI制作素材"]);

export function materialAreasFromCatalog(catalog) {
  const saved = catalog?.settings?.customAreas;
  return [...new Set([...DEFAULT_MATERIAL_AREAS, ...(Array.isArray(saved) ? saved.filter(name => typeof name === "string" && name.trim()) : [])])];
}

export function isMaterialArea(area, areas = DEFAULT_MATERIAL_AREAS) {
  return areas.includes(area);
}

export function reusablePath(relativePath, areas = DEFAULT_MATERIAL_AREAS) {
  const folders = relativePath.replaceAll("\\", "/").split("/").filter(Boolean).slice(0, -1);
  const clean = name => name.replace(/^\d+[\s_-]*/, "");
  const resolve = name => areas.includes(name) ? name : areas.includes(clean(name || "")) ? clean(name) : null;
  const materialIndex = folders.findIndex(name => clean(name) === "素材");
  if (materialIndex < 0 && folders.some(name => ["项目素材", "参考素材", "制作素材", "待整理"].includes(clean(name)))) return null;
  const index = materialIndex >= 0 ? materialIndex + 1 : folders.findIndex(name => resolve(name));
  if (index < 0 || index >= folders.length) return null;
  const area = resolve(folders[index]);
  if (!area) return null;
  const categoryPath = folders.slice(index + 1).map(clean).filter(name => name && name !== "未分类");
  return { area, categoryPath, category: clean(folders[index + 1] || "") || "未分类" };
}
