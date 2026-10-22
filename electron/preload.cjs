const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("yuDesktop", {
  catalogSnapshot: () => ipcRenderer.invoke("catalog:snapshot"),
  catalogReconcile: (entries, options) => ipcRenderer.invoke("catalog:reconcile", entries, options),
  catalogUpdateAssets: (ids, patch) => ipcRenderer.invoke("catalog:update-assets", ids, patch),
  catalogCreateCategory: (input) => ipcRenderer.invoke("catalog:create-category", input),
  catalogCreateMaterialArea: (name) => ipcRenderer.invoke("catalog:create-material-area", name),
  catalogUpdateCategory: (id, patch) => ipcRenderer.invoke("catalog:update-category", id, patch),
  catalogDeleteCategory: (id) => ipcRenderer.invoke("catalog:delete-category", id),
  catalogAssignCategories: (ids, categories, options) => ipcRenderer.invoke("catalog:assign-categories", ids, categories, options),
  catalogMigrateLegacy: (payload) => ipcRenderer.invoke("catalog:migrate-legacy", payload),
  catalogSetSetting: (key, value) => ipcRenderer.invoke("catalog:set-setting", key, value),
  catalogBackup: () => ipcRenderer.invoke("catalog:backup"),
  catalogRestore: () => ipcRenderer.invoke("catalog:restore"),
  catalogRelink: (id) => ipcRenderer.invoke("catalog:relink", id),
  catalogLinkFiles: (area) => ipcRenderer.invoke("catalog:link-files", area),
  catalogLinkFolder: (area) => ipcRenderer.invoke("catalog:link-folder", area),
  catalogRefreshReferences: () => ipcRenderer.invoke("catalog:refresh-references"),
  catalogApplyReferenceChange: (change) => ipcRenderer.invoke("catalog:apply-reference-change", change),
  catalogStorageInfo: () => ipcRenderer.invoke("catalog:storage-info"),
  catalogChooseStorage: () => ipcRenderer.invoke("catalog:choose-storage"),
  catalogClearCache: () => ipcRenderer.invoke("catalog:clear-cache"),
  catalogSetCacheLimit: (mb) => ipcRenderer.invoke("catalog:set-cache-limit", mb),
  renameFile: (rootPath, filePath, name) => ipcRenderer.invoke("library:rename-file", rootPath, filePath, name),
  pickLibraryFolder: () => ipcRenderer.invoke("library:pick-folder"),
  pickProjectFolder: () => ipcRenderer.invoke("library:pick-project-folder"),
  scanLibrary: (rootPath) => ipcRenderer.invoke("library:scan", rootPath),
  retainWatchers: (roots) => ipcRenderer.invoke("library:retain-watchers", roots),
  onLibraryChanged: (callback) => {
    const listener = (_event, change) => callback(change);
    ipcRenderer.on("library:changed", listener);
    return () => ipcRenderer.removeListener("library:changed", listener);
  },
  onWatchError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("library:watch-error", listener);
    return () => ipcRenderer.removeListener("library:watch-error", listener);
  },
  describePaths: (paths) => ipcRenderer.invoke("library:describe-paths", paths),
  describeDrop: (payload) => ipcRenderer.invoke("library:describe-drop", payload),
  createLibraryStructure: (rootPath) => ipcRenderer.invoke("library:create-structure", rootPath),
  prepareAssetRoot: () => ipcRenderer.invoke("library:prepare-asset-root"),
  importFiles: (rootPath) => ipcRenderer.invoke("library:import-files", rootPath),
  importDroppedFiles: (rootPath, paths) => ipcRenderer.invoke("library:import-dropped-files", rootPath, paths),
  importFilesToArea: (rootPath, paths, area, category) => ipcRenderer.invoke("library:import-files-to-area", rootPath, paths, area, category),
  moveDroppedFiles: (rootPath, paths, directory) => ipcRenderer.invoke("library:move-dropped-files", rootPath, paths, directory),
  pickFilesToArea: (rootPath, area, category) => ipcRenderer.invoke("library:pick-files-to-area", rootPath, area, category),
  organizeFile: (rootPath, filePath, target) => ipcRenderer.invoke("library:organize-file", rootPath, filePath, target),
  organizeFiles: (rootPath, filePaths, target) => ipcRenderer.invoke("library:organize-files", rootPath, filePaths, target),
  trashFiles: (rootPath, filePaths) => ipcRenderer.invoke("library:trash-files", rootPath, filePaths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  startFileDrag: (paths) => ipcRenderer.send("library:start-file-drag", paths),
  onFileDragEnded: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("library:file-drag-ended", listener);
    return () => ipcRenderer.removeListener("library:file-drag-ended", listener);
  },
  openPath: (filePath) => ipcRenderer.invoke("system:open-path", filePath),
  revealPath: (filePath) => ipcRenderer.invoke("system:reveal-path", filePath),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  platform: process.platform,
});
