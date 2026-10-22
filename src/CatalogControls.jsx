import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CaretDown, CaretRight, FolderSimple, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { categoryBreadcrumb, categoryDescendants, parseCatalogTags } from "./catalog-view.js";
import "./catalog-controls.css";
import { DEFAULT_MATERIAL_AREAS, isMaterialArea } from "./material-areas.js";

const array = (value) => Array.isArray(value) ? value : [];
const reusable = (area, areas) => isMaterialArea(area, areas) || ["downloads", "ai"].includes(area);
const byArea = (categories, area) => array(categories).filter((entry) => entry?.id && (!area || entry.area === area));
const errorMessage = (cause) => cause?.message || "操作未完成，请重试";

function categoryRows(categories) {
  const result = [];
  const visited = new Set();
  const known = new Set(categories.map((entry) => entry.id));
  function visit(category, depth, ancestors) {
    if (visited.has(category.id)) return;
    visited.add(category.id);
    result.push({ ...category, depth, ancestors });
    for (const child of categories.filter((entry) => entry.parentId === category.id)) visit(child, depth + 1, [...ancestors, category.id]);
  }
  for (const category of categories.filter((entry) => !entry.parentId || !known.has(entry.parentId))) visit(category, 0, []);
  for (const category of categories) visit(category, 0, []);
  return result;
}

