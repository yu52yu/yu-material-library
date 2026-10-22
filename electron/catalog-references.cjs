const fs = require('node:fs');
const path = require('node:path');

const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

function referenceEntry(entry, area, context = {}) {
  const project = context.project || '';
  const mode = context.mode || '';
  const category = context.category || '未分类';
  return { ...entry, area, project, mode, category,
    ...(area === '项目素材' ? { categoryPath: [] } : {}),
    context: { ...context, area, project, mode, category, relativePath: entry.relativePath, sourceRoot: entry.rootPath, isImage: entry.isImage } };
}

function validateReferenceLinks(catalog, entries, area) {
  const indexed = new Map(catalog.snapshot().assets.map(asset => [key(asset.fullPath), asset]));
  for (const entry of entries) {
    const existing = indexed.get(key(entry.fullPath));
    if (existing && existing.area !== area) throw new Error(`“${existing.displayName || existing.name}”已属于${existing.area}，请在原区域使用或建立项目关联；原文件和整理记录未改变`);
  }
}

// Apply only the subtree supplied by the native notification. A source made
// from individual files must never admit unrelated files in the same directory.
function applyReferenceChange(catalog, change) {
  const roots = catalog.getSetting('referenceRoots') || [];
  if (!Array.isArray(roots) || !change?.rootPath || !Array.isArray(change.files)) return catalog.snapshot();
  let changed = false;
  for (const source of roots) {
    if (!source.path || key(source.path) !== key(change.rootPath)) continue;
    let entries = change.files;
    if (source.kind === 'files') {
      const paths = new Set((source.paths || []).map(key));
      const byIdentity = new Map(Object.entries(source.fileKeys || {}).map(([filePath, fileKey]) => [fileKey, filePath]));
      entries = entries.filter(entry => {
        if (paths.has(key(entry.fullPath))) return true;
        const oldPath = byIdentity.get(entry.fileKey);
        return oldPath && !fs.existsSync(oldPath);
      });
    } else if (source.kind !== 'folder') continue;
    const previous = catalog.snapshot();
    const snapshot = catalog.reconcile(entries.map(entry => referenceEntry(entry, source.area, source.context)), {
      rootPath: source.path, complete: false, replacedPath: change.replacedPath,
    });
    if (source.kind === 'files') {
      const after = new Map(snapshot.assets.map(asset => [asset.id, asset]));
      const moves = new Map(previous.assets.filter(asset => after.get(asset.id)?.fullPath !== asset.fullPath)
        .map(asset => [key(asset.fullPath), after.get(asset.id)?.fullPath]).filter(([, value]) => value));
      source.paths = [...new Set((source.paths || []).map(filePath => moves.get(key(filePath)) || filePath))];
      const fileKeys = {};
      for (const [filePath, fileKey] of Object.entries(source.fileKeys || {})) fileKeys[moves.get(key(filePath)) || filePath] = fileKey;
      for (const entry of entries) fileKeys[entry.fullPath] = entry.fileKey;
      source.fileKeys = fileKeys;
      changed = true;
    }
  }
  if (changed) catalog.setSetting('referenceRoots', roots);
  return catalog.snapshot();
}

module.exports = { applyReferenceChange, referenceEntry, validateReferenceLinks };
