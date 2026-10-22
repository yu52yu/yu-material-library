import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROJECT_LINKS_STORAGE_KEY, normalizeProjectLinks, saveLinkGroup, removeLinkGroup,
  removeLinkMember, remapLinkedFiles, removeLinkedFiles, groupsForFile,
} from "./project-links.js";
import { ProjectLinkDialog, ProjectGroupList, ProjectLinksInspector } from "./ProjectLinks.jsx";
import { FILE_SORT_STORAGE_KEY, normalizeFileSort, sortFiles } from "./file-sort.js";
import { CATEGORY_DRAG_TYPE, isCategoryDrag, isFileDrag, fileDropEffect, snapshotFileDrop } from "./file-drop.js";
import { currentDropTarget } from "./drop-target.js";
import { CatalogCategories, CatalogAssetEditor, CatalogFilters, CatalogStorageDialog, MaterialAreaDialog } from "./CatalogControls.jsx";
import { DEFAULT_MATERIAL_AREAS, materialAreasFromCatalog, isMaterialArea, reusablePath } from "./material-areas.js";
import { matchesCatalogAsset, mediaTypeFor, categoryBreadcrumb } from "./catalog-view.js";
import { catalogEntry, mergeCatalogRecords, legacyCatalogPayload, normalizedPath } from "./catalog-integration.js";
import "./catalog-controls.css";
import {
  Archive,
  CaretDown,
  Check,
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
  LinkSimple,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  SlidersHorizontal,
  SortAscending,
  SortDescending,
  Sparkle,
  Square,
  Star,
  Trash,
  X,
} from "@phosphor-icons/react";

const ASSET = "./assets/";
const DESKTOP = Boolean(window.yuDesktop);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]);
const SOURCE_EXTENSIONS = new Set(["psd", "psb", "blend", "obj", "fbx", "stp", "step", "ai", "cdr"]);
const MAX_FILES = 1200;
const FILE_SORT_FIELDS = [
  ["name", "名称"], ["modified", "修改时间"], ["size", "大小"], ["type", "类型"],
];

function FileSortControl({ value, onChange, onOpen }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const SortIcon = value.direction === "asc" ? SortAscending : SortDescending;
  const directionLabels = value.field === "modified" ? ["最早优先", "最新优先"]
    : value.field === "size" ? ["从小到大", "从大到小"] : ["升序", "降序"];
  const fieldLabel = FILE_SORT_FIELDS.find(([field]) => field === value.field)?.[1];
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[aria-checked="true"]')?.focus();
    const outside = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const show = () => { onOpen(); setOpen(true); };
  const choose = (next) => { onChange(next); close(true); };
  return <div className="sort-wrap" ref={wrapRef} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={triggerRef} className={`icon-button ${open ? "active" : ""}`}
      aria-label="排列方式" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? "file-sort-menu" : undefined}
      title={`${fieldLabel} · ${directionLabels[value.direction === "asc" ? 0 : 1]}`}
      onClick={() => open ? close() : show()}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(); }
      }}><SortIcon size={20} /></button>
    {open && <div ref={menuRef} id="file-sort-menu" className="sort-menu" role="menu" aria-label="文件排列" onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const options = [...menuRef.current.querySelectorAll('[role="menuitemradio"]')];
      const current = options.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    }}>
      <div className="sort-menu-label">排列方式</div>
      <div role="group" aria-label="排列字段">
        {FILE_SORT_FIELDS.map(([field, label]) => <button key={field} role="menuitemradio" aria-checked={value.field === field}
          className={value.field === field ? "selected" : ""} onClick={() => choose({ ...value, field })}>
          <span>{label}</span>{value.field === field && <Check size={14} aria-hidden="true" />}
        </button>)}
      </div>
      <div className="sort-menu-divider" role="separator" />
      <div className="sort-menu-label">顺序</div>
      <div role="group" aria-label="排列顺序">
        {["asc", "desc"].map((direction, index) => <button key={direction} role="menuitemradio" aria-checked={value.direction === direction}
          className={value.direction === direction ? "selected" : ""} onClick={() => choose({ ...value, direction })}>
          <span>{directionLabels[index]}</span>{value.direction === direction && <Check size={14} aria-hidden="true" />}
        </button>)}
      </div>
    </div>}
  </div>;
}

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

