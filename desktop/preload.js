const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("daitecDesktop", {
  getConfig: () => ipcRenderer.invoke("daitec:getConfig"),
  save: (payload) => ipcRenderer.invoke("daitec:save", payload),
  exitKiosk: (pin) => ipcRenderer.invoke("daitec:exitKiosk", pin),
});
