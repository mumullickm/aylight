const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aylight', {
  send: (channel, arg) => ipcRenderer.send(channel, arg),
  complete: (q) => ipcRenderer.invoke('complete', q),
  jump: (q) => ipcRenderer.invoke('jump', q),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data)),
});