function classifyPath(relativePath, materialAreas = DEFAULT_MATERIAL_AREAS) {
  const rawParts = relativePath.split("/").filter(Boolean);
  const fileName = rawParts.at(-1) || "";
  const folders = rawParts.slice(0, -1);
  const clean = folders.map(stripOrderPrefix);
  const extension = extensionOf(fileName);
  const reusable = reusablePath(relativePath, materialAreas);
  if (reusable) return { area: reusable.area, project: "", mode: "", category: reusable.category };

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
    sizeBytes: file.size,
    modifiedAt: file.lastModified,
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

function recordsFromNative(entries, materialAreas = DEFAULT_MATERIAL_AREAS) {
  const records = entries.map((entry) => {
    const classification = classifyPath(entry.relativePath, materialAreas);
    return {
      id: entry.fullPath,
      fileKey: entry.fileKey || "",
      rootPath: entry.rootPath || "",
      name: entry.name,
      fullPath: entry.fullPath,
      relativePath: entry.relativePath,
      extension: entry.extension,
      type: entry.extension ? entry.extension.toUpperCase() : "FILE",
      size: formatBytes(entry.size),
      sizeBytes: entry.size,
      modifiedAt: entry.modified,
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

function NavButton({ active, icon: Icon, children, onClick, nested = false, title }) {
  return (
    <button className={`nav-item ${active ? "active" : ""} ${nested ? "nested" : ""}`} onClick={onClick} title={title}>
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

function AssetCard({ item, selected, favorite, view, onSelect, onToggleSelection, onFavorite, onOpen, onRename, onDelete, canDelete, onDragFile }) {
  return (
    <article
      className={`asset-card ${selected ? "selected" : ""} ${view === "list" ? "list-card" : ""}`}
      onClick={(event) => onSelect(item, event)}
      onDoubleClick={() => onOpen(item)}
      title={DESKTOP && item.fullPath ? "拖到其他应用以使用原始文件" : undefined}
      draggable={DESKTOP && item.online !== false && Boolean(item.fullPath)}
      onDragStart={(event) => onDragFile(item, event)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") onSelect(item, event);
        if (event.key === "Delete" && canDelete) { event.preventDefault(); onDelete(item, selected); }
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
        <div className="asset-name-row">
          <div className="asset-name" title={item.name}>{item.name}</div>
          {DESKTOP && <button className="file-rename" title="重命名原文件" aria-label={`重命名原文件 ${item.originalName || item.name}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRename(item); }}><PencilSimple size={15} /></button>}
          {canDelete && <button className="file-delete" title="删除（移到回收站）" aria-label={`删除 ${item.name}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDelete(item); }}><Trash size={15} /></button>}
        </div>
        <div className="asset-type">{item.type} · {item.size}{item.online === false ? " · 未连接" : ""}</div>
      </div>
      <button
        className={`selected-mark ${selected ? "active" : ""}`}
        aria-label={selected ? `取消选择${item.name}` : `选择${item.name}`}
        onClick={(event) => { event.stopPropagation(); onToggleSelection(item); }}
      >{selected && <CheckCircle size={21} weight="fill" />}</button>
    </article>
  );
}

function DeleteDialog({ items, busy, error, onClose, onConfirm }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
      else document.querySelector(".asset-card, .searchbox input")?.focus();
    };
  }, []);
  useEffect(() => {
    // Disabled buttons lose focus in Chromium; keep keyboard input inside the modal.
    if (busy) dialogRef.current?.focus();
    else if (document.activeElement === dialogRef.current) cancelRef.current?.focus();
  }, [busy]);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="organize-dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-note" aria-busy={busy} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); if (!busy) onClose(); }
        if (event.key === "Tab") {
          const buttons = [...dialogRef.current.querySelectorAll("button:not([disabled])")];
          if (!buttons.length) { event.preventDefault(); return; }
          const first = buttons[0];
          const last = buttons.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
        <div className="dialog-heading"><div><h2 id="delete-title">删除{items.length > 1 ? "所选素材" : "素材"}？</h2><p>将 {items.length} 个文件移到 Windows 回收站。</p></div><button disabled={busy} onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
        <ul className="delete-file-list">{items.map((item) => <li key={item.id}><strong title={item.name}>{item.name}</strong><span title={item.fullPath}>{item.fullPath}</span></li>)}</ul>
        <div id="delete-note" className="delete-note">{items.some((item) => item.sourceRoot) ? "链接项目中的原文件也会移到回收站。" : "原文件会移到回收站。"}需要时可从 Windows 回收站恢复。</div>
        {error && <p className="delete-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button ref={cancelRef} disabled={busy} onClick={onClose}>取消</button><button className="confirm-delete" disabled={busy} onClick={onConfirm}><Trash size={16} />{busy ? "正在删除…" : error ? "重试删除" : "移到回收站"}</button></div>
      </section>
    </div>
  );
}

export function App() {
  const [physicalFiles, setFiles] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [addingMaterialArea, setAddingMaterialArea] = useState(false);
  const catalogRef = useRef(null);
  const catalogQueue = useRef(Promise.resolve());
  const [virtualCategory, setVirtualCategory] = useState("all");
  const [searchScope, setSearchScope] = useState("all");
  const [mediaType, setMediaType] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState([]);
  const [storageInfo, setStorageInfo] = useState(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
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
  const [fileSort, setFileSort] = useState(() => {
    try { return normalizeFileSort(JSON.parse(localStorage.getItem(FILE_SORT_STORAGE_KEY) || "null")); }
    catch { return normalizeFileSort(null); }
  });
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
  const [assetLinks, setAssetLinks] = useState(() => {
    try { return normalizeProjectLinks(localStorage.getItem(PROJECT_LINKS_STORAGE_KEY)); }
    catch { return normalizeProjectLinks(null); }
  });
  const assetLinksRef = useRef(assetLinks);
  const [linkDialog, setLinkDialog] = useState(null);
  const [pendingLinkedSelection, setPendingLinkedSelection] = useState("");
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
  const [deleteItems, setDeleteItems] = useState([]);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteBusyRef = useRef(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const draggingOutRef = useRef(false);
  const importingDropRef = useRef(false);
  useEffect(() => {
    if (!DESKTOP) return undefined;
    return window.yuDesktop.onFileDragEnded(() => {
      draggingOutRef.current = false;
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
    });
  }, []);
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

  const files = useMemo(() => mergeCatalogRecords(physicalFiles, catalog, formatBytes), [physicalFiles, catalog]);
  const materialAreas = materialAreasFromCatalog(catalog);
  const virtualArea = isMaterialArea(activeArea, materialAreas);
  const globalSearch = searchScope === "all" && Boolean(query.trim() || favoritesOnly || selectedTags.length || mediaType !== "all");
  const showAssociations = activeArea === "项目素材" && mode === "关联素材" && !globalSearch;
  const allTags = useMemo(() => [...new Set((catalog?.assets || []).flatMap((asset) => asset.tags))].sort((a,b) => a.localeCompare(b,"zh-CN")), [catalog]);
  const selectedCatalogAsset = catalog?.assets.find((asset) => asset.id === selected?.assetId);

  function applyCatalog(next) {
    if (!next?.assets) return;
    const previous = catalogRef.current;
    catalogRef.current = next;
    setCatalog(next);
    setFavorites(new Set(next.assets.filter((asset) => asset.favorite).map((asset) => asset.fullPath)));
    setNotes(Object.fromEntries(next.assets.filter((asset) => asset.note).map((asset) => [asset.fullPath, asset.note])));
    if (next.settings?.projectLinks) {
      const links = normalizeProjectLinks(next.settings.projectLinks);
      assetLinksRef.current = links;
      setAssetLinks(links);
    }
    if (previous) {
      const currentPaths = new Map(next.assets.map((asset) => [asset.id, asset.fullPath]));
      const paths = new Map(previous.assets.map((asset) => [asset.fullPath, currentPaths.get(asset.id) || asset.fullPath]));
      setSelectedIds((current) => new Set([...current].map((id) => paths.get(id) || id)));
      setSelected((current) => current && paths.get(current.id) ? {...current,id:paths.get(current.id),fullPath:paths.get(current.id)} : current);
      setSelectionAnchorId((current) => paths.get(current) || current);
    }
  }

  function catalogAction(method, ...args) {
    const task = catalogQueue.current.catch(() => {}).then(async () => {
      const value = await window.yuDesktop[method](...args);
      if (value === null) return null;
      applyCatalog(value?.assets ? value : await window.yuDesktop.catalogSnapshot());
      return value;
    });
    catalogQueue.current = task;
    return task;
  }

  async function createMaterialArea(name) {
    await catalogAction("catalogCreateMaterialArea", name);
    changeArea(name);
    setSelected(null); setSelectedIds(new Set());
  }

  async function updateCatalogAsset(item, patch) {
    if (!item?.assetId) return;
    try { await catalogAction("catalogUpdateAssets", [item.assetId], patch); }
    catch (error) { setToast(error.message || "整理信息保存失败"); throw error; }
  }

  async function assignCatalogSelection(categoryIds, options = {mode:"add"}) {
    const ids = selectedItems.map((item) => item.assetId).filter(Boolean);
    if (!ids.length) throw new Error("请先选择素材");
    await catalogAction("catalogAssignCategories", ids, categoryIds, options);
    setToast(options.mode === "remove" ? "已移出分类，原文件保留" : "分类已保存，原文件位置不变");
  }

  async function linkReusable(kind) {
    setImportOpen(false);
    try {
      const area = virtualArea ? activeArea : "下载素材";
      const result = await catalogAction(kind === "folder" ? "catalogLinkFolder" : "catalogLinkFiles", area);
      if (!result) return;
      if (virtualArea && catalog?.categories.some((entry) => entry.id === virtualCategory && entry.area === area)) {
        const before = new Set(catalog?.assets.map((asset) => asset.id));
        const linkedIds = new Set(result.linkedAssetIds || []);
        const added = result.assets.filter((asset) => asset.area === area && (linkedIds.size ? linkedIds.has(asset.id) : !before.has(asset.id)));
        if (added.length) await catalogAction("catalogAssignCategories", added.map((asset) => asset.id), [virtualCategory], {mode:"add"});
      }
      setActiveArea(area); setFavoritesOnly(false); setQuery("");
      setToast("已原位连接，未复制或移动原文件");
    } catch (error) { setToast(error.message || "连接素材失败"); }
  }

  async function openStorage() {
    try { setStorageError(""); setStorageInfo(await window.yuDesktop.catalogStorageInfo()); }
    catch (error) { setToast(error.message); }
  }

  async function storageAction(method, ...args) {
    if (method === "catalogRestore") { setSelected(null); setSelectedIds(new Set()); await new Promise((resolve) => window.setTimeout(resolve,0)); }
    await catalogQueue.current.catch(() => {});
    setStorageBusy(true); setStorageError("");
    try {
      const result = await window.yuDesktop[method](...args);
      if (result !== null) {
        applyCatalog(await window.yuDesktop.catalogSnapshot());
        setStorageInfo(await window.yuDesktop.catalogStorageInfo());
        if (method === "catalogRestore") {
          const settings = catalogRef.current.settings || {};
          setLinkedProjects(settings.linkedProjects || []);
          setCategoryLabels(settings.categoryLabels || {}); setCategoryOrders(settings.categoryOrders || {});
          setFiles([]); setRootPath(settings.rootPath || "");setRootKind("none");setRootName("");
          if (settings.rootPath) localStorage.setItem("yu-library-root",settings.rootPath);else localStorage.removeItem("yu-library-root");
          if (!settings.projectLinks) {const empty={version:1,groups:[]};assetLinksRef.current=empty;setAssetLinks(empty);}
          if (settings.rootPath || settings.linkedProjects?.length) await loadNativeDirectory(settings.rootPath || "", true, settings.linkedProjects || []);
          await catalogAction("catalogRefreshReferences");
          setVirtualCategory("all");
          if (!["待整理","项目素材",...materialAreasFromCatalog(catalogRef.current)].includes(activeArea)) changeArea("下载素材");
        }
      }
    } catch (error) { setStorageError(error.message || "资料库操作失败"); }
    finally { setStorageBusy(false); }
  }

  const projectOptions = useMemo(() => {
    const options = new Map();
    const add = (name, source) => {
      if (!name) return;
      const id = JSON.stringify([source || rootPath || rootName || "local", name]);
      options.set(id, { id, name });
    };
    files.filter((item) => item.area === "项目素材").forEach((item) => add(item.project, item.sourceRoot));
    linkedProjects.forEach((item) => add(item.name, item.path));
    if (rootKind === "project") add(rootName, rootPath);
    assetLinks.groups.forEach((group) => options.set(group.projectId, { id: group.projectId, name: group.projectName }));
    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [files, linkedProjects, rootPath, rootName, rootKind, assetLinks]);
  const projects = useMemo(() => [...new Set(projectOptions.map((item) => item.name))], [projectOptions]);
  const projectLinkGroups = useMemo(() => assetLinks.groups.filter((group) => group.projectName === project), [assetLinks, project]);
  const projectLinkedIds = useMemo(() => new Set(projectLinkGroups.flatMap((group) => group.members.map((member) => member.id))), [projectLinkGroups]);
  const selectedLinkGroups = useMemo(() => groupsForFile(assetLinks, selected?.id), [assetLinks, selected?.id]);
  const visibleLinkGroups = useMemo(() => {
    const text = query.trim().toLowerCase();
    return projectLinkGroups.filter((group) => !text || `${group.name} ${group.projectName} ${group.members.map((member) => `${member.name} ${member.role}`).join(" ")}`.toLowerCase().includes(text));
  }, [projectLinkGroups, query]);

  const scopedFiles = useMemo(() => files.filter((item) => {
    if (globalSearch) return true;
    if (activeArea === "项目素材" && mode === "关联素材") {
      return projectLinkedIds.has(item.id);
    }
    if (activeArea === "项目素材") return item.area === "项目素材" && item.project === project && item.mode === mode;
    return item.area === activeArea;
  }), [files, activeArea, project, mode, projectLinkedIds, globalSearch]);

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

  const visibleItems = useMemo(() => sortFiles(scopedFiles.filter((item) => {
    const categoryMatch = globalSearch || (catalog && virtualArea) || category === "全部" || item.category === category;
    return categoryMatch && matchesCatalogAsset({...item,
      note: notes[item.id] || item.note || "", favorite: favorites.has(item.id),
      mediaType: item.mediaType || mediaTypeFor(item.extension),
      displayName: item.name,
      tags: [...new Set([...item.tags, displayCategory(item.category, item.area, item.project, item.mode)])],
    }, {query, mediaType, favoritesOnly, tags:selectedTags,
      categoryId: !globalSearch && virtualArea && catalog ? virtualCategory : "all",
      categories:catalog?.categories || []});
  }), fileSort), [scopedFiles,category,query,fileSort,notes,favorites,mediaType,favoritesOnly,selectedTags,virtualCategory,catalog,globalSearch,virtualArea,categoryLabels]);

  const selectedItems = useMemo(() => files.filter((item) => selectedIds.has(item.id)), [files, selectedIds]);
  const organizeSourceRoot = (selectedItems[0] || selected)?.sourceRoot;
  const organizeRootPath = (selectedItems[0] || selected)?.rootPath || organizeSourceRoot || rootPath;
  const canOrganizeSelection = DESKTOP && selectedItems.length > 0
    && selectedItems.every((item) => item.fullPath && item.online !== false && ["项目素材","待整理"].includes(item.area) && (item.sourceRoot || "") === (organizeSourceRoot || "") && (item.rootPath || item.sourceRoot || rootPath) === organizeRootPath);
  const canDeleteItem = (item) => DESKTOP && item.online !== false && Boolean(item.fullPath && (item.sourceRoot || item.rootPath || rootPath));
  const canDeleteSelection = selectedItems.length > 0 && selectedItems.every(canDeleteItem);
  const organizeCategoryOptions = useMemo(() => [...new Set(files
    .filter((item) => item.area === organizeArea && item.category && item.category !== "未分类")
    .map((item) => item.category))].sort((a, b) => a.localeCompare(b, "zh-CN")), [files, organizeArea]);
  const projectCategoryOptions = useMemo(() => [...new Set([
    organizeMode === "参考素材" ? "PS源文件" : "源文件", "详情页", "渲染图",
    ...files.filter((item) => item.area === "项目素材" && item.project === organizeProject.trim() && item.mode === organizeMode).map((item) => item.category),
  ])].filter(Boolean), [files, organizeProject, organizeMode]);

  useEffect(() => {
    if (!DESKTOP) return;
    const normalize = normalizedPath;
    const references = catalog?.settings?.referenceRoots || [];
    const roots = [
      ...(rootPath ? [{path:rootPath, managed:rootKind === "library"}] : []),
      ...linkedProjects.filter((link) => normalize(link.path) !== normalize(rootPath)),
      ...references,
    ];
    const unsubscribe = window.yuDesktop.onLibraryChanged((change) => {
      const root = roots.find((entry) => normalize(entry.path) === normalize(change.rootPath));
      if (!root) return;
      if (root.kind) {
        catalogAction("catalogApplyReferenceChange",change).catch((error) => setToast(error.message));
        return;
      }
      const updates = root.managed ? recordsFromNative(change.files, materialAreasFromCatalog(catalogRef.current))
        : recordsAsProject(change.files, root.name || change.rootPath.split(/[\\/]/).at(-1), change.rootPath);
      const replaced = normalize(change.replacedPath);
      setFiles((current) => [...current.filter((item) => {
        const location = normalize(item.fullPath || "");
        return location !== replaced && !location.startsWith(`${replaced}/`);
      }), ...updates]);
      catalogAction("catalogReconcile", updates.map((item) => catalogEntry(item,change.rootPath,materialAreasFromCatalog(catalogRef.current))),
        {rootPath:change.rootPath,complete:false,replacedPath:change.replacedPath}).catch((error) => setToast(error.message));
    });
    const unsubscribeError = window.yuDesktop.onWatchError(setToast);
    if (roots.length) window.yuDesktop.retainWatchers(roots.map((entry) => entry.path)).catch(() => {});
    return () => { unsubscribe(); unsubscribeError(); };
  }, [rootPath, rootKind, linkedProjects, JSON.stringify(catalog?.settings?.referenceRoots || [])]);

  useEffect(() => {
    if (DESKTOP) {
      document.documentElement.classList.add("desktop-app");
      (async () => {
        const initial = await window.yuDesktop.catalogMigrateLegacy(legacyCatalogPayload(localStorage));
        applyCatalog(initial);
        const settings = initial.settings || {};
        setCategoryLabels(settings.categoryLabels || categoryLabels);
        setCategoryOrders(settings.categoryOrders || categoryOrders);
        const savedPath = Object.hasOwn(settings,"rootPath") ? settings.rootPath : localStorage.getItem("yu-library-root");
        const links = settings.linkedProjects || linkedProjects;
        setLinkedProjects(links);
        if (savedPath || links.length) await loadNativeDirectory(savedPath, true, links);
        await catalogAction("catalogRefreshReferences");
        const indexed = catalogRef.current?.assets || [];
        if (indexed.some((asset) => asset.area === "下载素材")) setActiveArea("下载素材");
        else if (indexed.some((asset) => asset.area === "AI制作素材")) setActiveArea("AI制作素材");
        else if (indexed.some((asset) => isMaterialArea(asset.area,materialAreasFromCatalog(catalogRef.current)))) setActiveArea(indexed.find((asset) => isMaterialArea(asset.area,materialAreasFromCatalog(catalogRef.current))).area);
        else if (indexed.some((asset) => asset.area === "项目素材")) setActiveArea("项目素材");
      })().catch((error) => setToast(`资料库读取失败：${error.message}`));
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
    try { localStorage.setItem(FILE_SORT_STORAGE_KEY, JSON.stringify(fileSort)); }
    catch { setToast("无法保存排列设置"); }
  }, [fileSort]);

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
      if (!catalog) setActiveArea("项目素材");
    }
  }, [projects, project]);

  useEffect(() => {
    if (!pendingLinkedSelection) return;
    const item = visibleItems.find((entry) => entry.id === pendingLinkedSelection);
    if (!item) return;
    setSelected(item);
    setSelectedIds(new Set([item.id]));
    setSelectionAnchorId(item.id);
    setPendingLinkedSelection("");
  }, [pendingLinkedSelection, visibleItems]);

  function updateAssetLinks(transform) {
    const next = transform(assetLinksRef.current);
    try { localStorage.setItem(PROJECT_LINKS_STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error("项目关联保存失败，请检查本机存储空间"); }
    assetLinksRef.current = next;
    setAssetLinks(next);
    if (DESKTOP && catalogRef.current) catalogAction("catalogSetSetting", "projectLinks", next).catch((error) => setToast(`项目关联保存失败：${error.message}`));
    return next;
  }

  function openProjectAssociation(items = selectedItems, group = null) {
    setLinkDialog({ items: items.filter(Boolean).map((item) => ({ ...item })), group });
    setImportOpen(false);
  }

  function saveProjectAssociation(input) {
    const name = input.projectName?.trim();
    const existing = assetLinksRef.current.groups.find((group) => group.id === input.id);
    const projectId = (existing?.projectName === name ? existing.projectId : null) || projectOptions.find((item) => item.name === name)?.id
      || JSON.stringify([rootPath || rootName || "local", name]);
    const next = updateAssetLinks((state) => {
      let base = state;
      if (existing) {
        const included = new Set(input.members.map((member) => member.id));
        for (const member of existing.members) if (!included.has(member.id)) base = removeLinkMember(base, existing.id, member.id);
      }
      return saveLinkGroup(base, { ...input, projectId, projectName: name });
    });
    const group = next.groups.find((entry) => entry.id === input.id) || next.groups.at(-1);
    setLinkDialog(null);
    setProject(name);
    setActiveArea("项目素材");
    setMode("关联素材");
    setQuery("");
    setCategory("全部");
    const firstAvailable = group?.members.find((member) => files.some((file) => file.id === member.id));
    if (firstAvailable) setPendingLinkedSelection(firstAvailable.id);
    setToast("项目关联已保存");
  }

  function cancelProjectAssociation(groupId) {
    try {
      updateAssetLinks((state) => removeLinkGroup(state, groupId));
      setLinkDialog(null);
      setToast("已取消关联");
    } catch (error) { setToast(error.message); }
  }

  function cancelMemberAssociation(groupId, fileId) {
    try { updateAssetLinks((state) => removeLinkMember(state, groupId, fileId)); }
    catch (error) { setToast(error.message); }
  }

  function focusLinkedFile(item, group) {
    setActiveArea("项目素材");
    setProject(group.projectName);
    setMode("关联素材");
    setQuery("");
    setCategory("全部");
    setPendingLinkedSelection(item.id);
  }

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
    setScanning(true); setPermissionNeeded(false);
    const nextFiles = []; const errors = [];
    let result = null; let rootIsLibrary = false;
    try {
      if (nextRootPath) {
        try {
          result = await window.yuDesktop.scanLibrary(nextRootPath);
          rootIsLibrary = result.isManagedLibrary || hasLibraryStructure(result.files);
          const records = rootIsLibrary ? recordsFromNative(result.files, materialAreasFromCatalog(catalogRef.current)) : recordsAsProject(result.files,result.rootName,result.rootPath);
          nextFiles.push(...records);
          await catalogAction("catalogReconcile",records.map((item) => catalogEntry(item,result.rootPath,materialAreasFromCatalog(catalogRef.current))),{rootPath:result.rootPath,complete:result.complete !== false});
        } catch (error) {
          errors.push(error.message);
          await catalogAction("catalogReconcile",[],{rootPath:nextRootPath,complete:true});
        }
      }
      const keptLinks = [];
      for (const link of projectLinks) {
        if (!link?.path || normalizedPath(link.path) === normalizedPath(nextRootPath)) continue;
        keptLinks.push(link);
        try {
          const linked = await window.yuDesktop.scanLibrary(link.path);
          const records = recordsAsProject(linked.files,link.name || linked.rootName,linked.rootPath);
          nextFiles.push(...records);
          await catalogAction("catalogReconcile",records.map((item) => catalogEntry(item,linked.rootPath,materialAreasFromCatalog(catalogRef.current))),{rootPath:linked.rootPath,complete:linked.complete !== false});
        } catch (error) {
          errors.push(`${link.name || link.path}：未连接`);
          await catalogAction("catalogReconcile",[],{rootPath:link.path,complete:true});
        }
      }
      setFiles([...new Map(nextFiles.map((item) => [normalizedPath(item.fullPath),item])).values()]);
      setRootName(result?.rootName || (nextRootPath ? nextRootPath.split(/[\\/]/).at(-1) : "独立资料库"));
      setRootPath(result?.rootPath || nextRootPath || "");
      setRootKind(result ? (rootIsLibrary ? "library" : "project") : nextRootPath ? rootKind : "none");
      if (nextRootPath) localStorage.setItem("yu-library-root",result?.rootPath || nextRootPath);
      setLinkedProjects(keptLinks);
      await catalogAction("catalogSetSetting","rootPath",result?.rootPath || nextRootPath || "");
      await catalogAction("catalogSetSetting","linkedProjects",keptLinks);
      if (!quiet) {
        setVirtualCategory("all"); setQuery(""); setFavoritesOnly(false);
        const firstProject = nextFiles.find((item) => item.area === "项目素材")?.project;
        if (nextFiles.some((item) => item.area === "下载素材")) setActiveArea("下载素材");
        else if (firstProject) {setProject(firstProject);setActiveArea("项目素材");}
        else if (nextFiles.some((item) => item.area === "AI制作素材")) setActiveArea("AI制作素材");
        else setActiveArea("待整理");
      }
      if (errors.length) setToast(`${errors.length} 个来源暂未连接，整理记录已保留`);
      else if (!quiet) setToast(`已读取 ${nextFiles.length} 个本地文件`);
    } catch (error) { setToast(error.message || "读取素材库失败，已保留原连接"); }
    finally { setScanning(false); }
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
    return virtualArea ? activeArea : "待整理";
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
      if (catalog && isMaterialArea(targetArea, materialAreas) && !["all","uncategorized"].includes(virtualCategory)) {
        const paths = new Set(imported.map(normalizedPath));
        const ids = catalogRef.current.assets.filter((asset) => paths.has(normalizedPath(asset.fullPath))).map((asset) => asset.id);
        if (ids.length) await catalogAction("catalogAssignCategories",ids,[virtualCategory],{mode:"add"});
      }
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
    setVirtualCategory("all"); setFavoritesOnly(false); setQuery(""); setSelectedTags([]); setMediaType("all");
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
    setVirtualCategory("all");
    setFavoritesOnly(false); setQuery(""); setSelectedTags([]); setMediaType("all");
    setProject(nextProject);
    setActiveArea("项目素材");
  }

  function toggleFavorite(id) {
    const item = files.find((entry) => entry.id === id);
    if (item?.assetId) { updateCatalogAsset(item,{favorite:!favorites.has(id)}).catch(() => {}); return; }
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
    if (!DESKTOP || !item?.fullPath || item.online === false || (!allowButton && event.target.closest("button"))) {
      event.preventDefault();
      return;
    }
    const paths = selectedIds.has(item.id) && selectedIds.size > 1
      ? files.filter((entry) => selectedIds.has(entry.id) && entry.fullPath && entry.online !== false).map((entry) => entry.fullPath)
      : [item.fullPath];
    try { event.dataTransfer.setData("application/x-yu-catalog-assets", JSON.stringify(paths)); } catch { /* Native file data remains authoritative. */ }
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

  async function refreshLibrary() {
    if (DESKTOP) {
      if (rootPath || linkedProjects.length) await loadNativeDirectory(rootPath,true,linkedProjects);
      try { await catalogAction("catalogRefreshReferences"); } catch (error) {setToast(error.message);}
    } else if (rootHandle) loadDirectory(rootHandle);
  }

  async function dropIntoCategory(event, categoryId) {
    event.preventDefault(); event.stopPropagation();
    const payload = snapshotFileDrop(event.dataTransfer,window.yuDesktop.getPathForFile);
    try {
      let paths = [];
      try { paths = JSON.parse(event.dataTransfer.getData("application/x-yu-catalog-assets") || "[]"); } catch { /* Use native paths. */ }
      if (!paths.length) paths = (await window.yuDesktop.describeDrop(payload)).filter((item) => item.isFile).map((item) => item.path);
      const known = paths.map((filePath) => catalogRef.current?.assets.find((asset) => normalizedPath(asset.fullPath) === normalizedPath(filePath)));
      if (known.length && known.every(Boolean)) {
        if (categoryId === "all" || categoryId === "uncategorized") {
          if (categoryId === "uncategorized") await catalogAction("catalogAssignCategories",known.map((asset) => asset.id),[],{mode:"replace"});
        } else await catalogAction("catalogAssignCategories",known.map((asset) => asset.id),[categoryId],{mode:"add"});
        draggingOutRef.current = false; setIsDraggingFiles(false);
        setToast("分类已更新，原文件位置不变");
        return;
      }
      await handleDrop(event,categoryId,payload);
    } catch (error) {setToast(error.message || "添加到分类失败");}
  }

  async function handleDrop(event, targetCategoryId = virtualCategory, providedPayload = null) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (isCategoryDrag(event.dataTransfer) || draggingOutRef.current) return;
    if (globalSearch && !providedPayload) {setToast("请先打开目标项目或素材分类，再拖入新文件");return;}
    if (DESKTOP) {
      const payload = providedPayload || snapshotFileDrop(event.dataTransfer, window.yuDesktop.getPathForFile);
      const target = currentDropTarget({ activeArea, project, mode, category: catalog && virtualArea ? "全部" : category, files, rootPath, rootKind, rootName, linkedProjects, materialAreas });
      if (importingDropRef.current) {
        setToast("正在添加文件，请完成后再拖入");
        return;
      }
      importingDropRef.current = true;
      try {
        const dropped = await window.yuDesktop.describeDrop(payload);
        if (!dropped.length) {
          setToast("未读取到本地文件，请确认下载已完成，或从下载文件夹拖入");
          return;
        }
        const folders = dropped.filter((item) => item.isDirectory);
        let looseFiles = dropped.filter((item) => item.isFile).map((item) => item.path);
        if (catalog && virtualArea) {
          const known = catalogRef.current.assets.filter((asset) => looseFiles.some((filePath) => normalizedPath(filePath) === normalizedPath(asset.fullPath)));
          if (known.length) {
            if (!["all","uncategorized"].includes(targetCategoryId)) await catalogAction("catalogAssignCategories",known.map((asset) => asset.id),[targetCategoryId],{mode:"add"});
            else if (targetCategoryId === "uncategorized") await catalogAction("catalogAssignCategories",known.map((asset) => asset.id),[],{mode:"replace"});
            const paths = new Set(known.map((asset) => normalizedPath(asset.fullPath)));
            looseFiles = looseFiles.filter((filePath) => !paths.has(normalizedPath(filePath)));
            if (!looseFiles.length && !folders.length) {setToast("分类已更新，原文件位置不变");return;}
          }
        }
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
          if (!target) {
            setToast("请先打开项目的参考素材或制作素材分类，再拖入文件");
            return;
          }
          let importRoot = target.root;
          let nextRoot = rootPath;
          if (!importRoot) {
            const prepared = await prepareReusableLibrary();
            if (!prepared) {
              setToast("未选择通用素材保存位置，文件没有导入");
              return;
            }
            importRoot = nextRoot = prepared.libraryPath;
            activeLinks = [...new Map([...activeLinks, ...prepared.projectLinks].map((item) => [item.path.toLowerCase(), item])).values()];
          }
          const result = await window.yuDesktop.moveDroppedFiles(importRoot, looseFiles, target.directory);
          if (!result.moved.length) {
            setToast(result.error || "没有移动文件：文件已在目标文件夹，或下载文件已移动");
            return;
          }
          applyCatalog(await window.yuDesktop.catalogSnapshot());
          await loadNativeDirectory(nextRoot, true, activeLinks);
          setActiveArea(target.area);
          if (target.project) { setProject(target.project); setMode(target.mode); }
          setCategory(target.category);
          if (virtualArea && catalog && !["all","uncategorized"].includes(targetCategoryId)) {
            const destinations = new Set(result.moved.map((move) => normalizedPath(move.destination)));
            const ids = catalogRef.current.assets.filter((asset) => destinations.has(normalizedPath(asset.fullPath))).map((asset) => asset.id);
            if (ids.length) await catalogAction("catalogAssignCategories",ids,[targetCategoryId],{mode:"add"});
          }
          setQuery("");
          setToast(result.error ? `已移动 ${result.moved.length} 个文件；其余文件未移动：${result.error}`
            : `已移动 ${result.moved.length} 个文件到${target.label}`);
        }
      } catch (error) {
        setToast(error?.message || "拖入内容读取失败");
      } finally {
        importingDropRef.current = false;
      }
      return;
    }
    addFiles(event.dataTransfer.files);
  }

  function openOrganizer() {
    const sourceItem = selectedItems[0] || selected;
    if (isMaterialArea(sourceItem?.area, materialAreas)) {
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
    const original = item.originalName || item.name;
    const dot = original.lastIndexOf(".");
    setRenameValue(dot > 0 ? original.slice(0, dot) : original);
    setRenameError("");
  }

  async function confirmFileRename(event) {
    event.preventDefault();
    if (renameBusy || !renameItem) return;
    setRenameBusy(true);
    setRenameError("");
    try {
      const destination = await window.yuDesktop.renameFile(renameItem.sourceRoot || renameItem.rootPath || rootPath, renameItem.fullPath, renameValue);
      const name = destination.split(/[\\/]/).at(-1);
      const next = { ...renameItem, id: destination, fullPath: destination, name,
        relativePath: renameItem.relativePath.split("/").slice(0, -1).concat(name).join("/"),
        previewUrl: renameItem.isImage ? `yu-asset://file/${btoa(unescape(encodeURIComponent(destination))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}?v=${Date.now()}` : renameItem.previewUrl };
      setFiles((current) => [...current.filter((item) => item.id !== renameItem.id && item.id !== destination), next]);
      setSelected((current) => current?.id === renameItem.id ? next : current);
      setSelectedIds((current) => { const values = new Set(current); if (values.delete(renameItem.id)) values.add(destination); return values; });
      setFavorites((current) => { const values = new Set(current); if (values.delete(renameItem.id)) values.add(destination); return values; });
      setNotes((current) => { const values = { ...current }; if (renameItem.id !== destination && Object.hasOwn(values, renameItem.id)) { values[destination] = values[renameItem.id]; delete values[renameItem.id]; } return values; });
      try { updateAssetLinks((state) => remapLinkedFiles(state, [{ source: renameItem.id, destination, name }])); }
      catch (error) { setToast(error.message); }
      applyCatalog(await window.yuDesktop.catalogSnapshot());
      setRenameItem(null);
      setToast(`已重命名为 ${name}`);
    } catch (error) { setRenameError(error?.message || "重命名失败"); }
    finally { setRenameBusy(false); }
  }

  async function confirmOrganize() {
    const itemsToMove = selectedItems.length ? selectedItems : selected ? [selected] : [];
    if (!canOrganizeSelection || !itemsToMove.length || !(organizeRootPath)) return;
    if (organizeArea === "项目素材" && !organizeProject.trim()) {
      setToast("请输入项目名称");
      return;
    }
    try {
      const result = await window.yuDesktop.organizeFiles(organizeRootPath, itemsToMove.map((item) => item.fullPath), {
        directProject: Boolean(organizeSourceRoot),
        area: organizeArea,
        project: organizeProject,
        mode: organizeMode,
        category: organizeCategory,
      });
      const moves = result.moves || result;
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
      try { updateAssetLinks((state) => remapLinkedFiles(state, moves)); }
      catch (error) { setToast(error.message); }
      setOrganizerOpen(false);
      setSelectedIds(new Set());
      setSelected(null);
      await loadNativeDirectory(rootPath, true, linkedProjects);
      if (organizeArea === "项目素材") { setProject(organizeProject.trim()); setMode(organizeMode); }
      setActiveArea(organizeArea);
      applyCatalog(await window.yuDesktop.catalogSnapshot());
      setToast(result.error ? `已整理 ${moves.length} 项；其余未完成：${result.error}` : `已整理 ${moves.length} 个文件到目标位置`);
    } catch (error) {
      setToast(error?.message || "整理文件失败");
    }
  }

  function openDeleteConfirm(items = selectedItems) {
    if (deleteBusyRef.current || !items.length || !items.every(canDeleteItem)) {
      return;
    }
    setDeleteError("");
    // Capture the confirmed files and their roots so watcher updates cannot change the targets.
    setDeleteItems(items.map((item) => ({ ...item, deleteRoot: item.sourceRoot || item.rootPath || rootPath })));
  }

  function requestItemDelete(item, includeSelection = false) {
    openDeleteConfirm(includeSelection && selectedIds.has(item.id) ? selectedItems : [item]);
  }

  async function confirmDelete() {
    if (deleteBusyRef.current || !deleteItems.length) return;
    deleteBusyRef.current = true;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const groups = new Map();
      for (const item of deleteItems) {
        if (!groups.has(item.deleteRoot)) groups.set(item.deleteRoot, []);
        groups.get(item.deleteRoot).push(item);
      }
      const deleted = [];
      const failed = [];
      for (const [deleteRoot, items] of groups) {
        try {
          const result = await window.yuDesktop.trashFiles(deleteRoot, items.map((item) => item.fullPath));
          deleted.push(...result.deleted);
          failed.push(...result.failed);
        } catch (error) {
          failed.push(...items.map((item) => ({ path: item.fullPath, message: error?.message || "删除失败" })));
        }
      }
      const deletedIds = new Set(deleted);
      if (deleted.length) {
        try { updateAssetLinks((state) => removeLinkedFiles(state, deleted)); }
        catch (error) { setToast(error.message); }
      }
      setFiles((current) => current.filter((item) => !deletedIds.has(item.id)));
      setFavorites((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
      setNotes((current) => {
        const next = { ...current };
        deleted.forEach((id) => delete next[id]);
        return next;
      });
      setSelectedIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
      setSelected((current) => deletedIds.has(current?.id) ? null : current);
      setSelectionAnchorId((current) => deletedIds.has(current) ? "" : current);
      const failedPaths = new Set(failed.map((item) => item.path));
      setDeleteItems((current) => current.filter((item) => failedPaths.has(item.fullPath)));
      if (failed.length) {
        setDeleteError(`${deleted.length ? `已删除 ${deleted.length} 个文件，` : ""}${failed.length} 个文件未能删除：${failed[0].message}。处理后可重试。`);
      }
      if (deleted.length) {
        applyCatalog(await window.yuDesktop.catalogSnapshot());
        setToast(`已将 ${deleted.length} 个文件移到回收站`);
      }
    } catch (error) {
      setDeleteError(error?.message || "删除文件失败，请重试");
    } finally {
      deleteBusyRef.current = false;
      setDeleteBusy(false);
    }
  }

  const title = globalSearch ? favoritesOnly && !query ? "我的收藏" : "全库搜索" : activeArea === "项目素材" ? project || "项目素材" : activeArea;

  return (
    <div
      className={`app-shell ${isDraggingFiles ? "files-dragging" : ""}`}
      style={{ "--sidebar-width": `${leftWidth}px`, "--inspector-width": `${rightWidth}px` }}
      onDragOver={(event) => {
        if (!isFileDrag(event.dataTransfer) || draggingOutRef.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = fileDropEffect(event.dataTransfer, DESKTOP);
      }}
      onDragEnd={() => { draggingOutRef.current = false; dragDepthRef.current = 0; setIsDraggingFiles(false); }}
      onDragEnter={(event) => {
        if (draggingOutRef.current || !isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
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
          {catalog && <NavButton active={favoritesOnly && searchScope === "all"} icon={Star} onClick={() => {setFavoritesOnly(true);setSearchScope("all");setQuery("");setMediaType("all");setSelectedTags([]);}}>我的收藏</NavButton>}
          <NavButton active={activeArea === "待整理" && !globalSearch} icon={Archive} onClick={() => changeArea("待整理")}>待整理</NavButton>
          <div className="nav-group-label"><span>素材</span><div className="material-area-actions">{catalog && <button type="button" className="project-import material-area-add" title="新增素材区" aria-label="新增素材区" onClick={() => setAddingMaterialArea(true)}><Plus size={15} /></button>}<CaretDown size={15} /></div></div>
          <NavButton active={activeArea === "下载素材"} icon={DownloadSimple} nested onClick={() => changeArea("下载素材")}>下载素材</NavButton>
          <NavButton active={activeArea === "AI制作素材"} icon={Sparkle} nested onClick={() => changeArea("AI制作素材")}>AI制作素材</NavButton>
          {materialAreas.slice(2).map((area) => <NavButton key={area} title={area} active={activeArea === area} icon={Folder} nested onClick={() => changeArea(area)}>{area}</NavButton>)}
          {catalog && virtualArea && !globalSearch && <CatalogCategories area={activeArea} materialAreas={materialAreas} categories={catalog.categories} selectedId={virtualCategory}
            onSelect={(id) => {setVirtualCategory(id);setSelectedIds(new Set());setSelected(null);}}
            onCreate={(input) => catalogAction("catalogCreateCategory",input)}
            onRename={(id,patch) => catalogAction("catalogUpdateCategory",id,patch)}
            onDelete={async (id) => {await catalogAction("catalogDeleteCategory",id);setVirtualCategory("all");}}
            selectionCount={selectedItems.length} onAssign={assignCatalogSelection} onDropFiles={dropIntoCategory} />}
          <button className="nav-group-label project-label project-import" onClick={chooseProjectFolder} title="点击选择，或把项目文件夹拖进窗口"><span>项目素材</span><Plus size={15} /></button>
          {projects.length ? projects.map((name) => (
            <NavButton key={name} active={activeArea === "项目素材" && project === name} icon={project === name ? FolderOpen : Folder} nested onClick={() => selectProject(name)}>{name}</NavButton>
          )) : null}
        </nav>
        <div className="sidebar-footer">
          {catalog && <button aria-label="资料库与缓存" title="资料库与缓存" onClick={openStorage}><GearSix size={21} /></button>}
          <button aria-label="切换素材库" title={rootPath || "切换素材库"} onClick={chooseDirectory}><FolderOpen size={21} /></button>
          <button aria-label="刷新素材库" title="刷新素材库" disabled={scanning || (!rootPath && !rootHandle && !catalog?.assets.length)} onClick={refreshLibrary}><SlidersHorizontal size={21} /></button>
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
            <button className="import-button" title="添加素材" onClick={() => setImportOpen((open) => !open)} aria-expanded={importOpen}>
              <Plus size={16} /><span>添加</span><CaretDown size={12} />
            </button>
            {importOpen && (
              <div className="import-menu">
                {DESKTOP && <button onClick={() => linkReusable("files")}><LinkSimple size={18} />原位连接文件</button>}
                {DESKTOP && <button onClick={() => linkReusable("folder")}><FolderOpen size={18} />原位连接素材文件夹</button>}
                <button onClick={importFilesToCurrentArea}><File size={18} />{DESKTOP ? `复制文件到${activeImportArea()}` : "选择本地文件"}</button>
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
          <div className={`content-heading${catalog ? " catalog-heading" : ""}`}>
            <div>
              <div className="title-row"><h1 className={virtualArea && !DEFAULT_MATERIAL_AREAS.includes(activeArea) ? "material-area-title" : undefined} title={title}>{title}</h1>{rootName && <span className="result-count">{visibleItems.length} 个素材</span>}</div>
              {activeArea === "项目素材" && project && (
                <div className="mode-tabs" role="tablist" aria-label="项目素材类型">
                  {["参考素材", "制作素材", "关联素材"].map((tab) => <button key={tab} className={mode === tab ? "active" : ""} onClick={() => setMode(tab)} role="tab" aria-selected={mode === tab}>{tab}</button>)}
                </div>
              )}
            </div>
            {!showAssociations && <div className="view-actions">
              <div className="view-toggle">
                <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="网格视图"><GridFour size={20} /></button>
                <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="列表视图"><ListBullets size={20} /></button>
              </div>
              <FileSortControl value={fileSort} onChange={setFileSort} onOpen={() => { setFilterOpen(false); setImportOpen(false); }} />
              {!catalog && <div className="filter-wrap">
                <button className={`icon-button ${filterOpen ? "active" : ""}`} onClick={() => setFilterOpen((open) => !open)} aria-label="更多筛选"><Funnel size={20} /></button>
                {filterOpen && (
                  <div className="filter-menu"><strong>文件类型</strong>{["全部", "PSD", "JPG", "PNG", "BLEND"].map((type) => <button key={type} onClick={() => { setQuery(type === "全部" ? "" : type); setFilterOpen(false); }}>{type}</button>)}</div>
                )}
              </div>}
            </div>}
            {catalog && <CatalogFilters scope={searchScope} onScopeChange={setSearchScope} mediaType={mediaType} onMediaTypeChange={setMediaType}
              favoritesOnly={favoritesOnly} onFavoritesChange={setFavoritesOnly} tags={allTags} selectedTags={selectedTags} onSelectedTagsChange={setSelectedTags} />}
          </div>
          {!!files.length && !(catalog && virtualArea) && !globalSearch && categories.length > 1 && !showAssociations && (
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
                    event.dataTransfer.setData(CATEGORY_DRAG_TYPE, item);
                    event.dataTransfer.setData("text/plain", item);
                  }}
                  onDragEnd={() => setDraggingCategory("")}
                  onDragOver={(event) => {
                    if (!isCategoryDrag(event.dataTransfer)) return;
                    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    if (!isCategoryDrag(event.dataTransfer)) return;
                    event.preventDefault(); event.stopPropagation();
                    reorderCategory(draggingCategory || event.dataTransfer.getData(CATEGORY_DRAG_TYPE), item);
                    setDraggingCategory("");
                  }}
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
              <button className="association-action" onClick={() => openProjectAssociation()}><LinkSimple size={15} />关联项目</button>
              {canOrganizeSelection && !virtualArea && <button className="batch-organize" onClick={openOrganizer}>移动 / 分类…</button>}
              {catalog && <select className="catalog-batch-destination" aria-label="批量加入分类" value="" onChange={(event) => {const id=event.target.value;if(id) assignCatalogSelection([id],{mode:"add"}).catch((error) => setToast(error.message));}}>
                <option value="">加入分类…</option>{catalog.categories.filter((entry) => selectedItems.every((item) => item.area === entry.area)).map((entry) => <option key={entry.id} value={entry.id}>{entry.area} / {categoryBreadcrumb(catalog.categories,entry.id)}</option>)}
              </select>}
              {canDeleteSelection && <button className="batch-delete" onClick={() => openDeleteConfirm()}><Trash size={15} />删除所选</button>}
            </div>
          )}

          {scanning ? (
            <div className="empty-state"><div className="spinner" /><h2>正在读取素材</h2></div>
          ) : showAssociations ? (
            <ProjectGroupList groups={visibleLinkGroups} files={files} onEdit={(group) => openProjectAssociation([], group)} onSelectFile={focusLinkedFile} onRemoveMember={cancelMemberAssociation} onCreate={() => openProjectAssociation()} />
          ) : (!files.length && !rootName) || permissionNeeded ? (
            <div className="empty-state library-empty">
              <div className="empty-crest"><FolderOpen size={42} weight="duotone" /></div>
              <h2>{permissionNeeded ? "重新连接你的素材库" : "把电脑里的素材接进来"}</h2>
              <div className="empty-actions">
                <button className="primary-empty" onClick={permissionNeeded ? reconnectDirectory : chooseDirectory}><FolderOpen size={18} />{permissionNeeded ? "重新连接" : "选择素材库文件夹"}</button>
                {!permissionNeeded && <button onClick={createLibraryStructure}>创建基础目录</button>}
                {catalog && <button onClick={() => linkReusable("folder")}>原位连接素材文件夹</button>}
              </div>
            </div>
          ) : visibleItems.length ? (
            <div key={JSON.stringify([activeArea, project, mode, category, view])} className={`asset-grid ${view === "list" ? "list-view" : ""}`}>
              {visibleItems.map((item) => <AssetCard key={item.id} item={item} selected={selectedIds.has(item.id)} favorite={favorites.has(item.id)} view={view} onSelect={selectAsset} onToggleSelection={toggleAssetSelection} onFavorite={toggleFavorite} onOpen={previewSelected} onRename={openFileRename} onDelete={requestItemDelete} canDelete={canDeleteItem(item)} onDragFile={startFileDrag} />)}
            </div>
          ) : (
            <div className="empty-state compact">
              <ImageIcon size={42} weight="duotone" />
              <h2>{query || category !== "全部" ? "没有找到匹配素材" : `${title}里还没有文件`}</h2>
              <button onClick={() => {
                if (query || category !== "全部") { setQuery(""); setCategory("全部"); }
                else if (virtualArea) importFilesToCurrentArea();
                else refreshLibrary();
              }}>{query || category !== "全部" ? "清除筛选" : virtualArea ? `添加到${activeArea}` : "刷新文件夹"}</button>
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
                  <button disabled={selected.online === false} onClick={() => openFileRename(selected)}><PencilSimple size={16} />重命名原文件</button>
                  <button className="open-file-button" onClick={() => previewSelected(selected)}>打开文件</button>
                  <button onClick={() => revealSelected(selected)}>所在文件夹</button>
                  {canOrganizeSelection && !virtualArea && <button className="organize-button" onClick={openOrganizer}>{selected.area === "待整理" ? "整理到…" : "移动 / 分类…"}</button>}
                  {canDeleteItem(selected) && <button className="delete-button" onClick={() => requestItemDelete(selected)}><Trash size={16} />删除文件</button>}
                </div>
              )}
              <ProjectLinksInspector groups={selectedLinkGroups} files={files} onEdit={(group) => openProjectAssociation([], group)} onSelectFile={focusLinkedFile} onCreate={() => openProjectAssociation([selected])} />
              {!selectedCatalogAsset && <div className="tags-section">
                <span className="section-label">目录标签</span>
                <div className="tag-list">{selected.tags.map((tag) => <span key={tag}>{tag === selected.category ? displayCategory(tag, selected.area, selected.project, selected.mode) : tag}</span>)}</div>
              </div>}
              {selectedCatalogAsset && <CatalogAssetEditor asset={selectedCatalogAsset} materialAreas={materialAreas} categories={catalog.categories}
                onUpdate={(patch) => updateCatalogAsset(selected,patch)}
                onAssign={(ids,options) => catalogAction("catalogAssignCategories",[selected.assetId],ids,options)}
                onRelink={() => catalogAction("catalogRelink",selected.assetId).catch((error) => setToast(error.message || "重新连接失败"))} />}
              {!selectedCatalogAsset && <label className="note-editor">备注<textarea placeholder="写一点方便自己查找的备注…" value={notes[selected.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [selected.id]: event.target.value }))} /></label>}
            </>
          ) : (
            <div className="inspector-placeholder"><ImageIcon size={36} /><span>选择素材查看详情</span></div>
          )}
        </aside>
      </main>

      {addingMaterialArea && <MaterialAreaDialog onClose={() => setAddingMaterialArea(false)} onCreate={createMaterialArea} />}
      {storageInfo && <CatalogStorageDialog info={storageInfo} busy={storageBusy} error={storageError} onClose={() => setStorageInfo(null)}
        onChoose={() => storageAction("catalogChooseStorage")}
        onBackup={() => storageAction("catalogBackup")} onRestore={() => storageAction("catalogRestore")}
        onClearCache={() => storageAction("catalogClearCache")} onLimitChange={(mb) => storageAction("catalogSetCacheLimit",mb)} />}
      <input ref={fileInputRef} className="hidden-input" type="file" multiple onChange={(event) => addFiles(event.target.files)} />
      <input ref={folderInputRef} className="hidden-input" type="file" multiple webkitdirectory="true" onChange={(event) => addFiles(event.target.files)} />
      {linkDialog && <ProjectLinkDialog groups={assetLinks.groups} projects={projectOptions} files={files} items={linkDialog.items} group={linkDialog.group} initialProject={linkDialog.group?.projectName || (activeArea === "项目素材" ? project : linkDialog.items[0]?.project || "")} onSave={saveProjectAssociation} onDelete={cancelProjectAssociation} onClose={() => setLinkDialog(null)} />}
      {organizerOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrganizerOpen(false); }}>
          <section className="organize-dialog" role="dialog" aria-modal="true" aria-labelledby="organize-title">
            <div className="dialog-heading"><div><h2 id="organize-title">整理文件</h2><p title={selectedItems.length > 1 ? "" : selected?.name}>{selectedItems.length > 1 ? `已选择 ${selectedItems.length} 个文件` : selected?.name}</p></div><button onClick={() => setOrganizerOpen(false)} aria-label="关闭"><X size={18} /></button></div>
            <label>整理到<select disabled={Boolean(organizeSourceRoot)} value={organizeArea} onChange={(event) => setOrganizeArea(event.target.value)}><option>项目素材</option>{materialAreas.map((area) => <option key={area}>{area}</option>)}</select></label>
            {organizeArea === "项目素材" ? (
              <>
                <label>项目名称<input disabled={Boolean(organizeSourceRoot)} value={organizeProject} onChange={(event) => setOrganizeProject(event.target.value)} placeholder="项目名称" list="project-names" /><datalist id="project-names">{projects.map((name) => <option value={name} key={name} />)}</datalist></label>
                <div className="dialog-pair">
                  <label>素材用途<select value={organizeMode} onChange={(event) => { const nextMode = event.target.value; setOrganizeMode(nextMode); if (["源文件", "PS源文件"].includes(organizeCategory)) setOrganizeCategory(nextMode === "参考素材" ? "PS源文件" : "源文件"); }}><option>参考素材</option><option>制作素材</option></select></label>
                  <label>文件分类<input value={organizeCategory} onChange={(event) => setOrganizeCategory(event.target.value)} placeholder="输入新分类或选择已有分类" list="project-category-options" /><datalist id="project-category-options">{projectCategoryOptions.map((name) => <option value={name} label={displayCategory(name, "项目素材", organizeProject, organizeMode)} key={name} />)}</datalist></label>
                </div>
                <div className="category-suggestions">{projectCategoryOptions.map((name) => <button type="button" className={organizeCategory === name ? "active" : ""} onClick={() => setOrganizeCategory(name)} key={name}>{displayCategory(name, "项目素材", organizeProject, organizeMode)}</button>)}</div>
              </>
            ) : <label>素材类型<input value={organizeCategory} onChange={(event) => setOrganizeCategory(event.target.value)} placeholder="例如：动物、室内" list="existing-material-categories" /><datalist id="existing-material-categories">{organizeCategoryOptions.map((name) => <option value={name} label={displayCategory(name, organizeArea)} key={name} />)}</datalist>{organizeCategoryOptions.length > 0 && <div className="category-suggestions">{organizeCategoryOptions.map((name) => <button type="button" className={organizeCategory === name ? "active" : ""} onClick={() => setOrganizeCategory(name)} key={name}>{displayCategory(name, organizeArea)}</button>)}</div>}</label>}
            <div className="dialog-actions"><button onClick={() => setOrganizerOpen(false)}>取消</button><button className="confirm-organize" onClick={confirmOrganize}>移动到这里</button></div>
          </section>
        </div>
      )}
      {renameItem && (
        <div className="dialog-backdrop">
          <form className="organize-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-file-title" onSubmit={confirmFileRename} onKeyDown={(event) => { if (event.key === "Escape" && !renameBusy) setRenameItem(null); }}>
            <div className="dialog-heading"><div><h2 id="rename-file-title">重命名文件</h2></div><button type="button" disabled={renameBusy} onClick={() => setRenameItem(null)} aria-label="关闭"><X size={18} /></button></div>
            <label>文件名称<input autoFocus disabled={renameBusy} value={renameValue} onFocus={(event) => event.target.select()} onChange={(event) => setRenameValue(event.target.value)} /></label>
            {renameError && <p role="alert">{renameError}</p>}
            <div className="dialog-actions"><button type="button" disabled={renameBusy} onClick={() => setRenameItem(null)}>取消</button><button className="confirm-organize" disabled={renameBusy || !renameValue.trim()} type="submit">{renameBusy ? "正在保存…" : "保存名称"}</button></div>
          </form>
        </div>
      )}
      {renameCategoryRaw && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameCategoryRaw(""); }}>
          <section className="organize-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-category-title">
            <div className="dialog-heading"><div><h2 id="rename-category-title">重命名分类</h2></div><button onClick={() => setRenameCategoryRaw("")} aria-label="关闭"><X size={18} /></button></div>
            <label>分类名称<input autoFocus value={renameCategoryValue} onChange={(event) => setRenameCategoryValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCategoryRename(); }} /></label>
            <div className="dialog-actions"><button onClick={restoreCategoryName}>恢复默认</button><button onClick={() => setRenameCategoryRaw("")}>取消</button><button className="confirm-organize" onClick={saveCategoryRename}>保存名称</button></div>
          </section>
        </div>
      )}
      {deleteItems.length > 0 && <DeleteDialog items={deleteItems} busy={deleteBusy} error={deleteError} onClose={() => { if (!deleteBusyRef.current) setDeleteItems([]); }} onConfirm={confirmDelete} />}
      {toast && <div className="toast" role="status"><CheckCircle size={18} weight="fill" />{toast}</div>}
    </div>
  );
}
