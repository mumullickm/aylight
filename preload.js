const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aylight', {
  send: (channel, arg) => ipcRenderer.send(channel, arg),
  complete: (q) => ipcRenderer.invoke('complete', q),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data)),
});
