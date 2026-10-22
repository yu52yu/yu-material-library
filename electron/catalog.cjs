const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const MEDIA_TYPES = require("./media-types.json");
const { validateMaterialAreaName } = require("./material-areas.cjs");

const FORMAT = "yu-material-catalog-backup";
const VERSION = 1;
const EXTENSION_TYPES = new Map(Object.entries(MEDIA_TYPES).flatMap(([type, extensions]) => extensions.split(" ").map((extension) => [extension, type])));
const CONTEXT_FIELDS = ["relativePath", "project", "mode", "category", "sourceRoot", "isImage", "previewUrl"];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key);

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error(`${label}无效`);
  return value.trim();
}

function stringValue(value, label) {
  if (typeof value !== "string" || value.includes("\0")) throw new Error(`${label}无效`);
  return value;
}

function absolutePath(value, label = "文件路径") {
  requiredText(value, label);
  if (!path.isAbsolute(value)) throw new Error(`${label}必须为绝对路径`);
  return path.resolve(value);
}

function pathKey(value) {
  const resolved = absolutePath(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function jsonValue(value) {
  const walk = (entry, seen = new Set()) => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return;
    if (typeof entry === "number" && Number.isFinite(entry)) return;
    if ((!Array.isArray(entry) && !record(entry)) || seen.has(entry)) throw new Error("资料必须是有效的 JSON 数据");
    if (record(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) {
      throw new Error("资料必须是普通对象");
    }
    seen.add(entry);
    for (const child of Object.values(entry)) walk(child, seen);
    seen.delete(entry);
  };
  walk(value);
  return JSON.parse(JSON.stringify(value));
}

function tagsValue(value) {
  if (!Array.isArray(value)) throw new Error("标签必须为列表");
  return [...new Set(value.map((tag) => requiredText(tag, "标签")))];
}

function idsValue(value, label = "素材") {
  if (!Array.isArray(value)) throw new Error(`${label}编号必须为列表`);
  return [...new Set(value.map((id) => requiredText(id, `${label}编号`)))];
}

function mediaType(extension) {
  return EXTENSION_TYPES.get(extension) || "other";
}

function descriptor(input, fallbackRoot) {
  if (!record(input)) throw new Error("素材记录无效");
  const fullPath = absolutePath(input.fullPath);
  const rootPath = absolutePath(input.rootPath || fallbackRoot || path.dirname(fullPath), "素材根目录");
  const name = input.name === undefined ? path.basename(fullPath) : requiredText(input.name, "文件名");
  const extension = (input.extension === undefined ? path.extname(name).slice(1) : stringValue(input.extension, "文件类型")).toLowerCase().replace(/^\./, "");
  for (const key of ["size", "modified"]) {
    if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key] < 0)) throw new Error(`${key}无效`);
  }
  const context = input.context === undefined ? {} : jsonValue(input.context);
  if (!record(context)) throw new Error("素材上下文无效");
  for (const field of CONTEXT_FIELDS) if (own(input, field)) context[field] = jsonValue(input[field]);
  if (!own(context, "sourceRoot")) context.sourceRoot = rootPath;
  const categoryPath = input.categoryPath === undefined ? [] : input.categoryPath;
  if (!Array.isArray(categoryPath)) throw new Error("分类路径必须为列表");
  return {
    fullPath, rootPath, name, extension, size: input.size ?? 0, modified: input.modified ?? 0,
    area: input.area === undefined ? "下载素材" : requiredText(input.area, "素材区域"),
    mediaType: input.mediaType === undefined ? mediaType(extension) : requiredText(input.mediaType, "媒体类型"),
    fileKey: input.fileKey === undefined || input.fileKey === null ? null : requiredText(input.fileKey, "文件身份"),
    context, categoryPath: categoryPath.map((name) => requiredText(name, "分类名")),
  };
}

