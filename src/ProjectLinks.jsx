import { useEffect, useId, useMemo, useRef, useState } from "react";
import { File, LinkSimple, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { defaultLinkRole, PROJECT_LINK_ROLES } from "./project-links.js";

const asArray = (value) => Array.isArray(value) ? value : [];

function toMembers(items) {
  const unique = new Map();
  for (const item of asArray(items)) {
    if (!item?.id || unique.has(item.id)) continue;
    unique.set(item.id, {
      id: item.id,
      name: item.name || item.id.split(/[\\/]/).at(-1),
      role: PROJECT_LINK_ROLES.includes(item.role) ? item.role : defaultLinkRole(item),
    });
  }
  return [...unique.values()];
}

function combinedMembers(first, second) {
  return toMembers([...asArray(first), ...asArray(second)]);
}

function MemberPreview({ file }) {
  if (file?.previewUrl) {
    const source = file.previewUrl.startsWith("yu-asset:")
      ? `${file.previewUrl}${file.previewUrl.includes("?") ? "&" : "?"}thumbnail=1`
      : file.previewUrl;
    return <img src={source} alt="" loading="lazy" decoding="async" draggable={false} />;
  }
  return <File size={19} weight="duotone" aria-hidden="true" />;
}

function LinkedMember({ member, file, group, onSelectFile }) {
  const contents = <>
    <MemberPreview file={file} />
    <span><strong>{file?.name || member.name}</strong>{!file && <span className="project-link-meta">未连接</span>}</span>
    <span className="project-link-role">{member.role}</span>
  </>;
  return file
    ? <button type="button" className="project-link-member" title={file.fullPath || file.relativePath || file.name} onClick={() => onSelectFile?.(file, group)}>{contents}</button>
    : <div className="project-link-member link-unavailable" title={member.id}>{contents}</div>;
}

export function ProjectLinkDialog({ groups, projects, files, items, group, onSave, onDelete, onClose, initialProject }) {
  const generatedId = useId();
  const dialogRef = useRef(null);
  const projectInputRef = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(false);
  const initialMembers = useMemo(() => toMembers(items), [items]);
  const [projectName, setProjectName] = useState(() => group?.projectName || (typeof initialProject === "string" ? initialProject : initialProject?.name) || asArray(items).find((item) => item.project)?.project || "");
  const [targetId, setTargetId] = useState(group?.id || "");
  const [name, setName] = useState(group?.name || "");
  const [members, setMembers] = useState(() => combinedMembers(group?.members, items));
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  closeRef.current = onClose;
  busyRef.current = busy;

  const fileMap = useMemo(() => new Map(asArray(files).map((file) => [file.id, file])), [files]);
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const projectOptions = useMemo(() => [...new Set([
    ...asArray(projects).map((project) => project.name),
    ...asArray(groups).map((entry) => entry.projectName),
  ].filter(Boolean))], [projects, groups]);
  const matchingGroups = asArray(groups).filter((entry) => entry.projectName === projectName.trim());
  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return asArray(files).filter((file) => !memberIds.has(file.id) && (!needle || [
      file.name, file.project, file.category, file.relativePath, ...asArray(file.tags),
    ].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle))).slice(0, 60);
  }, [files, query, memberIds]);

  useEffect(() => {
    const previous = document.activeElement;
    const controls = () => [...(dialogRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
    ) || [])].filter((element) => element.getClientRects().length);
    const focusFirst = () => (controls()[0] || dialogRef.current)?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current?.();
      } else if (event.key === "Tab") {
        const available = controls();
        const first = available[0];
        const last = available.at(-1);
        if (!first) {
          event.preventDefault();
          dialogRef.current?.focus();
        } else if (event.shiftKey && (document.activeElement === first || !available.includes(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !available.includes(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const keepFocus = (event) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) focusFirst();
    };
    if (projectInputRef.current && !projectInputRef.current.disabled) projectInputRef.current.focus();
    else focusFirst();
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("focusin", keepFocus);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("focusin", keepFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function chooseTarget(id) {
    setTargetId(id);
    const target = asArray(groups).find((entry) => entry.id === id);
    setName(target?.name || "");
    setMembers(combinedMembers(target?.members, initialMembers));
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!projectName.trim()) { setError("请填写项目名称"); projectInputRef.current?.focus(); return; }
    if (!name.trim()) { setError("请填写关联组名称"); return; }
    if (!members.length) { setError("请选择素材"); return; }
    setBusy(true);
    setError("");
    try {
      await onSave({ ...(targetId ? { id: targetId } : {}), projectName: projectName.trim(), name: name.trim(), members });
    } catch (cause) {
      setError(cause?.message || "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    if (busy || !group) return;
    setBusy(true);
    setError("");
    try { await onDelete(group.id); }
    catch (cause) { setError(cause?.message || "取消关联失败"); }
    finally { setBusy(false); }
  }

  return <div className="dialog-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose?.();
  }}>
    <form ref={dialogRef} tabIndex={-1} className="organize-dialog link-dialog" role="dialog" aria-modal="true" aria-labelledby={`${generatedId}-title`} aria-busy={busy} onSubmit={submit}>
      <div className="dialog-heading"><h2 id={`${generatedId}-title`}>{group ? "管理关联" : "关联到项目"}</h2><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <div className="link-dialog-fields">
        <label>项目名称<input ref={projectInputRef} value={projectName} disabled={busy || Boolean(group)} list={`${generatedId}-projects`} onChange={(event) => {
          setProjectName(event.target.value);
          if (!group && targetId) { setTargetId(""); setName(""); setMembers(initialMembers); }
        }} /><datalist id={`${generatedId}-projects`}>{projectOptions.map((project) => <option key={project} value={project} />)}</datalist></label>
        {!group && <label>关联组<select value={targetId} disabled={busy} onChange={(event) => chooseTarget(event.target.value)}><option value="">新建关联组</option>{matchingGroups.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
        <label>组名<input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <div className="project-link-heading"><h3>已选素材 · {members.length}</h3></div>
        <div className="project-link-members">{members.length ? members.map((member) => <div key={member.id} className="link-member-row">
          <div title={fileMap.get(member.id)?.fullPath || member.id}><strong>{fileMap.get(member.id)?.name || member.name}</strong>{!fileMap.has(member.id) && <span className="project-link-meta">未连接</span>}</div>
          <select aria-label={`${member.name} 的角色`} disabled={busy} value={member.role} onChange={(event) => setMembers((current) => current.map((entry) => entry.id === member.id ? { ...entry, role: event.target.value } : entry))}>{PROJECT_LINK_ROLES.map((role) => <option key={role}>{role}</option>)}</select>
          <button type="button" title="取消关联" aria-label={`取消关联 ${member.name}`} disabled={busy} onClick={() => setMembers((current) => current.filter((entry) => entry.id !== member.id))}><X size={15} /></button>
        </div>) : <div className="link-empty-state">未选择素材</div>}</div>
        <label>添加素材<input type="search" value={query} placeholder="搜索素材" disabled={busy} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="project-link-members" style={{ maxHeight: 190, overflowY: "auto" }} aria-label="可添加的素材">{candidates.map((file) => <button key={file.id} type="button" className="project-link-member" disabled={busy} title={file.fullPath || file.relativePath || file.name} onClick={() => setMembers((current) => combinedMembers(current, [file]))}>
          <MemberPreview file={file} /><span><strong>{file.name}</strong></span><Plus size={14} aria-hidden="true" />
        </button>)}{!candidates.length && <div className="link-empty-state">{query.trim() ? "没有匹配素材" : "没有可添加的素材"}</div>}</div>
      </div>
      {error && <div role="alert" className="delete-note" style={{ marginTop: 12 }}>{error}</div>}
      <div className="dialog-actions">{group && onDelete && <button type="button" disabled={busy} onClick={deleteGroup} style={{ marginRight: "auto" }}>取消整组关联</button>}<button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="confirm-organize" disabled={busy || !members.length}>{busy ? "正在保存…" : "保存关联"}</button></div>
    </form>
  </div>;
}

export function ProjectGroupList({ groups, files, onEdit, onSelectFile, onRemoveMember, onCreate }) {
  const fileMap = useMemo(() => new Map(asArray(files).map((file) => [file.id, file])), [files]);
  return <section className="link-project-board">
    <div className="link-board-heading"><h2>关联组</h2><button type="button" className="association-action" onClick={onCreate}><Plus size={14} />新建关联</button></div>
    {asArray(groups).length ? <div className="link-group-grid">{groups.map((group) => <article className="project-link-card" key={group.id}>
      <div className="project-link-heading"><strong title={group.name}>{group.name}</strong><button type="button" className="link-icon-button" title="管理关联" aria-label={`管理关联 ${group.name}`} onClick={() => onEdit?.(group)}><PencilSimple size={15} /></button></div>
      <div className="project-link-members">{asArray(group.members).map((member) => <div className="project-link-member-row" key={member.id}>
        <LinkedMember member={member} file={fileMap.get(member.id)} group={group} onSelectFile={onSelectFile} />
        <button type="button" className="link-icon-button" title="取消关联" aria-label={`取消关联 ${member.name}`} onClick={() => onRemoveMember?.(group.id, member.id)}><X size={14} /></button>
      </div>)}</div>
    </article>)}</div> : <div className="link-empty-state">暂无关联组</div>}
  </section>;
}

export function ProjectLinksInspector({ groups, files, onEdit, onSelectFile, onCreate }) {
  const fileMap = useMemo(() => new Map(asArray(files).map((file) => [file.id, file])), [files]);
  return <section className="project-links-section">
    <div className="project-link-heading"><h3>项目关联</h3><button type="button" onClick={onCreate}><LinkSimple size={13} />关联</button></div>
    {asArray(groups).length ? groups.map((group) => <article className="project-link-card" key={group.id}>
      <div className="project-link-heading"><strong title={`${group.projectName} / ${group.name}`}>{group.projectName} / {group.name}</strong><button type="button" className="link-icon-button" title="管理关联" aria-label={`管理关联 ${group.name}`} onClick={() => onEdit?.(group)}><PencilSimple size={14} /></button></div>
      <div className="project-link-members">{asArray(group.members).map((member) => <LinkedMember key={member.id} member={member} file={fileMap.get(member.id)} group={group} onSelectFile={onSelectFile} />)}</div>
    </article>) : <div className="link-empty-state">暂无关联组</div>}
  </section>;
}
