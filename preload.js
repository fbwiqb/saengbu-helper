const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  onAvailable: (cb) => ipcRenderer.on('upd:available', (_e, d) => cb(d)),
  onProgress: (cb) => ipcRenderer.on('upd:progress', (_e, d) => cb(d)),
  onDownloaded: (cb) => ipcRenderer.on('upd:downloaded', (_e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on('upd:error', (_e, d) => cb(d)),
  restart: () => ipcRenderer.send('upd:restart'),
  check: () => ipcRenderer.send('upd:check'),
});
