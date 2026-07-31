const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("portdeckDesktop", Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
  getSettings: () => ipcRenderer.invoke("desktop:get-settings"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("desktop:set-open-at-login", enabled),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("desktop:update-status", listener);
    return () => ipcRenderer.removeListener("desktop:update-status", listener);
  },
  onSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("desktop:settings-changed", listener);
    return () => ipcRenderer.removeListener("desktop:settings-changed", listener);
  },
}));
