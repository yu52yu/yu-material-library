/** Local relationships only: these records never copy, move, or delete files. */
export const PROJECT_LINKS_STORAGE_KEY = "yu-project-links";
export const PROJECT_LINK_ROLES = Object.freeze(["源文件", "参考图", "渲染图", "成品", "其他"]);

const roleSet = new Set(PROJECT_LINK_ROLES);
const emptyState = () => ({ version: 1, groups: [] });
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" ? value.trim() : "";
const timestamp = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? value : fallback;
const fileName = (id) => id.split(/[\\/]/).at(-1) || id;

function normalizeMember(value) {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  return { id, name: text(value.name) || fileName(id), role: roleSet.has(value.role) ? value.role : "其他" };
}

function normalizeMembers(values) {
  if (!Array.isArray(values)) return [];
  const members = new Map();
  for (const value of values) {
    const member = normalizeMember(value);
    if (member && !members.has(member.id)) members.set(member.id, member);
  }
  return [...members.values()];
}

/** Accept the stored JSON string or decoded value; salvage valid version 1 groups. */
export function normalizeProjectLinks(raw) {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return emptyState(); }
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.groups)) return emptyState();

  const seen = new Set();
  const groups = [];
  for (const candidate of value.groups) {
    if (!isRecord(candidate)) continue;
    const id = text(candidate.id);
    const projectId = text(candidate.projectId);
    const name = text(candidate.name);
    const members = normalizeMembers(candidate.members);
    if (!id || !projectId || !name || !members.length || seen.has(id)) continue;
    const createdAt = timestamp(candidate.createdAt);
    seen.add(id);
    groups.push({
      id, projectId, projectName: text(candidate.projectName) || projectId, name, members,
      createdAt, updatedAt: Math.max(createdAt, timestamp(candidate.updatedAt, createdAt)),
    });
  }
  return { version: 1, groups };
}

function allocateGroupId(groups, now) {
  const ids = new Set(groups.map((group) => group.id));
  const base = `link-${now.toString(36)}`;
  let id = base;
  let suffix = 2;
  while (ids.has(id)) id = `${base}-${suffix++}`;
  return id;
}

/** Create a group or merge members into an existing group. Omitted fields are kept. */
export function saveLinkGroup(state, input, now = Date.now()) {
  const current = normalizeProjectLinks(state);
  if (!isRecord(input)) return current;
  const existing = current.groups.find((group) => group.id === text(input.id));
  const projectId = Object.hasOwn(input, "projectId") ? text(input.projectId) : existing?.projectId;
  const name = Object.hasOwn(input, "name") ? text(input.name) : existing?.name;
  if (!projectId || !name) return current;

  const membersById = new Map((existing?.members || []).map((member) => [member.id, member]));
  for (const member of normalizeMembers(input.members)) membersById.set(member.id, member);
  if (!membersById.size) return current;
  const savedAt = timestamp(now);
  const group = {
    id: existing?.id || text(input.id) || allocateGroupId(current.groups, savedAt),
    projectId,
    projectName: Object.hasOwn(input, "projectName")
      ? text(input.projectName) || projectId
      : existing?.projectName || projectId,
    name,
    members: [...membersById.values()],
    createdAt: existing?.createdAt ?? savedAt,
    updatedAt: Math.max(existing?.createdAt || 0, savedAt),
  };
  return {
    version: 1,
    groups: existing
      ? current.groups.map((entry) => entry.id === existing.id ? group : entry)
      : [...current.groups, group],
  };
}

export function removeLinkGroup(state, groupId) {
  const current = normalizeProjectLinks(state);
  return { version: 1, groups: current.groups.filter((group) => group.id !== groupId) };
}

export function removeLinkMember(state, groupId, fileId, now = Date.now()) {
  const current = normalizeProjectLinks(state);
  return {
    version: 1,
    groups: current.groups.map((group) => {
      if (group.id !== groupId || !group.members.some((member) => member.id === fileId)) return group;
      return {
        ...group,
        members: group.members.filter((member) => member.id !== fileId),
        updatedAt: Math.max(group.createdAt, timestamp(now)),
      };
    }).filter((group) => group.members.length),
  };
}

/** Call only after an explicit rename/move succeeds, never as a rescan cleanup. */
export function remapLinkedFiles(state, changes, now = Date.now()) {
  const current = normalizeProjectLinks(state);
  const remaps = new Map();
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!isRecord(change)) continue;
    const source = text(change.source);
    const destination = text(change.destination);
    if (source && destination) remaps.set(source, { id: destination, name: text(change.name) || fileName(destination) });
  }
  return {
    version: 1,
    groups: current.groups.map((group) => {
      if (!group.members.some((member) => remaps.has(member.id))) return group;
      const members = normalizeMembers(group.members.map((member) => {
        const destination = remaps.get(member.id);
        return destination ? { ...member, ...destination } : member;
      }));
      return { ...group, members, updatedAt: Math.max(group.createdAt, timestamp(now)) };
    }),
  };
}

/** Remove references only for files that were explicitly and successfully deleted. */
export function removeLinkedFiles(state, ids, now = Date.now()) {
  const current = normalizeProjectLinks(state);
  const removed = new Set(typeof ids === "string" ? [ids] : ids instanceof Set || Array.isArray(ids) ? ids : []);
  return {
    version: 1,
    groups: current.groups.map((group) => {
      const members = group.members.filter((member) => !removed.has(member.id));
      return members.length === group.members.length ? group : {
        ...group, members, updatedAt: Math.max(group.createdAt, timestamp(now)),
      };
    }).filter((group) => group.members.length),
  };
}

export function groupsForFile(state, id) {
  return normalizeProjectLinks(state).groups.filter((group) => group.members.some((member) => member.id === id));
}

/** A starting suggestion; users can always select a different role. */
export function defaultLinkRole(item) {
  if (!isRecord(item)) return "其他";
  const category = [item.mode, item.category].filter((value) => typeof value === "string").join("/");
  if (/参考/.test(category)) return "参考图";
  if (/渲染/.test(category)) return "渲染图";
  if (/源文件/.test(category)) return "源文件";
  if (/成品|详情页|最终|导出/.test(category)) return "成品";
  const extension = (text(item.extension) || text(item.name).split(".").at(-1) || "").replace(/^\./, "").toLowerCase();
  if (["psd", "psb", "ai", "blend", "c4d", "max", "ma", "mb", "skp", "fbx", "obj", "stp", "step", "sldprt", "sldasm"].includes(extension)) return "源文件";
  return "其他";
}
