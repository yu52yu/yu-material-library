import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CaretDown,
  CheckCircle,
  DownloadSimple,
  DotsSixVertical,
  File,
  Folder,
  FolderOpen,
  Funnel,
  GearSix,
  GridFour,
  Image as ImageIcon,
  ListBullets,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  SlidersHorizontal,
  Sparkle,
  Square,
  Star,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";

const ASSET = "./assets/";
const DESKTOP = Boolean(window.yuDesktop);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]);
const SOURCE_EXTENSIONS = new Set(["psd", "psb", "blend", "obj", "fbx", "stp", "step", "ai", "cdr"]);
const MAX_FILES = 1200;

function PanelDivider({ side, width, onResize }) {
  const drag = useRef(null);
  const [active, setActive] = useState(false);
  return <div
    className={`panel-divider panel-divider-${side}${active ? " dragging" : ""}`}
    role="separator" aria-orientation="vertical" tabIndex={0}
    aria-label={side === "left" ? "调整左侧导航宽度" : "调整右侧详情宽度"}
    aria-valuemin={side === "left" ? 180 : 240}
    aria-valuemax={side === "left" ? 360 : 480} aria-valuenow={Math.round(width)}
    title="拖动调整宽度，双击恢复默认；方向键微调"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
      setActive(true);
    }}
    onPointerMove={(event) => {
      if (drag.current) onResize(drag.current.width + (event.clientX - drag.current.x) * (side === "left" ? 1 : -1));
    }}
    onPointerUp={(event) => {
      drag.current = null;
      setActive(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; setActive(false); }}
    onLostPointerCapture={() => { drag.current = null; setActive(false); }}
    onDoubleClick={() => onResize(side === "left" ? 240 : 306)}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      onResize(event.key === "Home" ? (side === "left" ? 240 : 306) : width + (event.key === "ArrowRight" ? 10 : -10) * (side === "left" ? 1 : -1));
    }}
  />;
}

function stripOrderPrefix(value = "") {
  return value.replace(/^\d+[\s_-]*/, "");
}

function extensionOf(name = "") {
  const point = name.lastIndexOf(".");
  return point > -1 ? name.slice(point + 1).toLowerCase() : "";
}

