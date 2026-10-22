const clean = (value) => value.replace(/^\d+[_\-\s]*/, "");
import { DEFAULT_MATERIAL_AREAS, isMaterialArea } from "./material-areas.js";

export function currentDropTarget({ activeArea, project, mode, category, files, rootPath, rootKind, rootName, linkedProjects, materialAreas = DEFAULT_MATERIAL_AREAS }) {
  if (activeArea === "项目素材" && mode === "关联素材") return null;
  const matches = files.filter((item) => item.area === activeArea
    && (activeArea !== "项目素材" || (item.project === project && item.mode === mode)));
  const selectedCategory = category === "全部" ? "未分类" : category;
  const anchor = matches.find((item) => item.category === selectedCategory) || matches[0];
  const parts = anchor?.relativePath?.split("/").slice(0, -1) || [];
  if (activeArea === "项目素材") {
    const projectAnchor = anchor || files.find((item) => item.area === "项目素材" && item.project === project);
    const projectParts = projectAnchor?.relativePath?.split("/").slice(0, -1) || [];
    const link = linkedProjects.find((item) => item.name === project);
    const directRoot = projectAnchor?.sourceRoot || link?.path || (rootKind === "project" && rootName === project ? rootPath : "");
    const targetRoot = directRoot || (rootKind === "library" ? rootPath : "");
    if (!targetRoot || !project) return null;
    const modeIndex = parts.findIndex((part) => clean(part) === mode);
    let directory;
    if (modeIndex >= 0) {
      directory = anchor.category === selectedCategory
        ? parts.slice(0, modeIndex + 2) : [...parts.slice(0, modeIndex + 1), selectedCategory];
    } else if (directRoot && anchor?.category === selectedCategory) {
      // Unstructured linked projects keep their existing physical folder layout.
      directory = parts.slice(0, 1);
    } else {
      const otherModeIndex = projectParts.findIndex((part) => ["参考素材", "制作素材"].includes(clean(part)));
      const projectIndex = projectParts.findIndex((part) => clean(part) === "项目素材");
      const prefix = otherModeIndex >= 0 ? projectParts.slice(0, otherModeIndex)
        : projectIndex >= 0 ? projectParts.slice(0, projectIndex + 2)
          : directRoot ? [] : ["02_项目素材", project];
      directory = [...prefix, mode, selectedCategory];
    }
    return { root: targetRoot, directory: directory.join("/"), area: activeArea, project, mode, category: selectedCategory,
      label: `${project} · ${mode} · ${selectedCategory}` };
  }
  if (isMaterialArea(activeArea, materialAreas)) {
    const normalizedRoot = value => (value || "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
    const managedParts = item => {
      if (!item || (item.sourceRoot && normalizedRoot(item.sourceRoot) !== normalizedRoot(rootPath))
        || (item.rootPath && normalizedRoot(item.rootPath) !== normalizedRoot(rootPath))) return null;
      const folders = (item.relativePath || "").split("/").slice(0, -1);
      if (clean(folders[0] || "") !== "素材" || folders.length < 2) return null;
      const area = materialAreas.includes(folders[1]) ? folders[1] : clean(folders[1]);
      return isMaterialArea(area, materialAreas) && area === item.area ? folders : null;
    };
    const managed = files.filter(item => managedParts(item));
    const areaAnchor = managed.find(item => item.area === activeArea && item.category === selectedCategory)
      || managed.find(item => item.area === activeArea);
    const areaParts = managedParts(areaAnchor);
    const directory = areaParts
      ? [...areaParts.slice(0, 2), areaAnchor.category === selectedCategory ? areaParts[2] || selectedCategory : selectedCategory]
      : [managedParts(managed[0])?.[0] || "01_素材", activeArea, selectedCategory];
    return { root: rootKind === "library" ? rootPath : "", directory: directory.join("/"), area: activeArea,
      category: selectedCategory, label: `${activeArea} · ${selectedCategory}` };
  }
  return { root: rootKind === "library" ? rootPath : "", directory: "00_待整理", area: "待整理", category: "全部", label: "待整理" };
}
