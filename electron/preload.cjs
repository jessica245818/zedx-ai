const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zedxDesktop", {
  platform: process.platform,
  hostinger: (payload) => ipcRenderer.invoke("zedx:hostinger", payload),
  openExternal: (url) => ipcRenderer.invoke("zedx:open-external", url),
});