function validateCatalogBackup(payload) {
  let parsed = payload;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { throw new Error("备份不是有效的 JSON 文件"); }
  }
  parsed = jsonValue(parsed);
  if (!record(parsed) || parsed.format !== FORMAT || parsed.version !== VERSION || !record(parsed.data)
    || parsed.data.version !== VERSION || !Array.isArray(parsed.data.assets) || !Array.isArray(parsed.data.categories)
    || !record(parsed.data.settings) || !Array.isArray(parsed.data.pendingLegacy)) throw new Error("备份格式或版本不受支持");
  const data = parsed.data;
  if (!own(data, "categorySeeds")) data.categorySeeds = [];
  if (!Array.isArray(data.categorySeeds)) throw new Error("备份目录分类映射无效");
  function canonicalText(value, label) {
    const cleaned = requiredText(value, label);
    if (cleaned !== value) throw new Error(`${label}不能包含首尾空白`);
    return cleaned;
  }
  const categories = new Map();
  const siblingKeys = new Set();
  for (const category of data.categories) {
    if (!record(category)) throw new Error("备份分类无效");
    const id = canonicalText(category.id, "分类编号");
    canonicalText(category.area, "分类区域");
    canonicalText(category.name, "分类名");
    if (categories.has(id) || (category.parentId !== null && typeof category.parentId !== "string")) throw new Error("备份分类编号或父分类无效");
    const siblingKey = JSON.stringify([category.area, category.parentId, category.name]);
    if (siblingKeys.has(siblingKey)) throw new Error("备份包含重名的同级分类");
    siblingKeys.add(siblingKey);
    categories.set(id, category);
  }
  for (const category of categories.values()) {
    const seen = new Set([category.id]);
    let current = category;
    while (current.parentId !== null) {
      const parent = categories.get(current.parentId);
      if (!parent || parent.area !== category.area || seen.has(parent.id)) throw new Error("备份分类层级无效");
      seen.add(parent.id);
      current = parent;
    }
  }
  const seedKeys = new Set();
  for (const seed of data.categorySeeds) {
    if (!record(seed)) throw new Error("备份目录分类映射无效");
    canonicalText(seed.area, "映射区域");
    if (!Array.isArray(seed.categoryPath) || !seed.categoryPath.length) throw new Error("备份目录分类路径无效");
    seed.categoryPath.forEach((name) => canonicalText(name, "目录分类名"));
    const key = JSON.stringify([seed.area, seed.categoryPath]);
    if (seedKeys.has(key)) throw new Error("备份目录分类映射重复");
    seedKeys.add(key);
    if (seed.categoryId !== null) {
      const category = categories.get(seed.categoryId);
      if (!category || category.area !== seed.area) throw new Error("备份目录分类归属无效");
    }
  }
  const assetIds = new Set();
  const paths = new Set();
  for (const asset of data.assets) {
    if (!record(asset)) throw new Error("备份素材无效");
    canonicalText(asset.id, "素材编号");
    canonicalText(asset.name, "文件名");
    canonicalText(asset.area, "素材区域");
    canonicalText(asset.mediaType, "媒体类型");
    stringValue(asset.extension, "文件类型");
    if (!record(asset.context) || !Number.isFinite(asset.size) || !Number.isFinite(asset.modified)) throw new Error("备份素材属性缺失");
    const entry = descriptor(asset);
    if (assetIds.has(asset.id) || paths.has(pathKey(entry.fullPath))) throw new Error("备份包含重复素材编号或路径");
    assetIds.add(asset.id);
    paths.add(pathKey(entry.fullPath));
    stringValue(asset.displayName, "显示名称");
    stringValue(asset.note, "备注");
    if (typeof asset.favorite !== "boolean" || typeof asset.online !== "boolean") throw new Error("备份素材状态无效");
    if (JSON.stringify(tagsValue(asset.tags)) !== JSON.stringify(asset.tags)) throw new Error("备份标签无效");
    const categoryIds = idsValue(asset.categoryIds, "分类");
    if (categoryIds.length !== asset.categoryIds.length) throw new Error("备份分类归属重复");
    for (const id of categoryIds) {
      const category = categories.get(id);
      if (!category || category.area !== asset.area) throw new Error("备份素材分类归属无效");
    }
  }
  const pendingPaths = new Set();
  for (const entry of data.pendingLegacy) {
    if (!record(entry) || !record(entry.metadata)) throw new Error("备份迁移记录无效");
    const key = pathKey(entry.fullPath);
    if (pendingPaths.has(key)) throw new Error("备份迁移路径重复");
    pendingPaths.add(key);
    if (own(entry.metadata, "favorite") && typeof entry.metadata.favorite !== "boolean") throw new Error("备份收藏记录无效");
    if (own(entry.metadata, "note")) stringValue(entry.metadata.note, "备注");
  }
  for (const key of Object.keys(data.settings)) requiredText(key, "设置名称");
  if (own(data.settings, "customAreas")) {
    if (!Array.isArray(data.settings.customAreas)) throw new Error("备份素材分区无效");
    const validated = [];
    for (const name of data.settings.customAreas) {
      const cleaned = validateMaterialAreaName(name, validated);
      if (cleaned !== name) throw new Error("备份素材分区名称不能包含首尾空白");
      validated.push(cleaned);
    }
  }
  return parsed;
}

