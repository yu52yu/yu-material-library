import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_LINK_ROLES, PROJECT_LINKS_STORAGE_KEY, defaultLinkRole, groupsForFile,
  normalizeProjectLinks, remapLinkedFiles, removeLinkedFiles, removeLinkGroup,
  removeLinkMember, saveLinkGroup,
} from "../src/project-links.js";

const member = (id, role = "源文件") => ({ id, name: id.split(/[\\/]/).at(-1), role });
const fixture = () => ({ version: 1, groups: [{
  id: "group-1", projectId: "C:/项目/灯具", projectName: "灯具", name: "主视觉",
  members: [member("C:/项目/灯具/模型.blend"), member("C:/素材/灯具.png", "参考图")],
  createdAt: 100, updatedAt: 200,
}] });

test("broken JSON, unsupported schemas, and wrong types safely restore an empty state", () => {
  for (const input of [undefined, null, false, 1, "", "{broken", "null", [], { groups: [] }, { version: 2, groups: fixture().groups }, { version: 1, groups: {} }]) {
    assert.deepEqual(normalizeProjectLinks(input), { version: 1, groups: [] });
  }
  assert.equal(PROJECT_LINKS_STORAGE_KEY, "yu-project-links");
  assert.deepEqual(PROJECT_LINK_ROLES, ["源文件", "参考图", "渲染图", "成品", "其他"]);
});

test("schema cleanup salvages valid groups and members, deduplicates ids, and does not mutate the stored value", () => {
  const raw = fixture();
  raw.groups[0].members.push(member("C:/素材/灯具.png", "渲染图"), null, {}, { id: "C:\\未连接\\效果.png", role: "bogus" });
  raw.groups[0].createdAt = -1;
  raw.groups[0].updatedAt = "yesterday";
  raw.groups[0].extra = "ignored";
  raw.groups.push({ ...raw.groups[0], name: "duplicate id" }, null, { id: "empty", projectId: "p", name: "empty", members: [] });
  const snapshot = structuredClone(raw);
  const result = normalizeProjectLinks(JSON.stringify(raw));
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].members.length, 3);
  assert.deepEqual(result.groups[0].members[2], { id: "C:\\未连接\\效果.png", name: "效果.png", role: "其他" });
  assert.equal(result.groups[0].members[1].role, "参考图");
  assert.equal(result.groups[0].createdAt, 0);
  assert.equal(result.groups[0].updatedAt, 0);
  assert.equal(Object.hasOwn(result.groups[0], "extra"), false);
  assert.deepEqual(raw, snapshot);
});

test("create and update a named group, merging repeated members and retaining existing membership on rename", () => {
  const before = fixture();
  const added = saveLinkGroup(before, {
    id: "group-1", name: "主视觉终稿",
    members: [member("C:/素材/灯具.png", "成品"), member("C:/项目/灯具/render.png", "渲染图"), member("C:/项目/灯具/render.png", "渲染图")],
  }, 300);
  assert.equal(added.groups.length, 1);
  assert.equal(added.groups[0].members.length, 3);
  assert.equal(added.groups[0].members[1].role, "成品");
  assert.equal(added.groups[0].createdAt, 100);
  assert.equal(added.groups[0].updatedAt, 300);
  const renamed = saveLinkGroup(added, { id: "group-1", name: "  新名称  " }, 400);
  assert.equal(renamed.groups[0].name, "新名称");
  assert.deepEqual(renamed.groups[0].members, added.groups[0].members);
  assert.deepEqual(before, fixture());
  assert.deepEqual(saveLinkGroup(before, { id: "group-1", name: " " }), before);
  assert.deepEqual(saveLinkGroup(before, { projectId: "p", name: "empty", members: [] }), before);
});

test("a material can belong to several groups and projects without collisions", () => {
  let state = fixture();
  for (const [projectId, name] of [["C:/项目/灯具", "详情页"], ["C:/项目/座椅", "参考"]]) {
    state = saveLinkGroup(state, { projectId, name, members: [member("C:/素材/灯具.png", "参考图")] }, 500);
  }
  assert.equal(new Set(state.groups.map((group) => group.id)).size, 3);
  assert.equal(groupsForFile(state, "C:/素材/灯具.png").length, 3);
  assert.equal(groupsForFile(state, "missing").length, 0);
  assert.equal(state.groups[2].projectName, "C:/项目/座椅");
});

