const DEFAULT_AREAS = Object.freeze(["下载素材", "AI制作素材"]);
const RESERVED_AREAS = ["项目素材", "待整理", "全部", "关联素材", "我的收藏", "全库搜索"];
const MAX_AREA_LENGTH = 40;
const comparisonKey = (name) => name.normalize("NFKC").toLowerCase();

function validateMaterialAreaName(name, customAreas = []) {
  if (typeof name !== "string" || !name.trim()) throw new Error("请输入素材分区名称");
  const cleaned = name.trim();
  const normalized = cleaned.normalize("NFKC");
  if ([...cleaned].length > MAX_AREA_LENGTH || [...normalized].length > MAX_AREA_LENGTH) {
    throw new Error(`素材分区名称不能超过 ${MAX_AREA_LENGTH} 个字符`);
  }
  if (/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    || normalized.endsWith(".") || normalized === "." || normalized === ".."
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized.split(".")[0].trimEnd())) {
    throw new Error("素材分区名称不能包含路径、特殊文件字符或系统保留文件名");
  }
  const key = comparisonKey(cleaned);
  if (RESERVED_AREAS.some((area) => comparisonKey(area) === key)) throw new Error("该名称已被系统使用，请换一个名称");
  const existing = [...DEFAULT_AREAS, ...(Array.isArray(customAreas) ? customAreas : [])];
  if (existing.some((area) => typeof area === "string" && comparisonKey(area) === key)) {
    throw new Error("已存在同名素材分区");
  }
  return cleaned;
}

function listMaterialAreas(customAreas = []) {
  const areas = [...DEFAULT_AREAS];
  if (!Array.isArray(customAreas)) return areas;
  for (const name of customAreas) {
    try { areas.push(validateMaterialAreaName(name, areas)); }
    catch { /* Ignore malformed saved values when selecting filesystem destinations. */ }
  }
  return areas;
}

function isMaterialArea(area, customAreas = []) {
  return typeof area === "string" && listMaterialAreas(customAreas).includes(area);
}

module.exports = { DEFAULT_AREAS, listMaterialAreas, isMaterialArea, validateMaterialAreaName };
