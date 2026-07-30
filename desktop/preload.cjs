const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("portdeckDesktop", Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
}));