function createCatalog(directory) {
  const resolvedDirectory = absolutePath(directory, "资料库目录");
  fs.mkdirSync(resolvedDirectory, { recursive: true });
  const databasePath = path.join(resolvedDirectory, "catalog.sqlite");
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    const currentVersion = db.prepare("PRAGMA user_version").get().user_version;
    if (currentVersion !== 0 && currentVersion !== VERSION) throw new Error("资料库版本不受支持");
    db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, full_path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, root_path TEXT NOT NULL,
        root_key TEXT NOT NULL, name TEXT NOT NULL, extension TEXT NOT NULL, size REAL NOT NULL,
        modified REAL NOT NULL, display_name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
        favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)), tags_json TEXT NOT NULL DEFAULT '[]',
        media_type TEXT NOT NULL, area TEXT NOT NULL, online INTEGER NOT NULL DEFAULT 1 CHECK(online IN (0,1)),
        file_key TEXT, context_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS assets_root ON assets(root_key);
      CREATE INDEX IF NOT EXISTS assets_file_identity ON assets(file_key);
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY, area TEXT NOT NULL, name TEXT NOT NULL,
        parent_id TEXT REFERENCES categories(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS category_siblings ON categories(area, COALESCE(parent_id, ''), name);
      CREATE TABLE IF NOT EXISTS asset_categories (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY(asset_id, category_id)
      );
      CREATE TABLE IF NOT EXISTS category_seeds (
        area TEXT NOT NULL, source_path TEXT NOT NULL,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        PRIMARY KEY(area, source_path)
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_legacy (path_key TEXT PRIMARY KEY, full_path TEXT NOT NULL, metadata_json TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
  } catch (error) { db.close(); throw error; }
  let closed = false;
  const ensureOpen = () => { if (closed) throw new Error("资料库已经关闭"); };
  function transaction(callback) {
    ensureOpen();
    db.exec("BEGIN IMMEDIATE");
    try { const result = callback(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function getSetting(key) {
    ensureOpen();
    const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(requiredText(key, "设置名称"));
    return row ? JSON.parse(row.value_json) : undefined;
  }
  function writeSetting(key, value) {
    db.prepare("INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
      .run(requiredText(key, "设置名称"), JSON.stringify(jsonValue(value)));
    return value;
  }
  function categoryRow(row) { return { id: row.id, area: row.area, name: row.name, parentId: row.parent_id }; }
  function rawCategory(id) {
    const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(requiredText(id, "分类编号"));
    if (!row) throw new Error("分类不存在");
    return row;
  }
  function rawAsset(id) {
    const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(requiredText(id, "素材编号"));
    if (!row) throw new Error("素材不存在");
    return row;
  }
  function readSnapshot(privateFields = false) {
    ensureOpen();
    const memberships = new Map();
    for (const row of db.prepare("SELECT * FROM asset_categories ORDER BY category_id").all()) {
      if (!memberships.has(row.asset_id)) memberships.set(row.asset_id, []);
      memberships.get(row.asset_id).push(row.category_id);
    }
    const assets = db.prepare("SELECT * FROM assets ORDER BY rowid").all().map((row) => ({
      id: row.id, fullPath: row.full_path, rootPath: row.root_path, name: row.name,
      extension: row.extension, size: row.size, modified: row.modified, displayName: row.display_name,
      note: row.note, favorite: Boolean(row.favorite), tags: JSON.parse(row.tags_json),
      categoryIds: memberships.get(row.id) || [], mediaType: row.media_type, area: row.area,
      online: Boolean(row.online), context: JSON.parse(row.context_json),
      ...(privateFields ? { fileKey: row.file_key } : {}),
    }));
    const settings = {};
    for (const row of db.prepare("SELECT * FROM settings ORDER BY key").all()) {
      Object.defineProperty(settings, row.key, { value: JSON.parse(row.value_json), enumerable: true, writable: true, configurable: true });
    }
    return { version: VERSION, assets, categories: db.prepare("SELECT * FROM categories ORDER BY rowid").all().map(categoryRow), settings };
  }
  function createCategoryInternal({ area, name, parentId = null }, id = randomUUID()) {
    area = requiredText(area, "分类区域");
    name = requiredText(name, "分类名");
    if (parentId !== null && rawCategory(parentId).area !== area) throw new Error("父分类必须属于同一素材区域");
    db.prepare("INSERT INTO categories(id, area, name, parent_id) VALUES (?, ?, ?, ?)").run(id, area, name, parentId);
    return { id, area, name, parentId };
  }
  function createMaterialArea(name) {
    return transaction(() => {
      const customAreas = getSetting("customAreas") || [];
      if (!Array.isArray(customAreas)) throw new Error("已保存的素材分区无效");
      const cleaned = validateMaterialAreaName(name, customAreas);
      writeSetting("customAreas", [...customAreas, cleaned]);
      return readSnapshot();
    });
  }
  function initialCategories(entry, assetId) {
    let parentId = null;
    let startIndex = 0;
    const labels = getSetting("categoryLabels") || {};
    // The deepest known mapping wins even if the category was moved away from its former parent.
    for (let index = entry.categoryPath.length - 1; index >= 0; index -= 1) {
      const sourcePath = JSON.stringify(entry.categoryPath.slice(0, index + 1));
      const seed = db.prepare("SELECT category_id FROM category_seeds WHERE area = ? AND source_path = ?").get(entry.area, sourcePath);
      if (seed) {
        // A null mapping is a deliberate deletion, kept to avoid recreating obsolete physical categories.
        if (seed.category_id === null) return;
        parentId = seed.category_id;
        startIndex = index + 1;
        break;
      }
    }
    for (let index = startIndex; index < entry.categoryPath.length; index += 1) {
      const rawName = entry.categoryPath[index];
      const sourcePath = JSON.stringify(entry.categoryPath.slice(0, index + 1));
      const alias = index === 0 ? labels[JSON.stringify([entry.area, "", "", rawName])] : undefined;
      const name = typeof alias === "string" && alias.trim() ? alias.trim() : rawName;
      const existing = db.prepare("SELECT * FROM categories WHERE area = ? AND parent_id IS ? AND name = ?").get(entry.area, parentId, name);
      parentId = existing?.id || createCategoryInternal({ area: entry.area, name, parentId }).id;
      db.prepare("INSERT INTO category_seeds(area, source_path, category_id) VALUES (?, ?, ?)").run(entry.area, sourcePath, parentId);
    }
    if (parentId) db.prepare("INSERT OR IGNORE INTO asset_categories(asset_id, category_id) VALUES (?, ?)").run(assetId, parentId);
  }
  function applyPending(assetId, fullPath) {
    const key = pathKey(fullPath);
    const row = db.prepare("SELECT * FROM pending_legacy WHERE path_key = ?").get(key);
    if (!row) return;
    const metadata = JSON.parse(row.metadata_json);
    if (own(metadata, "favorite")) db.prepare("UPDATE assets SET favorite = ? WHERE id = ?").run(Number(metadata.favorite), assetId);
    if (own(metadata, "note")) db.prepare("UPDATE assets SET note = ? WHERE id = ?").run(metadata.note, assetId);
    db.prepare("DELETE FROM pending_legacy WHERE path_key = ?").run(key);
  }
  function remapProjectLinks(moves) {
    const links = getSetting("projectLinks");
    if (record(links) && Array.isArray(links.groups)) {
      const byPath = new Map(moves.map((move) => [pathKey(move.source), move]));
      let changed = false;
      for (const group of links.groups) {
        if (!record(group) || !Array.isArray(group.members)) continue;
        let groupChanged = false;
        group.members = group.members.map((member) => {
          if (!record(member) || typeof member.id !== "string" || !path.isAbsolute(member.id)) return member;
          const move = byPath.get(pathKey(member.id));
          if (!move) return member;
          changed = groupChanged = true;
          return { ...member, id: move.destination, name: move.name || path.basename(move.destination) };
        });
        if (groupChanged) {
          group.updatedAt = Math.max(Number(group.createdAt) || 0, Date.now());
          const seen = new Set();
          group.members = group.members.filter((member) => {
            if (!record(member) || typeof member.id !== "string") return true;
            if (seen.has(member.id)) return false;
            seen.add(member.id);
            return true;
          });
        }
      }
      if (changed) writeSetting("projectLinks", links);
    }
    // Deferred migration records must follow an explicit move even before a file is first indexed.
    const pending = db.prepare("SELECT * FROM pending_legacy").all();
    const byPath = new Map(moves.map((move) => [pathKey(move.source), move]));
    const remapped = new Map(pending.filter((row) => !byPath.has(row.path_key)).map((row) => [row.path_key, row]));
    for (const row of pending) {
      const move = byPath.get(row.path_key);
      if (!move) continue;
      const target = remapped.get(pathKey(move.destination));
      const metadata = { ...JSON.parse(row.metadata_json), ...(target ? JSON.parse(target.metadata_json) : {}) };
      remapped.set(pathKey(move.destination), { path_key: pathKey(move.destination), full_path: move.destination, metadata_json: JSON.stringify(metadata) });
    }
    if (moves.length) {
      db.prepare("DELETE FROM pending_legacy").run();
      for (const row of remapped.values()) db.prepare("INSERT INTO pending_legacy(path_key, full_path, metadata_json) VALUES (?, ?, ?)")
        .run(row.path_key, row.full_path, row.metadata_json);
    }
  }
  function writeDescriptor(id, entry) {
    db.prepare(`UPDATE assets SET full_path = ?, path_key = ?, root_path = ?, root_key = ?, name = ?, extension = ?,
      size = ?, modified = ?, media_type = ?, online = 1, file_key = ?, context_json = ? WHERE id = ?`)
      .run(entry.fullPath, pathKey(entry.fullPath), entry.rootPath, pathKey(entry.rootPath), entry.name, entry.extension,
        entry.size, entry.modified, entry.mediaType, entry.fileKey, JSON.stringify(entry.context), id);
  }
  function reconcile(entries, { rootPath, complete = true, replacedPath } = {}) {
    if (!Array.isArray(entries) || typeof complete !== "boolean") throw new Error("扫描结果无效");
    const root = rootPath === undefined ? undefined : absolutePath(rootPath, "素材根目录");
    const replaced = replacedPath === undefined ? undefined : pathKey(replacedPath);
    const normalized = entries.map((entry) => descriptor(entry, root));
    const seen = new Set();
    const incomingKeys = new Map();
    for (const entry of normalized) {
      const key = pathKey(entry.fullPath);
      if (seen.has(key)) throw new Error("扫描结果包含重复文件路径");
      seen.add(key);
      if (entry.fileKey) incomingKeys.set(entry.fileKey, (incomingKeys.get(entry.fileKey) || 0) + 1);
    }
    return transaction(() => {
      const previous = db.prepare("SELECT * FROM assets").all();
      const previousPaths = new Map(previous.map((row) => [row.path_key, row]));
      const identities = new Map();
      for (const row of previous) if (row.file_key) {
        if (!identities.has(row.file_key)) identities.set(row.file_key, []);
        identities.get(row.file_key).push(row);
      }
      if (complete) {
        const roots = root ? [root] : [...new Set(normalized.map((entry) => entry.rootPath))];
        for (const scannedRoot of roots) db.prepare("UPDATE assets SET online = 0 WHERE root_key = ?").run(pathKey(scannedRoot));
      } else if (replaced) {
        for (const row of previous) {
          if ((row.path_key === replaced || row.path_key.startsWith(`${replaced}${path.sep}`))
            && !seen.has(row.path_key) && !fs.existsSync(row.full_path)) {
            db.prepare("UPDATE assets SET online = 0 WHERE id = ?").run(row.id);
          }
        }
      }
      const reused = new Set();
      const moves = [];
      for (const entry of normalized) {
        let existing = previousPaths.get(pathKey(entry.fullPath));
        if (!existing && entry.fileKey && incomingKeys.get(entry.fileKey) === 1) {
          const matches = identities.get(entry.fileKey) || [];
          if (matches.length === 1 && !reused.has(matches[0].id) && !seen.has(matches[0].path_key)
            && !fs.existsSync(matches[0].full_path)) existing = matches[0];
        }
        if (existing) {
          reused.add(existing.id);
          if (pathKey(existing.full_path) !== pathKey(entry.fullPath) || existing.full_path !== entry.fullPath) {
            moves.push({ source: existing.full_path, destination: entry.fullPath, name: entry.name });
          }
          writeDescriptor(existing.id, entry);
          applyPending(existing.id, entry.fullPath);
        } else {
          const id = randomUUID();
          db.prepare(`INSERT INTO assets(id, full_path, path_key, root_path, root_key, name, extension, size, modified,
            media_type, area, online, file_key, context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
            .run(id, entry.fullPath, pathKey(entry.fullPath), entry.rootPath, pathKey(entry.rootPath), entry.name,
              entry.extension, entry.size, entry.modified, entry.mediaType, entry.area, entry.fileKey, JSON.stringify(entry.context));
          initialCategories(entry, id);
          applyPending(id, entry.fullPath);
        }
      }
      remapProjectLinks(moves);
      return readSnapshot();
    });
  }
  function updateAssets(ids, patch) {
    ids = idsValue(ids);
    if (!record(patch) || Object.keys(patch).some((key) => !["displayName", "note", "favorite", "tags", "area"].includes(key))) throw new Error("素材修改字段无效");
    const values = {};
    if (own(patch, "displayName")) values.display_name = stringValue(patch.displayName, "显示名称");
    if (own(patch, "note")) values.note = stringValue(patch.note, "备注");
    if (own(patch, "favorite")) {
      if (typeof patch.favorite !== "boolean") throw new Error("收藏状态无效");
      values.favorite = Number(patch.favorite);
    }
    if (own(patch, "tags")) values.tags_json = JSON.stringify(tagsValue(patch.tags));
    if (own(patch, "area")) values.area = requiredText(patch.area, "素材区域");
    return transaction(() => {
      ids.forEach(rawAsset);
      for (const id of ids) {
        for (const [column, value] of Object.entries(values)) db.prepare(`UPDATE assets SET ${column} = ? WHERE id = ?`).run(value, id);
        if (own(values, "area")) db.prepare("DELETE FROM asset_categories WHERE asset_id = ? AND category_id IN (SELECT id FROM categories WHERE area != ?)").run(id, values.area);
      }
      return readSnapshot();
    });
  }
  function createCategory(input) {
    if (!record(input)) throw new Error("分类无效");
    return transaction(() => createCategoryInternal(input));
  }
  function updateCategory(id, patch) {
    if (!record(patch) || Object.keys(patch).some((key) => !["name", "parentId"].includes(key))) throw new Error("分类修改字段无效");
    return transaction(() => {
      const existing = rawCategory(id);
      const name = own(patch, "name") ? requiredText(patch.name, "分类名") : existing.name;
      const parentId = own(patch, "parentId") ? patch.parentId : existing.parent_id;
      if (parentId !== null) {
        let current = rawCategory(parentId);
        const seen = new Set([id]);
        while (current) {
          if (current.area !== existing.area) throw new Error("父分类必须属于同一素材区域");
          if (seen.has(current.id)) throw new Error("分类不能移动到自身或子分类中");
          seen.add(current.id);
          current = current.parent_id === null ? null : rawCategory(current.parent_id);
        }
      }
      db.prepare("UPDATE categories SET name = ?, parent_id = ? WHERE id = ?").run(name, parentId, id);
      return { id, area: existing.area, name, parentId };
    });
  }
  function deleteCategory(id) {
    return transaction(() => {
      rawCategory(id);
      db.prepare("DELETE FROM categories WHERE id = ?").run(id);
      return readSnapshot();
    });
  }
  function assignCategories(ids, categoryIds, { mode = "add" } = {}) {
    ids = idsValue(ids);
    categoryIds = idsValue(categoryIds, "分类");
    if (!["add", "remove", "replace"].includes(mode)) throw new Error("分类操作无效");
    return transaction(() => {
      const assets = ids.map(rawAsset);
      const categories = categoryIds.map(rawCategory);
      if (mode !== "remove" && assets.some((asset) => categories.some((category) => category.area !== asset.area))) throw new Error("只能选择同一素材区域的分类");
      for (const asset of assets) {
        if (mode === "replace") db.prepare("DELETE FROM asset_categories WHERE asset_id = ?").run(asset.id);
        for (const category of categories) {
          db.prepare(mode === "remove" ? "DELETE FROM asset_categories WHERE asset_id = ? AND category_id = ?"
            : "INSERT OR IGNORE INTO asset_categories(asset_id, category_id) VALUES (?, ?)").run(asset.id, category.id);
        }
      }
      return readSnapshot();
    });
  }
  function migrateLegacy(payload) {
    if (!record(payload)) throw new Error("旧版资料无效");
    const legacy = jsonValue(payload);
    return transaction(() => {
      if (getSetting("legacyMigrationVersion") === VERSION) return readSnapshot();
      writeSetting("legacyBackup", legacy);
      for (const key of ["projectLinks", "categoryLabels", "categoryOrders", "rootPath", "linkedProjects"]) {
        if (own(legacy, key) && getSetting(key) === undefined) writeSetting(key, legacy[key]);
      }
      const pending = new Map();
      for (const fullPath of Array.isArray(legacy.favorites) ? legacy.favorites : []) {
        if (typeof fullPath !== "string" || !path.isAbsolute(fullPath) || fullPath.includes("\0")) continue;
        pending.set(pathKey(fullPath), { fullPath: path.resolve(fullPath), metadata: { favorite: true } });
      }
      for (const [fullPath, note] of record(legacy.notes) ? Object.entries(legacy.notes) : []) {
        if (!path.isAbsolute(fullPath) || fullPath.includes("\0") || typeof note !== "string") continue;
        const entry = pending.get(pathKey(fullPath)) || { fullPath: path.resolve(fullPath), metadata: {} };
        entry.metadata.note = note;
        pending.set(pathKey(fullPath), entry);
      }
      for (const [key, entry] of pending) {
        db.prepare("INSERT OR IGNORE INTO pending_legacy(path_key, full_path, metadata_json) VALUES (?, ?, ?)").run(key, entry.fullPath, JSON.stringify(entry.metadata));
        const asset = db.prepare("SELECT id FROM assets WHERE path_key = ?").get(key);
        if (asset) applyPending(asset.id, entry.fullPath);
      }
      // Reusable category aliases used to be display-only and must survive the one-time transition.
      if (record(legacy.categoryLabels)) for (const [key, alias] of Object.entries(legacy.categoryLabels)) {
        if (typeof alias !== "string" || !alias.trim()) continue;
        let parts;
        try { parts = JSON.parse(key); } catch { continue; }
        if (!Array.isArray(parts) || parts.length !== 4 || parts[1] !== "" || parts[2] !== "") continue;
        const category = db.prepare("SELECT * FROM categories WHERE area = ? AND parent_id IS NULL AND name = ?").get(parts[0], parts[3]);
        if (!category) continue;
        const conflict = db.prepare("SELECT id FROM categories WHERE area = ? AND parent_id IS NULL AND name = ?").get(parts[0], alias.trim());
        if (!conflict) db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(alias.trim(), category.id);
      }
      writeSetting("legacyMigrationVersion", VERSION);
      return readSnapshot();
    });
  }
  function normalizeMoves(moves) {
    if (!Array.isArray(moves)) throw new Error("文件移动记录无效");
    const sources = new Set();
    const destinations = new Set();
    return moves.map((move) => {
      if (!record(move)) throw new Error("文件移动记录无效");
      const source = absolutePath(move.source);
      const destination = absolutePath(move.destination);
      if (sources.has(pathKey(source)) || destinations.has(pathKey(destination))) throw new Error("文件移动记录包含重复路径");
      sources.add(pathKey(source));
      destinations.add(pathKey(destination));
      return { ...move, source, destination };
    });
  }
  function remapPaths(moves) {
    const changes = normalizeMoves(moves);
    return transaction(() => {
      const rows = changes.map((move) => ({ move, row: db.prepare("SELECT * FROM assets WHERE path_key = ?").get(pathKey(move.source)) }));
      const movedIds = new Set(rows.filter(({ row }) => row).map(({ row }) => row.id));
      for (const { move, row } of rows) {
        const target = db.prepare("SELECT id FROM assets WHERE path_key = ?").get(pathKey(move.destination));
        if (row && target && target.id !== row.id && !movedIds.has(target.id)) throw new Error("目标路径已经连接到其他素材");
      }
      // Temporary unique keys permit atomic swap/chain remaps without dropping metadata.
      for (const { row } of rows) if (row) db.prepare("UPDATE assets SET path_key = ? WHERE id = ?").run(`moving:${randomUUID()}`, row.id);
      for (const { move, row } of rows) if (row) {
        const context = JSON.parse(row.context_json);
        if (context.relativePath) context.relativePath = path.relative(move.rootPath || row.root_path, move.destination).split(path.sep).join("/");
        if (context.previewUrl) context.previewUrl = null;
        const entry = descriptor({
          ...move, fullPath: move.destination, rootPath: move.rootPath || row.root_path,
          name: move.name || path.basename(move.destination), size: row.size, modified: row.modified,
          fileKey: row.file_key, context,
        });
        writeDescriptor(row.id, entry);
      }
      remapProjectLinks(changes);
      return readSnapshot();
    });
  }
  function markDeleted(paths) {
    if (!Array.isArray(paths)) throw new Error("文件路径必须为列表");
    const keys = paths.map((filePath) => pathKey(filePath));
    return transaction(() => {
      for (const key of keys) db.prepare("UPDATE assets SET online = 0 WHERE path_key = ?").run(key);
      return readSnapshot();
    });
  }
  function forgetPaths(paths) {
    if (!Array.isArray(paths)) throw new Error("文件路径必须为列表");
    const keys = new Set(paths.map((filePath) => pathKey(filePath)));
    return transaction(() => {
      for (const key of keys) {
        // Foreign keys cascade only this asset's category memberships. Empty
        // category definitions remain available for the user's future files.
        db.prepare("DELETE FROM assets WHERE path_key = ?").run(key);
        db.prepare("DELETE FROM pending_legacy WHERE path_key = ?").run(key);
      }
      const links = getSetting("projectLinks");
      if (record(links) && Array.isArray(links.groups)) {
        let changed = false;
        for (const group of links.groups) {
          if (!record(group) || !Array.isArray(group.members)) continue;
          const previousLength = group.members.length;
          group.members = group.members.filter(member => !record(member) || typeof member.id !== "string"
            || !path.isAbsolute(member.id) || !keys.has(pathKey(member.id)));
          if (group.members.length !== previousLength) {
            group.updatedAt = Math.max(Number(group.createdAt) || 0, Date.now());
            changed = true;
          }
        }
        if (changed) writeSetting("projectLinks", links);
      }
      const sources = getSetting("referenceRoots");
      if (Array.isArray(sources)) {
        const retained = sources.filter(source => {
          if (!record(source) || source.kind !== "files") return true;
          source.paths = (Array.isArray(source.paths) ? source.paths : []).filter(filePath => typeof filePath !== "string"
            || !path.isAbsolute(filePath) || !keys.has(pathKey(filePath)));
          if (record(source.fileKeys)) for (const filePath of Object.keys(source.fileKeys)) {
            if (path.isAbsolute(filePath) && keys.has(pathKey(filePath))) delete source.fileKeys[filePath];
          }
          return source.paths.length > 0;
        });
        writeSetting("referenceRoots", retained);
      }
      return readSnapshot();
    });
  }
  function relink(id, input) {
    return transaction(() => {
      const existing = rawAsset(id);
      const entry = descriptor(input, existing.root_path);
      const conflict = db.prepare("SELECT id FROM assets WHERE path_key = ?").get(pathKey(entry.fullPath));
      if (conflict && conflict.id !== id) throw new Error("该文件已经连接到其他素材");
      writeDescriptor(id, entry);
      remapProjectLinks([{ source: existing.full_path, destination: entry.fullPath, name: entry.name }]);
      applyPending(id, entry.fullPath);
      return readSnapshot();
    });
  }
  function backup(filePath) {
    ensureOpen();
    const destination = absolutePath(filePath, "备份路径");
    if (pathKey(destination) === pathKey(databasePath) || pathKey(destination).startsWith(`${pathKey(databasePath)}-`)
      || db.prepare("SELECT id FROM assets WHERE path_key = ?").get(pathKey(destination))) throw new Error("备份不能覆盖资料库或原始素材");
    const data = readSnapshot(true);
    data.pendingLegacy = db.prepare("SELECT * FROM pending_legacy ORDER BY path_key").all().map((row) => ({ fullPath: row.full_path, metadata: JSON.parse(row.metadata_json) }));
    data.categorySeeds = db.prepare("SELECT * FROM category_seeds ORDER BY area, source_path").all()
      .map((row) => ({ area: row.area, categoryPath: JSON.parse(row.source_path), categoryId: row.category_id }));
    const payload = validateCatalogBackup({ format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), data });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      const fd = fs.openSync(temporary, "wx");
      try { fs.writeFileSync(fd, JSON.stringify(payload, null, 2), "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, destination);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { path: destination, assetCount: data.assets.length, categoryCount: data.categories.length };
  }
  function restore(filePath) {
    ensureOpen();
    const payload = validateCatalogBackup(fs.readFileSync(absolutePath(filePath, "备份路径"), "utf8"));
    return transaction(() => {
      db.exec("DELETE FROM asset_categories; DELETE FROM category_seeds; DELETE FROM categories; DELETE FROM assets; DELETE FROM settings; DELETE FROM pending_legacy;");
      const pending = [...payload.data.categories];
      const added = new Set();
      while (pending.length) {
        const index = pending.findIndex((category) => category.parentId === null || added.has(category.parentId));
        if (index === -1) throw new Error("备份分类层级无效");
        const [category] = pending.splice(index, 1);
        createCategoryInternal(category, category.id);
        added.add(category.id);
      }
      for (const asset of payload.data.assets) {
        const entry = descriptor(asset);
        db.prepare(`INSERT INTO assets(id, full_path, path_key, root_path, root_key, name, extension, size, modified,
          display_name, note, favorite, tags_json, media_type, area, online, file_key, context_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(asset.id, entry.fullPath, pathKey(entry.fullPath), entry.rootPath, pathKey(entry.rootPath), entry.name,
            entry.extension, entry.size, entry.modified, asset.displayName, asset.note, Number(asset.favorite), JSON.stringify(asset.tags),
            entry.mediaType, entry.area, Number(asset.online), entry.fileKey, JSON.stringify(entry.context));
        for (const categoryId of asset.categoryIds) db.prepare("INSERT INTO asset_categories(asset_id, category_id) VALUES (?, ?)").run(asset.id, categoryId);
      }
      for (const [key, value] of Object.entries(payload.data.settings)) writeSetting(key, value);
      for (const entry of payload.data.pendingLegacy) db.prepare("INSERT INTO pending_legacy(path_key, full_path, metadata_json) VALUES (?, ?, ?)")
        .run(pathKey(entry.fullPath), entry.fullPath, JSON.stringify(entry.metadata));
      for (const seed of payload.data.categorySeeds) db.prepare("INSERT INTO category_seeds(area, source_path, category_id) VALUES (?, ?, ?)")
        .run(seed.area, JSON.stringify(seed.categoryPath), seed.categoryId);
      return readSnapshot();
    });
  }
  return {
    snapshot: () => readSnapshot(), reconcile, updateAssets, createCategory, updateCategory, deleteCategory, createMaterialArea,
    assignCategories, migrateLegacy, getSetting,
    setSetting: (key, value) => transaction(() => writeSetting(key, value)), backup, restore, remapPaths,
    markDeleted, forgetPaths, relink,
    close: () => { if (!closed) { db.close(); closed = true; } },
  };
}

module.exports = { createCatalog, validateCatalogBackup };
