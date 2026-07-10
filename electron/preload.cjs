const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bigbrainDesktop', {
  state: () => ipcRenderer.invoke('desktop:state'),
  createBrain: (input) => ipcRenderer.invoke('desktop:create-brain', input),
  activate: (id) => ipcRenderer.invoke('desktop:activate', id),
  rename: (id, name) => ipcRenderer.invoke('desktop:rename', id, name),
  restart: (id) => ipcRenderer.invoke('desktop:restart', id),
  instructions: (id) => ipcRenderer.invoke('desktop:instructions', id),
  setDefault: (id) => ipcRenderer.invoke('desktop:set-default', id),
  reveal: (path) => ipcRenderer.invoke('desktop:reveal', path),
});
