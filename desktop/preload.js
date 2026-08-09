const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("daitecDesktop", {
  getServerUrl: () => ipcRenderer.invoke("daitec:getServerUrl"),
  setServerUrl: (url) => ipcRenderer.invoke("daitec:setServerUrl", url),
});