test("unlinking a member affects only that group and removes the group when its final member is unlinked", () => {
  const before = fixture();
  const withSecond = saveLinkGroup(before, { projectId: "p2", name: "second", members: [member("C:/素材/灯具.png")] }, 500);
  const unlinked = removeLinkMember(withSecond, "group-1", "C:/素材/灯具.png", 600);
  assert.equal(unlinked.groups[0].members.length, 1);
  assert.equal(groupsForFile(unlinked, "C:/素材/灯具.png").length, 1);
  assert.equal(unlinked.groups[0].updatedAt, 600);
  const lastRemoved = removeLinkMember(unlinked, "group-1", "C:/项目/灯具/模型.blend", 700);
  assert.equal(lastRemoved.groups.length, 1);
  assert.deepEqual(removeLinkGroup(lastRemoved, lastRemoved.groups[0].id), { version: 1, groups: [] });
  assert.deepEqual(removeLinkGroup(before, "unknown"), before);
});

test("explicit renames and moves migrate every group reference and refresh cached names", () => {
  const before = saveLinkGroup(fixture(), { projectId: "p2", name: "reuse", members: [member("C:/素材/灯具.png", "成品")] }, 300);
  const changes = [
    { source: "C:/素材/灯具.png", destination: "D:/素材/新灯具.png" },
    { source: "C:/项目/灯具/模型.blend", destination: "C:/项目/灯具/模型-v2.blend", name: "模型-v2.blend" },
  ];
  const after = remapLinkedFiles(before, changes, 400);
  assert.equal(groupsForFile(after, "C:/素材/灯具.png").length, 0);
  assert.equal(groupsForFile(after, "D:/素材/新灯具.png").length, 2);
  assert.deepEqual(after.groups[0].members[0], member("C:/项目/灯具/模型-v2.blend"));
  assert.equal(after.groups[1].members[0].name, "新灯具.png");
  assert.equal(after.groups[1].members[0].role, "成品");
  assert.equal(after.groups[0].updatedAt, 400);
  assert.equal(groupsForFile(before, "C:/素材/灯具.png").length, 2);
});

test("move collisions deduplicate destination ids, and remaps apply simultaneously", () => {
  const before = { version: 1, groups: [{ ...fixture().groups[0], members: [member("a"), member("b"), member("c")] }] };
  const collapsed = remapLinkedFiles(before, [{ source: "a", destination: "b" }], 400);
  assert.deepEqual(collapsed.groups[0].members.map((entry) => entry.id), ["b", "c"]);
  const chained = remapLinkedFiles(before, [{ source: "a", destination: "b" }, { source: "b", destination: "d" }], 400);
  assert.deepEqual(chained.groups[0].members.map((entry) => entry.id), ["b", "d", "c"]);
});

test("explicit deletion clears matching references, retains other offline members, and drops empty groups", () => {
  const before = saveLinkGroup(fixture(), { projectId: "p2", name: "only one", members: [member("C:/素材/灯具.png")] }, 300);
  const after = removeLinkedFiles(before, new Set(["C:/素材/灯具.png", "not-in-state"]), 400);
  assert.equal(after.groups.length, 1);
  assert.equal(after.groups[0].members[0].id, "C:/项目/灯具/模型.blend");
  assert.equal(after.groups[0].updatedAt, 400);
  assert.deepEqual(removeLinkedFiles(after, "C:/项目/灯具/模型.blend"), { version: 1, groups: [] });
  assert.deepEqual(normalizeProjectLinks(JSON.stringify(before)), before);
  assert.deepEqual(removeLinkedFiles(before, null), before);
});

test("role suggestions respect project folders and recognize common editable source formats", () => {
  assert.equal(defaultLinkRole({ mode: "参考素材", name: "参考.png" }), "参考图");
  assert.equal(defaultLinkRole({ category: "渲染图", name: "灯具.png" }), "渲染图");
  assert.equal(defaultLinkRole({ category: "详情页", name: "成品.png" }), "成品");
  assert.equal(defaultLinkRole({ category: "源文件", name: "custom.xyz" }), "源文件");
  for (const name of ["模型.blend", "主视觉.PSD", "设计.ai", "模型.step"]) assert.equal(defaultLinkRole({ name }), "源文件");
  assert.equal(defaultLinkRole({ extension: ".PSB" }), "源文件");
  assert.equal(defaultLinkRole({ name: "照片.jpg" }), "其他");
  assert.equal(defaultLinkRole(null), "其他");
});
