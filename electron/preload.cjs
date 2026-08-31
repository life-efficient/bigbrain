const { contextBridge, ipcRenderer } = require('electron');

const isDesktopShell = process.isMainFrame
  && location.protocol === 'file:'
  && location.pathname.endsWith('/electron/desktop.html');
const isLoadFailurePage = process.isMainFrame
  && location.protocol === 'file:'
  && location.pathname.endsWith('/electron/load-failure.html');

if (isDesktopShell) {
  contextBridge.exposeInMainWorld('bigbrainDesktop', {
    state: () => ipcRenderer.invoke('desktop:state'),
    discoverBrains: () => ipcRenderer.invoke('desktop:discover-brains'),
    apiKeyOptions: (input) => ipcRenderer.invoke('desktop:api-key-options', input),
    createBrain: (input) => ipcRenderer.invoke('desktop:create-brain', input),
    connectService: (input) => ipcRenderer.invoke('desktop:connect-service', input),
    openBrain: (id) => ipcRenderer.invoke('desktop:open-brain', id),
    setDashboardVisible: (visible) => ipcRenderer.invoke('desktop:set-dashboard-visible', visible),
    onDashboardVisibility: (listener) => {
      const handler = (_event, visible) => listener(Boolean(visible));
      ipcRenderer.on('desktop:dashboard-visibility', handler);
      return () => ipcRenderer.removeListener('desktop:dashboard-visibility', handler);
    },
    chooseExistingBrain: () => ipcRenderer.invoke('desktop:choose-existing-brain'),
    chooseBrainHome: () => ipcRenderer.invoke('desktop:choose-brain-home'),
    activate: (id) => ipcRenderer.invoke('desktop:activate', id),
    rename: (id, name) => ipcRenderer.invoke('desktop:rename', id, name),
    restart: (id) => ipcRenderer.invoke('desktop:restart', id),
    instructions: (id) => ipcRenderer.invoke('desktop:instructions', id),
    setDefault: (id) => ipcRenderer.invoke('desktop:set-default', id),
    reveal: (targetPath) => ipcRenderer.invoke('desktop:reveal', targetPath),
    eventState: () => ipcRenderer.invoke('desktop:event-state'),
    eventListeners: () => ipcRenderer.invoke('desktop:event-listeners'),
    upsertEventListener: (value) => ipcRenderer.invoke('desktop:event-upsert-listener', value),
    upsertEventSubscription: (value) => ipcRenderer.invoke('desktop:event-upsert-subscription', value),
    setEventListenerState: (listenerId, action) => ipcRenderer.invoke('desktop:event-listener-state', listenerId, action),
    eventInbox: (options) => ipcRenderer.invoke('desktop:event-inbox', options),
    retryEvent: (deliveryId) => ipcRenderer.invoke('desktop:event-retry', deliveryId),
    discardEvent: (deliveryId, reason) => ipcRenderer.invoke('desktop:event-discard', deliveryId, reason),
    quarantineEvent: (deliveryId, reason) => ipcRenderer.invoke('desktop:event-quarantine', deliveryId, reason),
    updateState: () => ipcRenderer.invoke('desktop:update-state'),
    checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
    restartToUpdate: () => ipcRenderer.invoke('desktop:restart-to-update'),
    localServiceUpdateState: () => ipcRenderer.invoke('desktop:local-service-update-state'),
    onUpdateState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('desktop:update-state', handler);
      return () => ipcRenderer.removeListener('desktop:update-state', handler);
    },
    onLocalServiceUpdateState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('desktop:local-service-update-state', handler);
      return () => ipcRenderer.removeListener('desktop:local-service-update-state', handler);
    },
  });
}

if (isLoadFailurePage) {
  contextBridge.exposeInMainWorld('bigbrainLoadFailure', {
    state: () => ipcRenderer.invoke('desktop:load-failure-state'),
    reload: () => ipcRenderer.invoke('desktop:reload-dashboard'),
  });
}