function withoutExtension(name = "") {
  const point = name.lastIndexOf(".");
  return point > -1 ? name.slice(0, point) : name;
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function inferCategory(extension, mode) {
  if (["psd", "psb"].includes(extension)) return mode === "参考素材" ? "PS源文件" : "源文件";
  if (SOURCE_EXTENSIONS.has(extension)) return "源文件";
  return "渲染图";
}

function classifyPath(relativePath) {
  const rawParts = relativePath.split("/").filter(Boolean);
  const fileName = rawParts.at(-1) || "";
  const folders = rawParts.slice(0, -1);
  const clean = folders.map(stripOrderPrefix);
  const extension = extensionOf(fileName);

  const projectIndex = clean.findIndex((part) => part === "项目素材");
  const materialIndex = clean.findIndex((part) => part === "素材");
  const directSourceIndex = clean.findIndex((part) => ["下载素材", "AI制作素材"].includes(part));
  const modeIndex = clean.findIndex((part) => ["参考素材", "制作素材"].includes(part));

  if (clean.some((part) => part === "待整理")) {
    return { area: "待整理", project: "", mode: "", category: clean.at(-1) || "待整理" };
  }

  if (projectIndex > -1 || modeIndex > -1) {
    const effectiveModeIndex = modeIndex > -1 ? modeIndex : projectIndex + 2;
    const project = projectIndex > -1 ? clean[projectIndex + 1] : clean[Math.max(0, effectiveModeIndex - 1)];
    const mode = ["参考素材", "制作素材"].includes(clean[effectiveModeIndex]) ? clean[effectiveModeIndex] : "制作素材";
    const knownCategory = clean[effectiveModeIndex + 1];
    return {
      area: "项目素材",
      project: project || "未命名项目",
      mode,
      category: knownCategory || inferCategory(extension, mode),
    };
  }

  const sourceIndex = directSourceIndex > -1 ? directSourceIndex : materialIndex > -1 ? materialIndex + 1 : -1;
  const source = clean[sourceIndex];
  if (["下载素材", "AI制作素材"].includes(source)) {
    const typeFolder = clean[sourceIndex + 1];
    return {
      area: source,
      project: "",
      mode: "",
      category: typeFolder || inferCategory(extension, ""),
    };
  }

  return { area: "待整理", project: "", mode: "", category: inferCategory(extension, "") };
}

function makeRecord(file, relativePath, fileHandle = null) {
  const extension = extensionOf(file.name);
  const classification = classifyPath(relativePath);
  return {
    id: `${relativePath}-${file.size}-${file.lastModified}`,
    name: file.name,
    file,
    fileHandle,
    relativePath,
    extension,
    type: extension ? extension.toUpperCase() : "FILE",
    size: formatBytes(file.size),
    modified: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(file.lastModified),
    tags: [...new Set([...relativePath.split("/").slice(0, -1).map(stripOrderPrefix), classification.category])].filter(Boolean).slice(-5),
    ...classification,
    previewUrl: null,
    isImage: IMAGE_EXTENSIONS.has(extension) || file.type.startsWith("image/"),
  };
}

function decoratePreviews(records) {
  const imagesByStem = new Map();
  records.forEach((record) => {
    if (!record.isImage) return;
    record.previewUrl = URL.createObjectURL(record.file);
    const folder = record.relativePath.split("/").slice(0, -1).join("/").toLowerCase();
    const stem = withoutExtension(record.name).replace(/[_\s-]*(preview|预览图?)$/i, "").toLowerCase();
    imagesByStem.set(`${folder}/${stem}`, record.previewUrl);
  });

  records.forEach((record) => {
    if (record.previewUrl) return;
    const folder = record.relativePath.split("/").slice(0, -1).join("/").toLowerCase();
    const stem = withoutExtension(record.name).toLowerCase();
    record.previewUrl = imagesByStem.get(`${folder}/${stem}`) || null;
  });
  return records;
}

function recordsFromNative(entries) {
  const records = entries.map((entry) => {
    const classification = classifyPath(entry.relativePath);
    return {
      id: entry.fullPath,
      name: entry.name,
      fullPath: entry.fullPath,
      relativePath: entry.relativePath,
      extension: entry.extension,
      type: entry.extension ? entry.extension.toUpperCase() : "FILE",
      size: formatBytes(entry.size),
      modified: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(entry.modified),
      tags: [...new Set([...entry.relativePath.split("/").slice(0, -1).map(stripOrderPrefix), classification.category])].filter(Boolean).slice(-5),
      ...classification,
      previewUrl: entry.previewUrl ? `${entry.previewUrl}?v=${entry.modified}-${entry.size}` : null,
      isImage: entry.isImage,
    };
  });

  const imagesByStem = new Map();
  records.forEach((record) => {
    if (!record.previewUrl) return;
    const folder = record.relativePath.split("/").slice(0, -1).join("/").toLowerCase();
    const stem = withoutExtension(record.name).replace(/[_\s-]*(preview|预览图?)$/i, "").toLowerCase();
    imagesByStem.set(`${folder}/${stem}`, record.previewUrl);
  });
  records.forEach((record) => {
    if (record.previewUrl) return;
    const folder = record.relativePath.split("/").slice(0, -1).join("/").toLowerCase();
    const stem = withoutExtension(record.name).toLowerCase();
    record.previewUrl = imagesByStem.get(`${folder}/${stem}`) || null;
  });
  return records;
}

function hasLibraryStructure(entries) {
  return entries.some((entry) => {
    const topFolder = stripOrderPrefix(entry.relativePath.split("/")[0] || "");
    return ["待整理", "素材", "项目素材"].includes(topFolder);
  });
}

function recordsAsProject(entries, projectName, sourceRoot) {
  return recordsFromNative(entries).map((record) => {
    const folders = record.relativePath.split("/").slice(0, -1).map(stripOrderPrefix);
    const detectedMode = folders.find((part) => ["参考素材", "制作素材"].includes(part)) || "制作素材";
    const modeIndex = folders.indexOf(detectedMode);
    const detectedCategory = modeIndex >= 0 ? folders[modeIndex + 1] : folders[0];
    const category = detectedCategory || inferCategory(record.extension, detectedMode);
    return {
      ...record,
      area: "项目素材",
      project: projectName,
      mode: detectedMode,
      category,
      sourceRoot,
      tags: [...new Set([projectName, detectedMode, category, ...folders])].filter(Boolean).slice(0, 6),
    };
  });
}

async function scanDirectoryHandle(rootHandle) {
  const records = [];

  async function walk(directoryHandle, prefix = "") {
    for await (const [name, handle] of directoryHandle.entries()) {
      if (records.length >= MAX_FILES) return;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") await walk(handle, path);
      else {
        const file = await handle.getFile();
        records.push(makeRecord(file, path, handle));
      }
    }
  }

  await walk(rootHandle);
  return decoratePreviews(records);
}

function recordsFromFileList(fileList) {
  const files = Array.from(fileList || []).slice(0, MAX_FILES);
  return decoratePreviews(files.map((file) => {
    const rawPath = (file.webkitRelativePath || file.name).replaceAll("\\", "/");
    const parts = rawPath.split("/");
    const relativePath = parts.length > 1 ? parts.slice(1).join("/") : rawPath;
    return makeRecord(file, relativePath);
  }));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("yu-material-library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRootHandle(handle) {
  const database = await openDatabase();
  const transaction = database.transaction("handles", "readwrite");
  transaction.objectStore("handles").put(handle, "root");
}

async function loadRootHandle() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("handles", "readonly").objectStore("handles").get("root");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function createFolderPath(root, parts) {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
}

function NavButton({ active, icon: Icon, children, onClick, nested = false }) {
  return (
    <button className={`nav-item ${active ? "active" : ""} ${nested ? "nested" : ""}`} onClick={onClick}>
      <Icon size={19} weight={active ? "fill" : "regular"} aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

function FilePreview({ item, compact = false }) {
  if (item.previewUrl) {
    const source = item.previewUrl.startsWith("yu-asset:")
      ? `${item.previewUrl}&thumbnail=1` : item.previewUrl;
    return <img src={source} alt={item.name} loading="lazy" decoding="async" draggable={!DESKTOP} />;
  }
  return (
    <div className={`file-preview ${compact ? "compact" : ""}`}>
      <File size={compact ? 42 : 56} weight="duotone" />
      <strong>{item.type}</strong>
    </div>
  );
}

function AssetCard({ item, selected, favorite, view, onSelect, onToggleSelection, onFavorite, onOpen, onRename, onDragFile }) {
  return (
    <article
      className={`asset-card ${selected ? "selected" : ""} ${view === "list" ? "list-card" : ""}`}
      onClick={(event) => onSelect(item, event)}
      onDoubleClick={() => onOpen(item)}
      title={DESKTOP && item.fullPath ? "拖到其他应用以使用原始文件" : undefined}
      draggable={DESKTOP && Boolean(item.fullPath)}
      onDragStart={(event) => onDragFile(item, event)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(item, event);
      }}
      aria-label={`${item.name}，${item.type}`}
    >
      <div className="thumbnail-wrap">
        <FilePreview item={item} />
        <button
          className={`card-favorite ${favorite ? "is-favorite" : ""}`}
          onClick={(event) => { event.stopPropagation(); onFavorite(item.id); }}
          aria-label={favorite ? "取消收藏" : "收藏素材"}
        >
          <Star size={17} weight={favorite ? "fill" : "regular"} />
        </button>
        {["PSD", "PSB"].includes(item.type) && <span className="file-badge">Ps</span>}
        {item.type === "BLEND" && <span className="file-badge blend">Bl</span>}
      </div>
      <div className="asset-copy">
        <div className="asset-name-row"><div className="asset-name" title={item.name}>{item.name}</div>{DESKTOP && <button className="file-rename" title="重命名" aria-label={`重命名 ${item.name}`} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRename(item); }}><PencilSimple size={15} /></button>}</div>
        <div className="asset-type">{item.type} · {item.size}</div>
      </div>
      <button
        className={`selected-mark ${selected ? "active" : ""}`}
        aria-label={selected ? `取消选择${item.name}` : `选择${item.name}`}
        onClick={(event) => { event.stopPropagation(); onToggleSelection(item); }}
      >{selected && <CheckCircle size={21} weight="fill" />}</button>
    </article>
  );
}

export function App() {
  const [files, setFiles] = useState([]);
  const [rootName, setRootName] = useState("");
  const [rootHandle, setRootHandle] = useState(null);
  const [rootPath, setRootPath] = useState("");
  const [rootKind, setRootKind] = useState("none");
  const [linkedProjects, setLinkedProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem("yu-linked-projects") || "[]"); }
    catch { return []; }
  });
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [activeArea, setActiveArea] = useState("待整理");
  const [project, setProject] = useState("");
  const [mode, setMode] = useState("参考素材");
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("grid");
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("yu-favorites") || "[]")); }
    catch { return new Set(); }
  });
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("yu-notes") || "{}"); }
    catch { return {}; }
  });
  const [categoryLabels, setCategoryLabels] = useState(() => {
    try { return JSON.parse(localStorage.getItem("yu-category-labels") || "{}"); }
    catch { return {}; }
  });
  const [categoryOrders, setCategoryOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem("yu-category-orders") || "{}"); }
    catch { return {}; }
  });
  const [draggingCategory, setDraggingCategory] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState("");
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [organizeArea, setOrganizeArea] = useState("项目素材");
  const [organizeProject, setOrganizeProject] = useState("");
  const [organizeMode, setOrganizeMode] = useState("制作素材");
  const [organizeCategory, setOrganizeCategory] = useState("源文件");
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [renameCategoryRaw, setRenameCategoryRaw] = useState("");
  const [renameCategoryValue, setRenameCategoryValue] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const draggingOutRef = useRef(false);
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("yu-panel-widths") || "{}");
      return {
        left: Number.isFinite(saved.left) ? Math.max(180, Math.min(360, saved.left)) : 240,
        right: Number.isFinite(saved.right) ? Math.max(240, Math.min(480, saved.right)) : 306,
      };
    } catch { return { left: 240, right: 306 }; }
  });
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const update = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem("yu-panel-widths", JSON.stringify(panelWidths)); } catch { /* Keep resizing available when storage is full. */ }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [panelWidths]);
  const leftWidth = Math.min(panelWidths.left, Math.max(180, windowWidth - 240 - 400));
  const rightWidth = Math.min(panelWidths.right, Math.max(240, windowWidth - leftWidth - 400));
  function resizePanel(side, width) {
    const minimum = side === "left" ? 180 : 240;
    const maximum = Math.min(side === "left" ? 360 : 480, window.innerWidth - (side === "left" ? rightWidth : leftWidth) - 400);
    setPanelWidths((current) => ({ ...current, [side]: Math.max(minimum, Math.min(maximum, width)) }));
  }

  const projects = useMemo(() => [...new Set(files.filter((item) => item.area === "项目素材").map((item) => item.project))].sort(), [files]);

  const scopedFiles = useMemo(() => files.filter((item) => {
    if (activeArea === "项目素材") return item.area === "项目素材" && item.project === project && item.mode === mode;
    return item.area === activeArea;
  }), [files, activeArea, project, mode]);

  const categoryOrderKey = JSON.stringify([activeArea, activeArea === "项目素材" ? project : "", activeArea === "项目素材" ? mode : ""]);
  const categories = useMemo(() => {
    const available = [...new Set(scopedFiles.map((item) => item.category).filter(Boolean))];
    const savedOrder = categoryOrders[categoryOrderKey] || [];
    const savedIndex = new Map(savedOrder.map((name, index) => [name, index]));
    available.sort((left, right) => {
      const leftIndex = savedIndex.has(left) ? savedIndex.get(left) : Number.MAX_SAFE_INTEGER;
      const rightIndex = savedIndex.has(right) ? savedIndex.get(right) : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      if (left === "未分类") return -1;
      if (right === "未分类") return 1;
      return left.localeCompare(right, "zh-CN");
    });
    return ["全部", ...available];
  }, [scopedFiles, categoryOrders, categoryOrderKey]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return scopedFiles.filter((item) => {
      const categoryMatch = category === "全部" || item.category === category;
      const text = `${item.name} ${item.type} ${item.relativePath} ${item.tags.join(" ")}`.toLowerCase();
      return categoryMatch && (!normalized || text.includes(normalized));
    });
  }, [scopedFiles, category, query]);

  const selectedItems = useMemo(() => files.filter((item) => selectedIds.has(item.id)), [files, selectedIds]);
  const organizeSourceRoot = (selectedItems[0] || selected)?.sourceRoot;
  const canOrganizeSelection = DESKTOP && selectedItems.length > 0
    && selectedItems.every((item) => item.fullPath && (item.sourceRoot || "") === (organizeSourceRoot || ""));
  const canDeleteSelection = rootKind === "library" && selectedItems.length > 0
    && selectedItems.every((item) => item.fullPath && !item.sourceRoot);
  const organizeCategoryOptions = useMemo(() => [...new Set(files
    .filter((item) => item.area === organizeArea && item.category && item.category !== "未分类")
    .map((item) => item.category))].sort((a, b) => a.localeCompare(b, "zh-CN")), [files, organizeArea]);
  const projectCategoryOptions = useMemo(() => [...new Set([
    organizeMode === "参考素材" ? "PS源文件" : "源文件", "详情页", "渲染图",
    ...files.filter((item) => item.area === "项目素材" && item.project === organizeProject.trim() && item.mode === organizeMode).map((item) => item.category),
  ])].filter(Boolean), [files, organizeProject, organizeMode]);

  useEffect(() => {
    if (!DESKTOP) return;
    const normalize = (value) => value.replaceAll("\\", "/").toLowerCase();
    const roots = [
      ...(rootPath ? [{ path: rootPath, managed: rootKind === "library" }] : []),
      ...linkedProjects.filter((link) => normalize(link.path) !== normalize(rootPath)),
    ];
    const unsubscribe = window.yuDesktop.onLibraryChanged((change) => {
      const root = roots.find((entry) => normalize(entry.path) === normalize(change.rootPath));
      if (!root) return;
      const updates = root.managed ? recordsFromNative(change.files)
        : recordsAsProject(change.files, root.name || change.rootPath.split(/[\\/]/).at(-1), change.rootPath);
      const replaced = normalize(change.replacedPath);
      setFiles((current) => {
        const kept = current.filter((item) => {
          const location = normalize(item.fullPath || "");
          return location !== replaced && !location.startsWith(`${replaced}/`);
        });
        return [...kept, ...updates];
      });
    });
    const unsubscribeError = window.yuDesktop.onWatchError(setToast);
    if (roots.length) window.yuDesktop.retainWatchers(roots.map((entry) => entry.path)).catch(() => {});
    return () => { unsubscribe(); unsubscribeError(); };
  }, [rootPath, rootKind, linkedProjects]);

  useEffect(() => {
    if (DESKTOP) {
      document.documentElement.classList.add("desktop-app");
      const savedPath = window.localStorage.getItem("yu-library-root");
      if (savedPath || linkedProjects.length) loadNativeDirectory(savedPath, true, linkedProjects);
      return undefined;
    }
    let cancelled = false;
    loadRootHandle().then(async (handle) => {
      if (!handle || cancelled) return;
      setRootHandle(handle);
      setRootName(handle.name);
      const permission = await handle.queryPermission({ mode: "read" });
      if (permission === "granted") await loadDirectory(handle);
      else setPermissionNeeded(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => { localStorage.setItem("yu-favorites", JSON.stringify([...favorites])); }, [favorites]);
  useEffect(() => { localStorage.setItem("yu-notes", JSON.stringify(notes)); }, [notes]);
  useEffect(() => { localStorage.setItem("yu-category-labels", JSON.stringify(categoryLabels)); }, [categoryLabels]);
  useEffect(() => { localStorage.setItem("yu-category-orders", JSON.stringify(categoryOrders)); }, [categoryOrders]);
  useEffect(() => { localStorage.setItem("yu-linked-projects", JSON.stringify(linkedProjects)); }, [linkedProjects]);

  useEffect(() => {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const nextPrimary = visibleItems.find((item) => item.id === selected?.id) || null;
    setSelected(nextPrimary);
    setSelectedIds((current) => {
      const kept = [...current].filter((id) => visibleIds.has(id));
      return new Set(kept);
    });
  }, [visibleItems]);

  useEffect(() => {
    setCategory("全部");
    setSelected(null);
    setSelectedIds(new Set());
    setSelectionAnchorId("");
  }, [activeArea, project, mode]);

  useEffect(() => {
    if (!project && projects.length) {
      setProject(projects[0]);
      setActiveArea("项目素材");
    }
  }, [projects, project]);

  async function loadDirectory(handle) {
    setScanning(true);
    setPermissionNeeded(false);
    try {
      files.forEach((item) => { if (item.previewUrl && item.isImage) URL.revokeObjectURL(item.previewUrl); });
      const nextFiles = await scanDirectoryHandle(handle);
      setFiles(nextFiles);
      setRootName(handle.name);
      setRootHandle(handle);
      setToast(`已读取 ${nextFiles.length} 个本地文件`);
      const firstProject = nextFiles.find((item) => item.area === "项目素材")?.project;
      if (firstProject) { setProject(firstProject); setActiveArea("项目素材"); }
      else if (nextFiles.some((item) => item.area === "下载素材")) setActiveArea("下载素材");
      else if (nextFiles.some((item) => item.area === "AI制作素材")) setActiveArea("AI制作素材");
      else setActiveArea("待整理");
    } catch (error) {
      setToast(error?.message || "读取文件夹失败");
    } finally {
      setScanning(false);
    }
  }

  async function loadNativeDirectory(nextRootPath, quiet = false, projectLinks = linkedProjects) {
    if (!nextRootPath && !projectLinks.length) return;
    setScanning(true);
    setPermissionNeeded(false);
    try {
      const result = nextRootPath ? await window.yuDesktop.scanLibrary(nextRootPath) : null;
      const rootIsLibrary = result ? result.isManagedLibrary || hasLibraryStructure(result.files) : false;
      let nextFiles = result
        ? rootIsLibrary
          ? recordsFromNative(result.files)
          : recordsAsProject(result.files, result.rootName, result.rootPath)
        : [];

      const normalizedRoot = result?.rootPath?.toLowerCase();
      const validLinks = [];
      for (const link of projectLinks) {
        if (!link?.path || link.path.toLowerCase() === normalizedRoot) continue;
        try {
          const linkedResult = await window.yuDesktop.scanLibrary(link.path);
          const linkedName = link.name || linkedResult.rootName;
          nextFiles.push(...recordsAsProject(linkedResult.files, linkedName, linkedResult.rootPath));
          validLinks.push({ name: linkedName, path: linkedResult.rootPath });
        } catch {
          // Keep the rest of the library usable when a linked drive is offline.
        }
      }
      nextFiles = [...new Map(nextFiles.map((item) => [item.fullPath.toLowerCase(), item])).values()];
      setFiles(nextFiles);
      setRootName(result?.rootName || (validLinks.length ? `${validLinks.length} 个项目` : ""));
      setRootPath(result?.rootPath || "");
      setRootKind(result ? (rootIsLibrary ? "library" : "project") : "none");
      if (result) window.localStorage.setItem("yu-library-root", result.rootPath);
      if (validLinks.length !== projectLinks.length) setLinkedProjects(validLinks);
      if (!quiet) setToast(result?.truncated ? `已读取前 ${nextFiles.length} 个文件` : `已读取 ${nextFiles.length} 个本地文件`);
      const firstProject = nextFiles.find((item) => item.area === "项目素材")?.project;
      if (firstProject) { setProject(firstProject); setActiveArea("项目素材"); }
      else if (nextFiles.some((item) => item.area === "下载素材")) setActiveArea("下载素材");
      else if (nextFiles.some((item) => item.area === "AI制作素材")) setActiveArea("AI制作素材");
      else setActiveArea("待整理");
    } catch (error) {
      setFiles([]);
      setRootPath("");
      setRootKind("none");
      window.localStorage.removeItem("yu-library-root");
      if (!quiet) setToast(error?.message || "读取文件夹失败");
    } finally {
      setScanning(false);
    }
  }

  async function addProjectFolder(folderPath) {
    if (!folderPath) return;
    try {
      const [description] = await window.yuDesktop.describePaths([folderPath]);
      if (!description?.isDirectory) throw new Error("请选择项目文件夹");
      if (rootPath && description.path.toLowerCase() === rootPath.toLowerCase()) {
        await loadNativeDirectory(rootPath, true, linkedProjects);
        setProject(description.name);
        setActiveArea("项目素材");
        setToast(`“${description.name}”已识别为项目`);
        return;
      }
      const nextLinks = [
        ...linkedProjects.filter((item) => item.path.toLowerCase() !== description.path.toLowerCase()),
        { name: description.name, path: description.path },
      ];
      setLinkedProjects(nextLinks);
      await loadNativeDirectory(rootPath, true, nextLinks);
      setProject(description.name);
      setMode("制作素材");
      setActiveArea("项目素材");
      setToast(`已添加项目“${description.name}”，原文件保持在原位置`);
    } catch (error) {
      setToast(error?.message || "无法添加项目文件夹");
    }
  }

  async function chooseProjectFolder() {
    setImportOpen(false);
    if (!DESKTOP) return folderInputRef.current?.click();
    const folderPath = await window.yuDesktop.pickProjectFolder();
    if (folderPath) await addProjectFolder(folderPath);
  }

  async function chooseDirectory() {
    setImportOpen(false);
    if (DESKTOP) {
      try {
        const nextRootPath = await window.yuDesktop.pickLibraryFolder();
        if (nextRootPath) await loadNativeDirectory(nextRootPath);
      } catch (error) {
        setToast(error?.message || "无法读取这个文件夹");
      }
      return;
    }
    if (!("showDirectoryPicker" in window)) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      await saveRootHandle(handle);
      await loadDirectory(handle);
    } catch (error) {
      if (error?.name !== "AbortError") setToast("无法读取这个文件夹");
    }
  }

  async function reconnectDirectory() {
    if (DESKTOP) return rootPath ? loadNativeDirectory(rootPath) : chooseDirectory();
    if (!rootHandle) return chooseDirectory();
    const permission = await rootHandle.requestPermission({ mode: "read" });
    if (permission === "granted") await loadDirectory(rootHandle);
  }

  async function createLibraryStructure() {
    setImportOpen(false);
    if (DESKTOP) {
      try {
        const nextRootPath = await window.yuDesktop.createLibraryStructure(null);
        if (!nextRootPath) return;
        await loadNativeDirectory(nextRootPath, true);
        setToast("素材库基础结构已创建");
      } catch (error) {
        setToast(error?.message || "创建素材库结构失败");
      }
      return;
    }
    if (!("showDirectoryPicker" in window)) {
      setToast("当前浏览器只能读取文件夹，无法自动创建结构");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await createFolderPath(handle, ["00_待整理"]);
      await createFolderPath(handle, ["01_素材", "下载素材"]);
      await createFolderPath(handle, ["01_素材", "AI制作素材"]);
      await createFolderPath(handle, ["02_项目素材"]);
      await saveRootHandle(handle);
      await loadDirectory(handle);
      setToast("素材库基础结构已创建");
    } catch (error) {
      if (error?.name !== "AbortError") setToast("创建素材库结构失败");
    }
  }

  function addFiles(fileList) {
    const records = recordsFromFileList(fileList);
    setFiles((current) => [...current, ...records]);
    setActiveArea("待整理");
    setToast(`已添加 ${records.length} 个文件到待整理`);
  }

  async function prepareReusableLibrary() {
    if (rootPath && rootKind === "library") return { libraryPath: rootPath, projectLinks: linkedProjects };

    let nextLinks = linkedProjects;
    if (rootPath && rootKind === "project") {
      nextLinks = [
        ...linkedProjects.filter((item) => item.path.toLowerCase() !== rootPath.toLowerCase()),
        { name: rootName, path: rootPath },
      ];
    }
    const libraryPath = await window.yuDesktop.prepareAssetRoot();
    if (!libraryPath) return null;
    setLinkedProjects(nextLinks);
    return { libraryPath, projectLinks: nextLinks };
  }

  function activeImportArea() {
    return ["下载素材", "AI制作素材"].includes(activeArea) ? activeArea : "待整理";
  }

  async function importFilesToCurrentArea() {
    setImportOpen(false);
    if (!DESKTOP) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const targetArea = activeImportArea();
      const prepared = await prepareReusableLibrary();
      if (!prepared) return;
      const imported = await window.yuDesktop.pickFilesToArea(prepared.libraryPath, targetArea, "未分类");
      if (!imported.length) return;
      await loadNativeDirectory(prepared.libraryPath, true, prepared.projectLinks);
      setActiveArea(targetArea);
      setCategory("全部");
      setToast(`已添加 ${imported.length} 个文件到${targetArea}${targetArea === "待整理" ? "" : " · 未分类"}`);
    } catch (error) {
      setToast(error?.message || "添加文件失败");
    }
  }

  async function importLocalFiles() {
    setImportOpen(false);
    if (!DESKTOP) {
      fileInputRef.current?.click();
      return;
    }
    if (!rootPath || rootKind !== "library") {
      setToast(rootKind === "project" ? "这是项目文件夹，请把新文件直接放进去后刷新" : "请先选择或创建素材库文件夹");
      return;
    }
    try {
      const imported = await window.yuDesktop.importFiles(rootPath);
      if (!imported.length) return;
      await loadNativeDirectory(rootPath, true);
      setActiveArea("待整理");
      setToast(`已导入 ${imported.length} 个文件到待整理`);
    } catch (error) {
      setToast(error?.message || "导入文件失败");
    }
  }

  function changeArea(area) {
    setActiveArea(area);
    setImportOpen(false);
    setFilterOpen(false);
  }

  function categoryLabelKey(rawCategory, area = activeArea, targetProject = project, targetMode = mode) {
    return JSON.stringify([area, area === "项目素材" ? targetProject : "", area === "项目素材" ? targetMode : "", rawCategory]);
  }

  function displayCategory(rawCategory, area = activeArea, targetProject = project, targetMode = mode) {
    if (rawCategory === "全部") return rawCategory;
    return categoryLabels[categoryLabelKey(rawCategory, area, targetProject, targetMode)] || rawCategory;
  }

  function openCategoryRename(rawCategory) {
    setRenameCategoryRaw(rawCategory);
    setRenameCategoryValue(displayCategory(rawCategory));
  }

  function reorderCategory(dragged, target) {
    if (!dragged || dragged === target) return;
    const ordered = categories.filter((name) => name !== "全部" && name !== dragged);
    const targetIndex = ordered.indexOf(target);
    ordered.splice(targetIndex < 0 ? ordered.length : targetIndex, 0, dragged);
    setCategoryOrders((current) => ({ ...current, [categoryOrderKey]: ordered }));
    setDraggingCategory("");
  }

  function saveCategoryRename() {
    const name = renameCategoryValue.trim();
    if (!name) {
      setToast("分类名称不能为空");
      return;
    }
    const key = categoryLabelKey(renameCategoryRaw);
    setCategoryLabels((current) => ({ ...current, [key]: name }));
    setRenameCategoryRaw("");
    setToast(`分类已重命名为“${name}”`);
  }

  function restoreCategoryName() {
    const key = categoryLabelKey(renameCategoryRaw);
    setCategoryLabels((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setRenameCategoryRaw("");
    setToast("已恢复默认分类名称");
  }

  function selectProject(nextProject) {
    setProject(nextProject);
    setActiveArea("项目素材");
  }

  function toggleFavorite(id) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAsset(item, event = {}) {
    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = visibleItems.findIndex((entry) => entry.id === selectionAnchorId);
      const itemIndex = visibleItems.findIndex((entry) => entry.id === item.id);
      if (anchorIndex > -1 && itemIndex > -1) {
        const [start, end] = anchorIndex < itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
        setSelectedIds(new Set(visibleItems.slice(start, end + 1).map((entry) => entry.id)));
      }
    } else if (event.ctrlKey || event.metaKey) {
      toggleAssetSelection(item);
    } else {
      setSelectedIds(new Set([item.id]));
    }
    setSelected(item);
    if (!event.shiftKey) setSelectionAnchorId(item.id);
  }

  function toggleAssetSelection(item) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
    setSelected(item);
    setSelectionAnchorId(item.id);
  }

  function startFileDrag(item, event, allowButton = false) {
    if (!DESKTOP || !item?.fullPath || (!allowButton && event.target.closest("button"))) {
      event.preventDefault();
      return;
    }
    const paths = selectedIds.has(item.id) && selectedIds.size > 1
      ? files.filter((entry) => selectedIds.has(entry.id) && entry.fullPath).map((entry) => entry.fullPath)
      : [item.fullPath];
    draggingOutRef.current = true;
    event.dataTransfer.effectAllowed = "copy";
    event.preventDefault();
    window.yuDesktop.startFileDrag(paths);
  }

  async function previewSelected(item) {
    if (DESKTOP && item.fullPath) {
      try {
        await window.yuDesktop.openPath(item.fullPath);
      } catch (error) {
        setToast(error?.message || "无法打开文件");
      }
      return;
    }
    if (item.previewUrl) window.open(item.previewUrl, "_blank", "noopener,noreferrer");
    else setToast("该文件需要在本地软件中打开");
  }

  async function revealSelected(item) {
    if (!DESKTOP || !item?.fullPath) return;
    try {
      await window.yuDesktop.revealPath(item.fullPath);
    } catch (error) {
      setToast(error?.message || "无法定位文件");
    }
  }

  function refreshLibrary() {
    if (DESKTOP && (rootPath || linkedProjects.length)) loadNativeDirectory(rootPath, false, linkedProjects);
    else if (rootHandle) loadDirectory(rootHandle);
  }

  async function handleDrop(event) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (draggingOutRef.current) return;
    if (DESKTOP) {
      try {
        const droppedPaths = Array.from(event.dataTransfer.files)
          .map((file) => window.yuDesktop.getPathForFile(file))
          .filter(Boolean);
        const dropped = await window.yuDesktop.describePaths(droppedPaths);
        const folders = dropped.filter((item) => item.isDirectory);
        const looseFiles = dropped.filter((item) => item.isFile).map((item) => item.path);
        let activeLinks = linkedProjects;
        if (folders.length) {
          let nextLinks = linkedProjects;
          for (const folder of folders) {
            if (rootPath && folder.path.toLowerCase() === rootPath.toLowerCase()) continue;
            nextLinks = [
              ...nextLinks.filter((item) => item.path.toLowerCase() !== folder.path.toLowerCase()),
              { name: folder.name, path: folder.path },
            ];
          }
          activeLinks = nextLinks;
          setLinkedProjects(nextLinks);
          await loadNativeDirectory(rootPath, true, nextLinks);
          const lastFolder = folders.at(-1);
          setProject(lastFolder.name);
          setMode("制作素材");
          setActiveArea("项目素材");
          setToast(`已添加 ${folders.length} 个项目文件夹`);
        }
        if (looseFiles.length) {
          const targetArea = activeImportArea();
          const prepared = await prepareReusableLibrary();
          if (!prepared) {
            setToast("未选择通用素材保存位置，文件没有导入");
            return;
          }
          activeLinks = [...new Map([...activeLinks, ...prepared.projectLinks].map((item) => [item.path.toLowerCase(), item])).values()];
          const imported = await window.yuDesktop.importFilesToArea(prepared.libraryPath, looseFiles, targetArea, "未分类");
          await loadNativeDirectory(prepared.libraryPath, true, activeLinks);
          setActiveArea(targetArea);
          setCategory("全部");
          setToast(`已添加 ${imported.length} 个文件到${targetArea}${targetArea === "待整理" ? "" : " · 未分类"}`);
        }
      } catch (error) {
        setToast(error?.message || "拖入内容读取失败");
      }
      return;
    }
    addFiles(event.dataTransfer.files);
  }

  function openOrganizer() {
    const sourceItem = selectedItems[0] || selected;
    if (["下载素材", "AI制作素材"].includes(sourceItem?.area)) {
      setOrganizeArea(sourceItem.area);
      setOrganizeCategory(sourceItem.category === "未分类" ? "" : sourceItem.category);
      setOrganizerOpen(true);
      return;
    }
    const sourceCategory = SOURCE_EXTENSIONS.has(sourceItem?.extension) ? "源文件" : "渲染图";
    setOrganizeArea("项目素材");
    setOrganizeProject(sourceItem?.project || project || projects[0] || "");
    setOrganizeMode(sourceItem?.mode || "制作素材");
    setOrganizeCategory(sourceItem?.area === "项目素材" ? sourceItem.category : sourceCategory);
    setOrganizerOpen(true);
  }

  function openFileRename(item) {
    setRenameItem(item);
    const dot = item.name.lastIndexOf(".");
    setRenameValue(dot > 0 ? item.name.slice(0, dot) : item.name);
    setRenameError("");
  }

  async function confirmFileRename(event) {
    event.preventDefault();
    if (renameBusy || !renameItem) return;
    setRenameBusy(true);
    setRenameError("");
    try {
      const destination = await window.yuDesktop.renameFile(renameItem.sourceRoot || rootPath, renameItem.fullPath, renameValue);
      const name = destination.split(/[\\/]/).at(-1);
      const next = { ...renameItem, id: destination, fullPath: destination, name,
        relativePath: renameItem.relativePath.split("/").slice(0, -1).concat(name).join("/"),
        previewUrl: renameItem.isImage ? `yu-asset://file/${btoa(unescape(encodeURIComponent(destination))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}?v=${Date.now()}` : renameItem.previewUrl };
      setFiles((current) => [...current.filter((item) => item.id !== renameItem.id && item.id !== destination), next]);
      setSelected((current) => current?.id === renameItem.id ? next : current);
      setSelectedIds((current) => { const values = new Set(current); if (values.delete(renameItem.id)) values.add(destination); return values; });
      setFavorites((current) => { const values = new Set(current); if (values.delete(renameItem.id)) values.add(destination); return values; });
      setNotes((current) => { const values = { ...current }; if (renameItem.id !== destination && Object.hasOwn(values, renameItem.id)) { values[destination] = values[renameItem.id]; delete values[renameItem.id]; } return values; });
      setRenameItem(null);
      setToast(`已重命名为 ${name}`);
    } catch (error) { setRenameError(error?.message || "重命名失败"); }
    finally { setRenameBusy(false); }
  }

  async function confirmOrganize() {
    const itemsToMove = selectedItems.length ? selectedItems : selected ? [selected] : [];
    if (!canOrganizeSelection || !itemsToMove.length || !(organizeSourceRoot || rootPath)) return;
    if (organizeArea === "项目素材" && !organizeProject.trim()) {
      setToast("请填写项目名称，例如“第三代”");
      return;
    }
    try {
      const moves = await window.yuDesktop.organizeFiles(organizeSourceRoot || rootPath, itemsToMove.map((item) => item.fullPath), {
        directProject: Boolean(organizeSourceRoot),
        area: organizeArea,
        project: organizeProject,
        mode: organizeMode,
        category: organizeCategory,
      });
      setFavorites((current) => {
        const next = new Set(current);
        moves.forEach(({ source, destination }) => { if (next.delete(source)) next.add(destination); });
        return next;
      });
      setNotes((current) => {
        const next = { ...current };
        moves.forEach(({ source, destination }) => { if (next[source]) { next[destination] = next[source]; delete next[source]; } });
        return next;
      });
      setOrganizerOpen(false);
      setSelectedIds(new Set());
      setSelected(null);
      await loadNativeDirectory(rootPath, true, linkedProjects);
      if (organizeArea === "项目素材") { setProject(organizeProject.trim()); setMode(organizeMode); }
      setActiveArea(organizeArea);
      setToast(`已整理 ${moves.length} 个文件到目标位置`);
    } catch (error) {
      setToast(error?.message || "整理文件失败");
    }
  }

  function openDeleteConfirm() {
    if (!canDeleteSelection) {
      setToast("只能删除素材库中的文件；链接项目请在原文件夹中处理");
      return;
    }
    setDeleteConfirmOpen(true);
  }

  async function confirmDelete() {
    if (!rootPath || !selectedItems.length) return;
    try {
      const deleted = await window.yuDesktop.trashFiles(rootPath, selectedItems.map((item) => item.fullPath));
      const deletedIds = new Set(deleted);
      setFavorites((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
      setNotes((current) => {
        const next = { ...current };
        deleted.forEach((id) => delete next[id]);
        return next;
      });
      setDeleteConfirmOpen(false);
      setSelectedIds(new Set());
      setSelected(null);
      await loadNativeDirectory(rootPath, true, linkedProjects);
      setToast(`已将 ${deleted.length} 个文件移到回收站`);
    } catch (error) {
      setToast(error?.message || "删除文件失败");
    }
  }

  const title = activeArea === "项目素材" ? project || "项目素材" : activeArea;

  return (
    <div
      className={`app-shell ${isDraggingFiles ? "files-dragging" : ""}`}
      style={{ "--sidebar-width": `${leftWidth}px`, "--inspector-width": `${rightWidth}px` }}
      onDragOver={(event) => event.preventDefault()}
      onDragEnd={() => { draggingOutRef.current = false; dragDepthRef.current = 0; setIsDraggingFiles(false); }}
      onDragEnter={(event) => {
        if (draggingOutRef.current) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        if (Array.from(event.dataTransfer.types).includes("Files")) setIsDraggingFiles(true);
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setIsDraggingFiles(false);
      }}
      onDrop={handleDrop}
    >
      <aside className="sidebar">
        <div className="brand"><img src={`${ASSET}knight-silver-aurora.png`} alt="银色骑士盾徽，左眼红色极光" /><span>瑜の素材库</span></div>
        <nav className="navigation" aria-label="素材库导航">
          <NavButton active={activeArea === "待整理"} icon={Archive} onClick={() => changeArea("待整理")}>待整理</NavButton>
          <div className="nav-group-label"><span>素材</span><CaretDown size={15} /></div>
          <NavButton active={activeArea === "下载素材"} icon={DownloadSimple} nested onClick={() => changeArea("下载素材")}>下载素材</NavButton>
          <NavButton active={activeArea === "AI制作素材"} icon={Sparkle} nested onClick={() => changeArea("AI制作素材")}>AI制作素材</NavButton>
          <button className="nav-group-label project-label project-import" onClick={chooseProjectFolder} title="点击选择，或把项目文件夹拖进窗口"><span>项目素材</span><Plus size={15} /></button>
          {projects.length ? projects.map((name) => (
            <NavButton key={name} active={activeArea === "项目素材" && project === name} icon={project === name ? FolderOpen : Folder} nested onClick={() => selectProject(name)}>{name}</NavButton>
          )) : <div className="nav-empty">点击“项目素材”或拖入项目文件夹</div>}
        </nav>
        <div className="sidebar-footer">
          <button aria-label="切换素材库" title={rootPath || "切换素材库"} onClick={chooseDirectory}><FolderOpen size={21} /></button>
          <button aria-label="刷新素材库" title="刷新素材库" disabled={scanning || (!rootPath && !rootHandle)} onClick={refreshLibrary}><SlidersHorizontal size={21} /></button>
        </div>
      </aside>

      <PanelDivider side="left" width={leftWidth} onResize={(width) => resizePanel("left", width)} />
      <main className="workspace">
        <header className="topbar">
          <label className="searchbox">
            <MagnifyingGlass size={21} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材、项目或文件" aria-label="搜索素材、项目或文件" />
            {query && <button className="clear-search" onClick={() => setQuery("")} aria-label="清除搜索"><X size={15} /></button>}
          </label>
          <div className="import-wrap">
            <button className="import-button" onClick={() => setImportOpen((open) => !open)} aria-expanded={importOpen}>
              <UploadSimple size={19} /><span>导入素材</span><CaretDown size={14} />
            </button>
            {importOpen && (
              <div className="import-menu">
                <button onClick={importFilesToCurrentArea}><File size={18} />{DESKTOP ? `添加文件到${activeImportArea()}` : "选择本地文件"}</button>
                {DESKTOP && <button onClick={chooseProjectFolder}><Folder size={18} />添加项目文件夹</button>}
                <button onClick={chooseDirectory}><FolderOpen size={18} />读取素材库文件夹</button>
                <button onClick={createLibraryStructure}><Plus size={18} />创建基础目录结构</button>
              </div>
            )}
          </div>
          {DESKTOP && (
            <div className="window-actions">
              <button onClick={() => window.yuDesktop.minimizeWindow()} aria-label="最小化"><Minus size={16} /></button>
              <button onClick={() => window.yuDesktop.toggleMaximizeWindow()} aria-label="最大化或还原"><Square size={13} /></button>
              <button className="window-close" onClick={() => window.yuDesktop.closeWindow()} aria-label="关闭"><X size={16} /></button>
            </div>
          )}
        </header>

        <section className="content-column">
          <div className="content-heading">
            <div>
              <div className="title-row"><h1>{title}</h1>{rootName && <span className="result-count">{visibleItems.length} 个素材 · {rootName}</span>}</div>
              {activeArea === "项目素材" && project && (
                <div className="mode-tabs" role="tablist" aria-label="项目素材类型">
                  {["参考素材", "制作素材"].map((tab) => <button key={tab} className={mode === tab ? "active" : ""} onClick={() => setMode(tab)} role="tab" aria-selected={mode === tab}>{tab}</button>)}
                </div>
              )}
            </div>
            <div className="view-actions">
              <div className="view-toggle">
                <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="网格视图"><GridFour size={20} /></button>
                <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="列表视图"><ListBullets size={20} /></button>
              </div>
              <div className="filter-wrap">
                <button className={`icon-button ${filterOpen ? "active" : ""}`} onClick={() => setFilterOpen((open) => !open)} aria-label="更多筛选"><Funnel size={20} /></button>
                {filterOpen && (
                  <div className="filter-menu"><strong>文件类型</strong>{["全部", "PSD", "JPG", "PNG", "BLEND"].map((type) => <button key={type} onClick={() => { setQuery(type === "全部" ? "" : type); setFilterOpen(false); }}>{type}</button>)}</div>
                )}
              </div>
            </div>
          </div>

          {!!files.length && categories.length > 1 && (
            <div className="category-bar" aria-label="素材分类筛选">
              {categories.map((item) => item === "全部" ? (
                <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>
              ) : (
                <div
                  className={`category-chip ${category === item ? "active" : ""} ${draggingCategory === item ? "dragging" : ""}`}
                  key={item}
                  draggable
                  title="拖动调整分类顺序"
                  onDragStart={(event) => {
                    event.stopPropagation();
                    setDraggingCategory(item);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item);
                  }}
                  onDragEnd={() => setDraggingCategory("")}
                  onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }}
                  onDrop={(event) => { event.preventDefault(); event.stopPropagation(); reorderCategory(draggingCategory || event.dataTransfer.getData("text/plain"), item); }}
                >
                  <span className="category-drag-handle" aria-hidden="true"><DotsSixVertical size={14} /></span>
                  <button className="category-filter" onClick={() => setCategory(item)}>{displayCategory(item)}</button>
                  <button className="category-rename" onClick={() => openCategoryRename(item)} title={`重命名“${displayCategory(item)}”`} aria-label={`重命名“${displayCategory(item)}”`}><PencilSimple size={13} /></button>
                </div>
              ))}
            </div>
          )}

          {selectedIds.size > 1 && (
            <div className="batch-selection-bar" role="toolbar" aria-label="批量选择操作">
              <strong>已选择 {selectedIds.size} 项</strong>
              <button onClick={() => setSelectedIds(new Set(visibleItems.map((item) => item.id)))}>全选当前结果</button>
              <button onClick={() => { setSelectedIds(new Set()); setSelected(null); }}>取消选择</button>
              {canOrganizeSelection && <button className="batch-organize" onClick={openOrganizer}>移动 / 分类…</button>}
              {canDeleteSelection && <button className="batch-delete" onClick={openDeleteConfirm}><Trash size={15} />移到回收站</button>}
            </div>
          )}

          {scanning ? (
            <div className="empty-state"><div className="spinner" /><h2>正在读取素材</h2><p>只建立索引，不移动或修改原文件。</p></div>
          ) : (!files.length && !rootName) || permissionNeeded ? (
            <div className="empty-state library-empty">
              <div className="empty-crest"><FolderOpen size={42} weight="duotone" /></div>
              <h2>{permissionNeeded ? "重新连接你的素材库" : "把电脑里的素材接进来"}</h2>
              <p>{permissionNeeded ? `请重新授权读取“${rootName}”文件夹。` : "选择一个文件夹后，瑜の素材库会按现有目录自动归类并生成缩略图，不会移动或修改原文件。"}</p>
              <div className="empty-actions">
                <button className="primary-empty" onClick={permissionNeeded ? reconnectDirectory : chooseDirectory}><FolderOpen size={18} />{permissionNeeded ? "重新连接" : "选择素材库文件夹"}</button>
                {!permissionNeeded && <button onClick={createLibraryStructure}>创建基础目录</button>}
              </div>
              <span className="drop-hint">{DESKTOP ? "可直接拖入“第三代”这类项目文件夹，原文件不会被复制。" : "也可以把零散文件直接拖到这里，先进入“待整理”"}</span>
            </div>
          ) : visibleItems.length ? (
            <div key={JSON.stringify([activeArea, project, mode, category, view])} className={`asset-grid ${view === "list" ? "list-view" : ""}`}>
              {visibleItems.map((item) => <AssetCard key={item.id} item={item} selected={selectedIds.has(item.id)} favorite={favorites.has(item.id)} view={view} onSelect={selectAsset} onToggleSelection={toggleAssetSelection} onFavorite={toggleFavorite} onOpen={previewSelected} onRename={openFileRename} onDragFile={startFileDrag} />)}
            </div>
          ) : (
            <div className="empty-state compact">
              <ImageIcon size={42} weight="duotone" />
              <h2>{query || category !== "全部" ? "没有找到匹配素材" : `${title}里还没有文件`}</h2>
              <p>{query || category !== "全部" ? "换个关键词或查看全部分类。" : ["下载素材", "AI制作素材"].includes(activeArea) ? "把文件直接拖到这里；首次添加时选择一次通用素材的保存位置。" : "保持现在的目录逻辑，把对应文件放进文件夹后刷新即可。"}</p>
              <button onClick={() => {
                if (query || category !== "全部") { setQuery(""); setCategory("全部"); }
                else if (["下载素材", "AI制作素材"].includes(activeArea)) importFilesToCurrentArea();
                else refreshLibrary();
              }}>{query || category !== "全部" ? "清除筛选" : ["下载素材", "AI制作素材"].includes(activeArea) ? `添加到${activeArea}` : "刷新文件夹"}</button>
            </div>
          )}
        </section>

        <PanelDivider side="right" width={rightWidth} onResize={(width) => resizePanel("right", width)} />
        <aside className="inspector">
          {selected ? (
            <>
              <button key={selected.id} className="inspector-preview" onClick={() => previewSelected(selected)} draggable={DESKTOP && Boolean(selected.fullPath)} onDragStart={(event) => startFileDrag(selected, event, true)} title={DESKTOP ? "拖到其他应用以使用原始文件" : undefined} aria-label="预览素材"><FilePreview item={selected} compact /></button>
              <div className="inspector-title-row">
                <h2>{selected.name}</h2>
                <button className={favorites.has(selected.id) ? "favorite active" : "favorite"} onClick={() => toggleFavorite(selected.id)} aria-label="收藏素材"><Star size={21} weight={favorites.has(selected.id) ? "fill" : "regular"} /></button>
              </div>
              <dl className="metadata">
                <div><dt>文件路径</dt><dd><button className="path-row path-button" onClick={() => revealSelected(selected)} title={DESKTOP ? "在资源管理器中显示" : selected.relativePath}><span>{selected.relativePath}</span><FolderOpen size={19} /></button></dd></div>
                <div className="meta-split"><div><dt>大小</dt><dd>{selected.size}</dd></div><div><dt>修改日期</dt><dd>{selected.modified}</dd></div></div>
                <div><dt>类型</dt><dd>{selected.type}</dd></div>
              </dl>
              {DESKTOP && (
                <div className="inspector-actions">
                  <button onClick={() => openFileRename(selected)}><PencilSimple size={16} />重命名</button>
                  <button className="open-file-button" onClick={() => previewSelected(selected)}>打开文件</button>
                  <button onClick={() => revealSelected(selected)}>所在文件夹</button>
                  {canOrganizeSelection && <button className="organize-button" onClick={openOrganizer}>{selected.area === "待整理" ? "整理到…" : "移动 / 分类…"}</button>}
                  {canDeleteSelection && selectedItems.length === 1 && <button className="delete-button" onClick={openDeleteConfirm}><Trash size={16} />移到回收站</button>}
                </div>
              )}
              <div className="tags-section">
                <span className="section-label">目录标签</span>
                <div className="tag-list">{selected.tags.map((tag) => <span key={tag}>{tag === selected.category ? displayCategory(tag, selected.area, selected.project, selected.mode) : tag}</span>)}</div>
              </div>
              <label className="note-editor">备注<textarea placeholder="写一点方便自己查找的备注…" value={notes[selected.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [selected.id]: event.target.value }))} /></label>
            </>
          ) : (
            <div className="inspector-placeholder"><ImageIcon size={36} /><span>选择素材查看详情</span></div>
          )}
        </aside>
      </main>

      <input ref={fileInputRef} className="hidden-input" type="file" multiple onChange={(event) => addFiles(event.target.files)} />
      <input ref={folderInputRef} className="hidden-input" type="file" multiple webkitdirectory="true" onChange={(event) => addFiles(event.target.files)} />
      {organizerOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrganizerOpen(false); }}>
          <section className="organize-dialog" role="dialog" aria-modal="true" aria-labelledby="organize-title">
            <div className="dialog-heading"><div><h2 id="organize-title">整理文件</h2><p title={selectedItems.length > 1 ? "" : selected?.name}>{selectedItems.length > 1 ? `已选择 ${selectedItems.length} 个文件` : selected?.name}</p></div><button onClick={() => setOrganizerOpen(false)} aria-label="关闭"><X size={18} /></button></div>
            <label>整理到<select disabled={Boolean(organizeSourceRoot)} value={organizeArea} onChange={(event) => setOrganizeArea(event.target.value)}><option>项目素材</option><option>下载素材</option><option>AI制作素材</option></select></label>
            {organizeArea === "项目素材" ? (
              <>
                <label>项目名称<input disabled={Boolean(organizeSourceRoot)} value={organizeProject} onChange={(event) => setOrganizeProject(event.target.value)} placeholder="例如：第三代" list="project-names" /><datalist id="project-names">{projects.map((name) => <option value={name} key={name} />)}</datalist></label>
                <div className="dialog-pair">
                  <label>素材用途<select value={organizeMode} onChange={(event) => { const nextMode = event.target.value; setOrganizeMode(nextMode); if (["源文件", "PS源文件"].includes(organizeCategory)) setOrganizeCategory(nextMode === "参考素材" ? "PS源文件" : "源文件"); }}><option>参考素材</option><option>制作素材</option></select></label>
                  <label>文件分类<input value={organizeCategory} onChange={(event) => setOrganizeCategory(event.target.value)} placeholder="输入新分类或选择已有分类" list="project-category-options" /><datalist id="project-category-options">{projectCategoryOptions.map((name) => <option value={name} label={displayCategory(name, "项目素材", organizeProject, organizeMode)} key={name} />)}</datalist></label>
                </div>
                <div className="category-suggestions">{projectCategoryOptions.map((name) => <button type="button" className={organizeCategory === name ? "active" : ""} onClick={() => setOrganizeCategory(name)} key={name}>{displayCategory(name, "项目素材", organizeProject, organizeMode)}</button>)}</div>
                <p>输入自定义分类名称，点击“移动到这里”后自动创建分类文件夹。</p>
              </>
            ) : <label>素材类型<input value={organizeCategory} onChange={(event) => setOrganizeCategory(event.target.value)} placeholder="例如：动物、室内" list="existing-material-categories" /><datalist id="existing-material-categories">{organizeCategoryOptions.map((name) => <option value={name} label={displayCategory(name, organizeArea)} key={name} />)}</datalist>{organizeCategoryOptions.length > 0 && <div className="category-suggestions">{organizeCategoryOptions.map((name) => <button type="button" className={organizeCategory === name ? "active" : ""} onClick={() => setOrganizeCategory(name)} key={name}>{displayCategory(name, organizeArea)}</button>)}</div>}</label>}
            <div className="dialog-actions"><button onClick={() => setOrganizerOpen(false)}>取消</button><button className="confirm-organize" onClick={confirmOrganize}>移动到这里</button></div>
          </section>
        </div>
      )}
      {renameItem && (
        <div className="dialog-backdrop">
          <form className="organize-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-file-title" onSubmit={confirmFileRename} onKeyDown={(event) => { if (event.key === "Escape" && !renameBusy) setRenameItem(null); }}>
            <div className="dialog-heading"><div><h2 id="rename-file-title">重命名文件</h2><p>修改原文件名称，扩展名保持不变。</p></div><button type="button" disabled={renameBusy} onClick={() => setRenameItem(null)} aria-label="关闭"><X size={18} /></button></div>
            <label>文件名称<input autoFocus disabled={renameBusy} value={renameValue} onFocus={(event) => event.target.select()} onChange={(event) => setRenameValue(event.target.value)} /></label>
            {renameError && <p role="alert">{renameError}</p>}
            <div className="dialog-actions"><button type="button" disabled={renameBusy} onClick={() => setRenameItem(null)}>取消</button><button className="confirm-organize" disabled={renameBusy || !renameValue.trim()} type="submit">{renameBusy ? "正在保存…" : "保存名称"}</button></div>
          </form>
        </div>
      )}
      {renameCategoryRaw && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameCategoryRaw(""); }}>
          <section className="organize-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-category-title">
            <div className="dialog-heading"><div><h2 id="rename-category-title">重命名分类</h2><p>只修改素材库里的显示名称，不改动原文件夹。</p></div><button onClick={() => setRenameCategoryRaw("")} aria-label="关闭"><X size={18} /></button></div>
            <label>分类名称<input autoFocus value={renameCategoryValue} onChange={(event) => setRenameCategoryValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCategoryRename(); }} /></label>
            <div className="dialog-actions"><button onClick={restoreCategoryName}>恢复默认</button><button onClick={() => setRenameCategoryRaw("")}>取消</button><button className="confirm-organize" onClick={saveCategoryRename}>保存名称</button></div>
          </section>
        </div>
      )}
      {deleteConfirmOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteConfirmOpen(false); }}>
          <section className="organize-dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="dialog-heading"><div><h2 id="delete-title">移到回收站？</h2><p>{selectedItems.length > 1 ? `将 ${selectedItems.length} 个已选文件移到 Windows 回收站。` : selectedItems[0]?.name}</p></div><button onClick={() => setDeleteConfirmOpen(false)} aria-label="关闭"><X size={18} /></button></div>
            <div className="delete-note">文件不会被永久删除，需要时可以从回收站恢复。</div>
            <div className="dialog-actions"><button onClick={() => setDeleteConfirmOpen(false)}>取消</button><button className="confirm-delete" onClick={confirmDelete}><Trash size={16} />移到回收站</button></div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status"><CheckCircle size={18} weight="fill" />{toast}</div>}
    </div>
  );
}
