const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("yuDesktop", {
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
  createLibraryStructure: (rootPath) => ipcRenderer.invoke("library:create-structure", rootPath),
  prepareAssetRoot: () => ipcRenderer.invoke("library:prepare-asset-root"),
  importFiles: (rootPath) => ipcRenderer.invoke("library:import-files", rootPath),
  importDroppedFiles: (rootPath, paths) => ipcRenderer.invoke("library:import-dropped-files", rootPath, paths),
  importFilesToArea: (rootPath, paths, area, category) => ipcRenderer.invoke("library:import-files-to-area", rootPath, paths, area, category),
  pickFilesToArea: (rootPath, area, category) => ipcRenderer.invoke("library:pick-files-to-area", rootPath, area, category),
  organizeFile: (rootPath, filePath, target) => ipcRenderer.invoke("library:organize-file", rootPath, filePath, target),
  organizeFiles: (rootPath, filePaths, target) => ipcRenderer.invoke("library:organize-files", rootPath, filePaths, target),
  trashFiles: (rootPath, filePaths) => ipcRenderer.invoke("library:trash-files", rootPath, filePaths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  startFileDrag: (paths) => ipcRenderer.send("library:start-file-drag", paths),
  openPath: (filePath) => ipcRenderer.invoke("system:open-path", filePath),
  revealPath: (filePath) => ipcRenderer.invoke("system:reveal-path", filePath),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  platform: process.platform,
});
