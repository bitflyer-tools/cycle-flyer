const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bitFlyerCredentials', {
  migrate: (pair) => ipcRenderer.invoke('credentials:migrate', pair),
  save: (pair) => ipcRenderer.invoke('credentials:save', pair),
  signRest: (method, path, body) => ipcRenderer.invoke('credentials:sign-rest', method, path, body),
  signRealtime: () => ipcRenderer.invoke('credentials:sign-realtime'),
});
