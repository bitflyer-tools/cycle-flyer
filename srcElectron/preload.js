const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bitFlyerCredentials', {
  hasCredentials: () => ipcRenderer.invoke('credentials:has-credentials'),
  migrate: (pair) => ipcRenderer.invoke('credentials:migrate', pair),
  save: (pair) => ipcRenderer.invoke('credentials:save', pair),
  signRest: (method, path, body) => ipcRenderer.invoke('credentials:sign-rest', method, path, body),
  signRealtime: () => ipcRenderer.invoke('credentials:sign-realtime'),
});