function CatalogModal({ title, onClose, busy, children, className = "" }) {
  const titleId = useId();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement;
    const controls = () => [...(ref.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])].filter((element) => element.getClientRects().length);
    const focusFirst = () => (ref.current?.querySelector("[data-autofocus]") || controls()[0] || ref.current)?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current?.();
      } else if (event.key === "Tab") {
        const available = controls();
        const first = available[0];
        const last = available.at(-1);
        if (!first) { event.preventDefault(); ref.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !available.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !available.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const keepFocus = (event) => { if (ref.current && !ref.current.contains(event.target)) focusFirst(); };
    focusFirst();
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("focusin", keepFocus);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("focusin", keepFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div className="dialog-backdrop catalog-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose?.(); }}>
    <section ref={ref} className={`organize-dialog catalog-dialog ${className}`} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
      <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" disabled={busy} aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
      {children}
    </section>
  </div>;
}

export function MaterialAreaDialog({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    try { await onCreate(name.trim()); onClose(); }
    catch (cause) { setError(errorMessage(cause)); setBusy(false); }
  }
  return <CatalogModal title="新增素材区" onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      <div className="catalog-dialog-fields"><label>素材区名称<input data-autofocus maxLength={40} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label></div>
      {error && <p className="catalog-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="confirm-organize" disabled={busy || !name.trim()}>{busy ? "正在保存…" : "创建"}</button></div>
    </form>
  </CatalogModal>;
}

function CategoryDialog({ dialog, categories, area, onClose, onCreate, onRename, onDelete }) {
  const [name, setName] = useState(dialog.category?.name || "");
  const [parentId, setParentId] = useState(dialog.parentId || dialog.category?.parentId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deleting = dialog.mode === "delete";
  const editing = dialog.mode === "edit";
  const excluded = new Set(editing ? categoryDescendants(categories, dialog.category.id) : []);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!deleting && !name.trim()) { setError("请填写分类名称"); return; }
    setBusy(true);
    setError("");
    try {
      if (deleting) await onDelete?.(dialog.category.id);
      else if (editing) await onRename?.(dialog.category.id, { name: name.trim(), parentId: parentId || null });
      else await onCreate?.({ area, name: name.trim(), parentId: parentId || null });
      onClose();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <CatalogModal title={deleting ? "删除分类" : editing ? "编辑分类" : "新建分类"} onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      {deleting ? <>
        <p className="catalog-confirm-name">{categoryBreadcrumb(categories, dialog.category.id)}</p>
        <p className="catalog-help">将删除此分类及其下级分类，素材的其他分类、标签和原文件均保留。</p>
      </> : <div className="catalog-dialog-fields">
        <label>分类名称<input data-autofocus value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <label>上级分类<select value={parentId} disabled={busy} onChange={(event) => setParentId(event.target.value)}><option value="">无（顶级分类）</option>{categoryRows(categories).filter((entry) => !excluded.has(entry.id)).map((entry) => <option key={entry.id} value={entry.id}>{categoryBreadcrumb(categories, entry.id)}</option>)}</select></label>
      </div>}
      {error && <p className="catalog-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className={deleting ? "confirm-delete" : "confirm-organize"} disabled={busy || (!deleting && !name.trim())}>{busy ? "正在保存…" : deleting ? "删除分类" : "保存"}</button></div>
    </form>
  </CatalogModal>;
}

export function CatalogCategories({ area, categories, selectedId = "all", onSelect, onCreate, onRename, onDelete, onAssign, selectionCount = 0, onDropFiles, materialAreas = DEFAULT_MATERIAL_AREAS }) {
  const entries = useMemo(() => byArea(categories, area), [categories, area]);
  const rows = useMemo(() => categoryRows(entries), [entries]);
  const [collapsed, setCollapsed] = useState(new Set());
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dropId, setDropId] = useState("");
  const selected = entries.find((entry) => entry.id === selectedId);
  useEffect(() => { setDialog(null); setError(""); setCollapsed(new Set()); }, [area]);
  async function assign(mode) {
    if (!selected || !selectionCount || busy) return;
    setError(""); setBusy(true);
    try { await onAssign?.([selected.id], { mode }); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function dropProps(id) {
    if (!onDropFiles) return {};
    return {
      onDragOver: (event) => {
        const types = Array.from(event.dataTransfer?.types || []);
        if (!types.some((type) => ["Files", "application/x-yu-catalog-assets"].includes(type))) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = types.includes("application/x-yu-catalog-assets") ? "link" : "move";
        setDropId(id);
      },
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropId(""); },
      onDrop: (event) => {
        const types = Array.from(event.dataTransfer?.types || []);
        if (!types.some((type) => ["Files", "application/x-yu-catalog-assets"].includes(type))) return;
        event.preventDefault(); event.stopPropagation(); setDropId(""); onDropFiles(event, id);
      },
    };
  }
  if (!reusable(area, materialAreas)) return null;
  return <section className="catalog-categories" aria-label="素材分类">
    <div className="catalog-category-heading"><span>分类</span><div><button type="button" className="catalog-icon-button" title="新建顶级分类" aria-label="新建顶级分类" onClick={() => setDialog({ mode: "create" })}><Plus size={15} /></button><button type="button" className="catalog-icon-button" disabled={!selected} title="新建下级分类" aria-label="新建下级分类" onClick={() => setDialog({ mode: "create", parentId: selected.id })}><FolderSimple size={15} /><Plus size={10} /></button><button type="button" className="catalog-icon-button" disabled={!selected} title="编辑分类" aria-label="编辑分类" onClick={() => setDialog({ mode: "edit", category: selected })}><PencilSimple size={14} /></button><button type="button" className="catalog-icon-button" disabled={!selected} title="删除分类" aria-label="删除分类" onClick={() => setDialog({ mode: "delete", category: selected })}><Trash size={14} /></button></div></div>
    <div className="catalog-category-tree" role="group" aria-label={`${area}分类`}>
      {[{ id: "all", name: "全部" }, { id: "uncategorized", name: "未分类" }].map((entry) => <div key={entry.id} className={`catalog-category-row ${selectedId === entry.id ? "active" : ""} ${dropId === entry.id ? "drop-target" : ""}`} {...dropProps(entry.id)}><span className="catalog-tree-spacer" /><button type="button" aria-pressed={selectedId === entry.id} onClick={() => onSelect?.(entry.id)}>{entry.name}</button></div>)}
      {rows.filter((entry) => !entry.ancestors.some((id) => collapsed.has(id))).map((entry) => {
        const hasChildren = entries.some((child) => child.parentId === entry.id);
        return <div key={entry.id} className={`catalog-category-row ${selectedId === entry.id ? "active" : ""} ${dropId === entry.id ? "drop-target" : ""}`} style={{ paddingLeft: 5 + entry.depth * 16 }} {...dropProps(entry.id)}>
          {hasChildren ? <button className="catalog-tree-toggle" type="button" aria-label={`${collapsed.has(entry.id) ? "展开" : "收起"}${entry.name}`} aria-expanded={!collapsed.has(entry.id)} onClick={() => setCollapsed((current) => { const next = new Set(current); next.has(entry.id) ? next.delete(entry.id) : next.add(entry.id); return next; })}>{collapsed.has(entry.id) ? <CaretRight size={12} /> : <CaretDown size={12} />}</button> : <span className="catalog-tree-spacer" />}
          <button type="button" title={categoryBreadcrumb(entries, entry.id)} aria-pressed={selectedId === entry.id} onClick={() => onSelect?.(entry.id)}><FolderSimple size={14} aria-hidden="true" /><span>{entry.name}</span></button>
        </div>;
      })}
    </div>
    {selectionCount > 0 && selected && <div className="catalog-category-assign"><span>已选 {selectionCount} 项</span><button type="button" disabled={busy} onClick={() => assign("add")}>加入此分类</button><button type="button" disabled={busy} onClick={() => assign("remove")}>移出此分类</button></div>}
    {error && <p className="catalog-error" role="alert">{error}</p>}
    {dialog && <CategoryDialog key={`${dialog.mode}-${dialog.category?.id || dialog.parentId || "root"}`} dialog={dialog} categories={entries} area={area} onClose={() => setDialog(null)} onCreate={onCreate} onRename={onRename} onDelete={onDelete} />}
  </section>;
}

const draftValues = (asset) => ({ displayName: asset.displayName || "", tags: array(asset.tags).join("，"), note: asset.note || "" });
const normalizedDraft = (field, value) => field === "tags" ? parseCatalogTags(value) : field === "displayName" ? value.trim() : value;
const equalValue = (first, second) => JSON.stringify(first) === JSON.stringify(second);

function AssetMetadataFields({ asset, categories, onUpdate, onAssign, onRelink, materialAreas = DEFAULT_MATERIAL_AREAS }) {
  const [draft, setDraft] = useState(() => draftValues(asset));
  const draftRef = useRef(draft);
  const savedRef = useRef({ displayName: asset.displayName || "", tags: parseCatalogTags(asset.tags), note: asset.note || "" });
  const updateRef = useRef(onUpdate);
  const mountedRef = useRef(true);
  const memberRef = useRef(array(asset.categoryIds));
  const [members, setMembers] = useState(array(asset.categoryIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  updateRef.current = onUpdate;
  const entries = useMemo(() => byArea(categories, asset.area), [categories, asset.area]);
  useEffect(() => {
    if (!busy) { memberRef.current = array(asset.categoryIds); setMembers(array(asset.categoryIds)); }
  }, [asset.categoryIds, busy]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const patch = {};
      for (const field of ["displayName", "tags", "note"]) {
        const value = normalizedDraft(field, draftRef.current[field]);
        if (!equalValue(savedRef.current[field], value)) patch[field] = value;
      }
      if (Object.keys(patch).length) {
        try { Promise.resolve(updateRef.current?.(patch)).catch(() => {}); } catch { /* Parent reports persistent save failures. */ }
      }
    };
  }, []);
  function change(field, value) {
    draftRef.current = { ...draftRef.current, [field]: value };
    setDraft(draftRef.current);
  }
  async function commit(field) {
    const next = normalizedDraft(field, draftRef.current[field]);
    const previous = savedRef.current[field];
    if (equalValue(previous, next)) return;
    savedRef.current[field] = next;
    setError("");
    try { await updateRef.current?.({ [field]: next }); }
    catch (cause) {
      if (equalValue(savedRef.current[field], next)) savedRef.current[field] = previous;
      if (mountedRef.current) setError(errorMessage(cause));
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const field of ["displayName", "tags", "note"]) commit(field);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft]);
  async function saveAll() { for (const field of ["displayName","tags","note"]) await commit(field); }
  async function setMembership(id, checked) {
    if (busy) return;
    const previous = memberRef.current;
    const next = checked ? [...new Set([...previous, id])] : previous.filter((entry) => entry !== id);
    memberRef.current = next; setMembers(next); setBusy(true); setError("");
    try { await onAssign?.(next, { mode: "replace" }); }
    catch (cause) { memberRef.current = previous; setMembers(previous); setError(errorMessage(cause)); }
    finally { if (mountedRef.current) setBusy(false); }
  }
  return <section className="catalog-asset-editor" aria-label="素材资料">
    {asset.online === false && <div className="catalog-offline"><strong>原文件未连接</strong><span>分类、标签和备注已保留。</span><button type="button" onClick={onRelink}>重新定位原文件</button></div>}
    <label className="catalog-field">显示名称<input value={draft.displayName} placeholder={asset.name || "原文件名称"} onChange={(event) => change("displayName", event.target.value)} onBlur={() => commit("displayName")} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} /><span className="catalog-help">只修改库内名称，原文件名保留。</span></label>
    <label className="catalog-field">标签<textarea rows={2} value={draft.tags} placeholder="用逗号或换行分隔标签" onChange={(event) => change("tags", event.target.value)} onBlur={() => commit("tags")} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
    {reusable(asset.area, materialAreas) && <fieldset className="catalog-memberships" disabled={busy}><legend>所属分类</legend><div>{categoryRows(entries).map((entry) => <label key={entry.id} title={categoryBreadcrumb(entries, entry.id)} style={{ paddingLeft: 2 + entry.depth * 14 }}><input type="checkbox" checked={members.includes(entry.id)} onChange={(event) => setMembership(entry.id, event.target.checked)} /><span>{entry.name}</span></label>)}{!entries.length && <span className="catalog-help">暂无分类，可在分类栏新建。</span>}</div></fieldset>}
    <label className="note-editor">备注<textarea placeholder="写一点方便自己查找的备注…" value={draft.note} onChange={(event) => change("note", event.target.value)} onBlur={() => commit("note")} /></label>
    <button type="button" className="catalog-save-metadata" onClick={saveAll}>保存资料</button>
    {error && <p className="catalog-error" role="alert">{error}</p>}
  </section>;
}

export function CatalogAssetEditor(props) {
  return props.asset ? <AssetMetadataFields key={props.asset.id} {...props} /> : null;
}

export function CatalogFilters({ scope = "current", onScopeChange, mediaType = "all", onMediaTypeChange, favoritesOnly = false, onFavoritesChange, tags, selectedTags, onSelectedTagsChange }) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const tagRef = useRef(null);
  const selected = array(selectedTags);
  const tagOptions = [...new Set([...array(tags), ...selected])].sort((first, second) => first.localeCompare(second, "zh-CN"));
  const tagId = useId();
  useEffect(() => {
    if (!tagsOpen) return;
    const outside = (event) => { if (!tagRef.current?.contains(event.target)) setTagsOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [tagsOpen]);
  return <div className="catalog-filters" aria-label="搜索和筛选">
    <label>搜索范围<select value={scope} onChange={(event) => onScopeChange?.(event.target.value)}><option value="current">当前位置</option><option value="all">全库</option></select></label>
    <label>类型<select value={mediaType} onChange={(event) => onMediaTypeChange?.(event.target.value)}>{[["all", "全部类型"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["source", "源文件"], ["document", "文档"], ["font", "字体"], ["other", "其他"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="catalog-favorite-filter"><input type="checkbox" checked={favoritesOnly} onChange={(event) => onFavoritesChange?.(event.target.checked)} />只看收藏</label>
    <div ref={tagRef} className="catalog-tag-filter" onKeyDown={(event) => { if (tagsOpen && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setTagsOpen(false); tagRef.current?.querySelector("button")?.focus(); } }}><button type="button" aria-expanded={tagsOpen} aria-controls={tagId} onClick={() => setTagsOpen((value) => !value)}>标签{selected.length ? ` · ${selected.length}` : ""}<CaretDown size={12} /></button>
      {tagsOpen && <div id={tagId} className="catalog-tag-options"><div className="catalog-tag-options-heading"><span>同时包含所选标签</span>{selected.length > 0 && <button type="button" onClick={() => onSelectedTagsChange?.([])}>清空</button>}<button type="button" aria-label="关闭标签筛选" onClick={() => setTagsOpen(false)}><X size={13} /></button></div>{tagOptions.map((tag) => <label key={tag}><input type="checkbox" checked={selected.includes(tag)} onChange={(event) => onSelectedTagsChange?.(event.target.checked ? [...selected, tag] : selected.filter((entry) => entry !== tag))} /><span>{tag}</span></label>)}{!tagOptions.length && <span className="catalog-help">暂无标签</span>}</div>}
    </div>
  </div>;
}

function bytesLabel(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function CatalogStorageDialog({ info = {}, onClose, onChoose, onBackup, onRestore, onClearCache, onLimitChange, busy = false, error }) {
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const isBusy = busy || pending;
  const directory = info.directory || info.catalogPath || info.path;
  const cacheDirectory = info.cacheDirectory || info.cachePath || info.thumbnailCachePath;
  const cacheBytes = info.cacheBytes ?? info.cache?.sizeBytes ?? info.thumbnailCache?.bytes ?? 0;
  const limitMB = info.cacheLimitMB ?? Math.round((info.cacheLimitBytes ?? info.cache?.limitBytes ?? 1024 ** 3) / 1024 ** 2);
  const limits = [...new Set([128, 256, 512, 1024, 2048, 4096, limitMB])].sort((first, second) => first - second);
  async function run(callback, ...args) {
    if (isBusy) return;
    setPending(true); setLocalError("");
    try { await callback?.(...args); }
    catch (cause) { setLocalError(errorMessage(cause)); }
    finally { setPending(false); }
  }
  return <CatalogModal title="资料库与缓存" onClose={onClose} busy={isBusy} className="catalog-storage-dialog">
    <dl className="catalog-storage-info"><dt>资料库位置</dt><dd>{directory || "尚未读取"}</dd>{cacheDirectory && <><dt>缓存位置</dt><dd>{cacheDirectory}</dd></>}<dt>整理数据库</dt><dd>{bytesLabel(info.databaseBytes)}</dd><dt>整理记录备份</dt><dd>{bytesLabel(info.backupBytes)}</dd><dt>预览缓存</dt><dd>{bytesLabel(cacheBytes)}</dd></dl>
    <p className="catalog-help">这里只保存整理记录和预览缓存，原文件仍在各自的本地文件夹。更改此位置不会移动原文件。</p>
    <div className="catalog-storage-actions"><button type="button" disabled={isBusy} onClick={() => run(onChoose)}>更改保存位置…</button><button type="button" disabled={isBusy} onClick={() => run(onClearCache)}>清理预览缓存</button></div>
    <label className="catalog-cache-limit">预览缓存上限<select disabled={isBusy} value={limitMB} onChange={(event) => run(onLimitChange, Number(event.target.value))}>{limits.map((value) => <option key={value} value={value}>{value < 1024 ? `${value} MB` : `${value / 1024} GB`}</option>)}</select></label>
    <p className="catalog-help">清理缓存后按需重新生成预览，原文件、分类、标签和备注均保留。</p>
    <div className="catalog-storage-backup"><strong>整理信息备份</strong><p className="catalog-help">备份文件保存分类、标签、备注和文件地址，不包含图片、视频等原文件。</p><div className="catalog-storage-actions"><button type="button" disabled={isBusy} onClick={() => run(onBackup)}>备份整理信息…</button><button type="button" disabled={isBusy} onClick={() => setRestoreConfirm(true)}>恢复整理信息…</button></div></div>
    {restoreConfirm && <div className="catalog-restore-confirm" role="group" aria-label="确认恢复整理信息"><p>恢复将用所选备份替换当前整理记录，原文件位置和内容保留。</p><div className="catalog-storage-actions"><button type="button" disabled={isBusy} onClick={() => setRestoreConfirm(false)}>取消</button><button type="button" disabled={isBusy} onClick={() => { setRestoreConfirm(false); run(onRestore); }}>选择备份并恢复…</button></div></div>}
    {(error || localError) && <p className="catalog-error" role="alert">{error || localError}</p>}
    <div className="dialog-actions"><button type="button" disabled={isBusy} onClick={onClose}>完成</button></div>
  </CatalogModal>;
}
