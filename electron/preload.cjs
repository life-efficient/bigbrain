const { contextBridge, ipcRenderer } = require('electron');

const isDesktopShell = process.isMainFrame
  && location.protocol === 'file:'
  && location.pathname.endsWith('/electron/desktop.html');

if (isDesktopShell) {
  contextBridge.exposeInMainWorld('bigbrainDesktop', {
    state: () => ipcRenderer.invoke('desktop:state'),
    apiKeyOptions: (input) => ipcRenderer.invoke('desktop:api-key-options', input),
    createBrain: (input) => ipcRenderer.invoke('desktop:create-brain', input),
    connectService: (input) => ipcRenderer.invoke('desktop:connect-service', input),
    openBrain: (id) => ipcRenderer.invoke('desktop:open-brain', id),
    chooseExistingBrain: () => ipcRenderer.invoke('desktop:choose-existing-brain'),
    activate: (id) => ipcRenderer.invoke('desktop:activate', id),
    rename: (id, name) => ipcRenderer.invoke('desktop:rename', id, name),
    restart: (id) => ipcRenderer.invoke('desktop:restart', id),
    instructions: (id) => ipcRenderer.invoke('desktop:instructions', id),
    setDefault: (id) => ipcRenderer.invoke('desktop:set-default', id),
    reveal: (targetPath) => ipcRenderer.invoke('desktop:reveal', targetPath),
    updateState: () => ipcRenderer.invoke('desktop:update-state'),
    checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
    restartToUpdate: () => ipcRenderer.invoke('desktop:restart-to-update'),
    onUpdateState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('desktop:update-state', handler);
      return () => ipcRenderer.removeListener('desktop:update-state', handler);
    },
  });
}
