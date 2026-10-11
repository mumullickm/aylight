const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumen', {
  send: (channel, arg) => ipcRenderer.send(channel, arg),
  complete: (q) => ipcRenderer.invoke('complete', q),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data)),
});
