const { app, BrowserWindow, Menu, WebContentsView, dialog, shell, ipcMain } = require("electron");
const net = require("net");
const path = require("path");
const { pathToFileURL } = require("url");
const { dashboardPartition, dashboardViewBounds, isAllowedDashboardNavigation } = require("./lib/dashboard-view-policy.cjs");
const { waitForDashboardReady } = require("./lib/dashboard-readiness.cjs");
const { recordAppError } = require("./lib/local-error-log.cjs");

const LOCAL_HOST = "127.0.0.1";
const DEFAULT_WINDOW_SIZE = { width: 1079, height: 945 };
const DESKTOP_CHROME_HEIGHT = 0;
const DEV_BUILD = process.env.BIGBRAIN_DASHBOARD_DEV === "1";
const APP_DISPLAY_NAME = DEV_BUILD ? "BigBrain Dev" : "BigBrain";
const APP_ICON_PATH = path.join(__dirname, "assets", DEV_BUILD ? "desktop-dev-icon.png" : "desktop-icon.png");
const LOAD_FAILURE_PAGE_PATH = path.join(__dirname, "load-failure.html");
const REMOTE_DASHBOARD_URL_ENV = "BIGBRAIN_DASHBOARD_URL";

// Keep the live developer app independent from the installed release app so
// both can hold a single-instance lock and run together on the developer Mac.
if (DEV_BUILD) {
  app.setPath("userData", path.join(app.getPath("appData"), "BigBrain Dev"));
}

let mainWindow = null;
let dashboardView = null;
let dashboardViewBrainId = null;
let activeDashboardOrigin = null;
let dashboardServer = null;
let localPageLinkServer = null;
let dashboardUrl = null;
let dashboardOrigin = null;
let remoteDashboardMode = false;
let pendingLoadFailureMessage = "The dashboard did not finish loading.";
let loadFailureActive = false;
let desktopController = null;
let eventRuntimeManager = null;
let desktopUpdater = null;
let updateRestartCoordinator = null;
let managedServiceReconciliationPromise = Promise.resolve();
let promptedUpdateVersion = null;
let localServiceUpdateState = { phase: "idle", message: "Local MCP services are checked after launch." };
const connectedDashboardOrigins = new Set();

const singleInstanceLock = app.requestSingleInstanceLock();

process.on("uncaughtException", (error) => {
  try { recordAppError(app, "uncaught-exception", error); } catch { /* preserve process failure */ }
  throw error;
});
process.on("unhandledRejection", (reason) => {
  try { recordAppError(app, "unhandled-rejection", reason); } catch { /* diagnostics are best effort */ }
});

app.setName(APP_DISPLAY_NAME);

if (!singleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    try {
      if (process.platform === "darwin" && app.dock) {
        app.dock.setIcon(APP_ICON_PATH);
      }
      const remoteDashboardUrl = resolveRemoteDashboardUrl();
      if (remoteDashboardUrl) {
        dashboardUrl = await startDashboardRuntime();
      } else {
        const { DesktopController } = await importModule("electron/lib/desktop-controller.mjs");
        desktopController = new DesktopController({ appPath: app.getAppPath() });
        const desktopState = rememberConnectedDashboardOrigins(await desktopController.state());
        const { EventRuntimeManager } = await importModule("electron/lib/event-runtime-manager.mjs");
        eventRuntimeManager = new EventRuntimeManager({
          appPath: app.getAppPath(),
        });
        await eventRuntimeManager.start({ brains: desktopState.brains });
        const { startLocalPageLinkServer } = await importModule("electron/lib/local-page-link-server.mjs");
        localPageLinkServer = await startLocalPageLinkServer({
          resolveBrain: (brainId) => desktopController.resolveCanonicalBrain(brainId),
          openPage: openCanonicalPage,
        });
        registerDesktopIpc();
        dashboardUrl = pathToFileURL(path.join(__dirname, "desktop.html")).href;
        dashboardOrigin = "null";
      }
      initializeDesktopUpdater();
      await initializeUpdateRestartCoordinator();
      registerUpdateIpc();
      createAppMenu();
      createMainWindow({ select: process.argv.includes("--select") });
      managedServiceReconciliationPromise = coordinateManagedServicesAfterLaunch();
      desktopUpdater.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAppError(app, "desktop-startup-failure", error);
      dialog.showErrorBox("BigBrain failed to start", message);
      app.quit();
    }
  });

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && dashboardUrl) {
      createMainWindow();
    }
  });

  app.on("before-quit", async () => {
    if (dashboardServer) {
      await new Promise((resolve) => dashboardServer.close(resolve));
      dashboardServer = null;
    }
    if (localPageLinkServer) {
      await new Promise((resolve) => localPageLinkServer.close(resolve));
      localPageLinkServer = null;
    }
    await eventRuntimeManager?.stop();
    eventRuntimeManager = null;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

async function startDashboardRuntime() {
  const remoteDashboardUrl = resolveRemoteDashboardUrl();
  if (remoteDashboardUrl) {
    dashboardOrigin = new URL(remoteDashboardUrl).origin;
    remoteDashboardMode = true;
    return remoteDashboardUrl;
  }

  const [{ resolveBrainHome, loadConfig }, { startDashboard }] = await Promise.all([
    importModule("src/bigbrain/config.js"),
    importModule("src/bigbrain/dashboard.js"),
  ]);

  const brainHome = await resolveBrainHome();
  const config = await loadConfig({ brainHome });
  const port = await getFreePort(config.dashboardPort);
  dashboardServer = await startDashboard(config, { port });
  const localDashboardUrl = `http://${LOCAL_HOST}:${port}`;
  dashboardOrigin = new URL(localDashboardUrl).origin;
  remoteDashboardMode = false;
  return localDashboardUrl;
}

function createMainWindow({ select = false } = {}) {
  if (!dashboardUrl) {
    throw new Error("Dashboard URL has not been initialized.");
  }

  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_SIZE.width,
    height: DEFAULT_WINDOW_SIZE.height,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    icon: APP_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedInternalUrl(url) || isRemoteDashboardAuthUrl(url)) {
      return { action: "allow" };
    }

    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedInternalUrl(url) || isRemoteDashboardAuthUrl(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("will-frame-navigate", (event, details) => {
    const url = details?.url;
    if (!url || details.isMainFrame) return;
    if (isTrustedInternalUrl(url) || isRemoteDashboardAuthUrl(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Dashboard renderer process exited", details);
    recordAppError(app, "dashboard-renderer-gone", details);
    showLoadFailure(`The dashboard renderer stopped unexpectedly (${details.reason || "unknown reason"}).`);
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("Dashboard renderer became unresponsive");
    recordAppError(app, "dashboard-renderer-unresponsive", new Error("The dashboard window stopped responding."));
    showLoadFailure("The dashboard window stopped responding.");
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    if (errorCode === -3) return;
    if (isLoadFailurePage(validatedUrl)) {
      dialog.showErrorBox("BigBrain dashboard unavailable", errorDescription || `Recovery page failed with code ${errorCode}`);
      return;
    }
    if (validatedUrl && !isTrustedInternalUrl(validatedUrl)) return;
    console.error("Dashboard failed to load", { errorCode, errorDescription, validatedUrl });
    showLoadFailure(errorDescription || `Load failed with code ${errorCode}`);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && isTrustedInternalUrl(currentUrl)) return;
  });

  mainWindow.on("closed", () => {
    if (dashboardView && !dashboardView.webContents.isDestroyed()) {
      dashboardView.webContents.close();
    }
    dashboardView = null;
    dashboardViewBrainId = null;
    activeDashboardOrigin = null;
    mainWindow = null;
  });

  mainWindow.on("resize", layoutDashboardView);

  loadDashboardWindow({ select });
}

function createAppMenu() {
  const template = [
    {
      label: APP_DISPLAY_NAME,
      submenu: [
        { role: "about" },
        {
          label: "Choose or add brain…",
          enabled: Boolean(desktopController),
          click: () => {
            if (!mainWindow || !desktopController) return;
            setDashboardViewVisible(false);
            const shellUrl = pathToFileURL(path.join(__dirname, "desktop.html"));
            shellUrl.searchParams.set("select", "1");
            void mainWindow.loadURL(shellUrl.href);
          },
        },
        { type: "separator" },
        {
          label: "Check for Updates…",
          enabled: desktopUpdater?.snapshot().canCheck ?? false,
          click: () => void handleManualUpdateCheck(),
        },
        ...(desktopUpdater?.snapshot().canRestart ? [{
          label: "Restart to Install Update",
          click: () => void restartToInstallUpdate(),
        }] : []),
        {
          label: updateMenuStatusLabel(),
          enabled: false,
        },
        {
          label: "Desktop-managed local MCP updates with BigBrain",
          enabled: false,
        },
        {
          label: "Remote services update separately",
          enabled: false,
        },
        {
          label: localServiceUpdateState.message,
          enabled: false,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function startManagedServiceReconciliation({ report = true } = {}) {
  if (!desktopController) {
    return {
      phase: "none", managedCount: 0, current: 0, updated: 0, newer: 0,
      blocked: 0, sourceManaged: 0, ownershipUnknown: 0, remote: 0, failed: 0, results: [],
    };
  }
  localServiceUpdateState = { phase: "checking", message: "Checking desktop-managed local MCP services…" };
  createAppMenu();
  sendLocalServiceUpdateState();
  try {
    const { ManagedServiceReconciler, probeManagedService } = await importModule("electron/lib/managed-service-reconciler.mjs");
    const reconciler = new ManagedServiceReconciler({
      appVersion: app.getVersion(),
      listBrains: async () => (await desktopController.state()).brains,
      probe: (brain) => probeManagedService(brain),
      reinstall: (brain) => desktopController.installService(brain, {
        ownerSlug: brain.owner?.personSlug || "",
        gitBackup: brain.backupPreference !== "none",
      }),
      report: report ? reportManagedServiceReconciliation : () => {},
    });
    return await reconciler.reconcile();
  } catch (error) {
    const { formatServiceInstallError } = await importModule("electron/lib/service-errors.mjs");
    const summary = {
      phase: "error",
      managedCount: 0,
      current: 0,
      updated: 0,
      failed: 1,
      results: [{ name: "Local MCP", status: "failed", action: "retry_service_reconciliation", message: formatServiceInstallError(error, { brainName: "local BigBrain services" }) }],
    };
    if (report) await reportManagedServiceReconciliation(summary);
    return summary;
  }
}

async function reportManagedServiceReconciliation(summary) {
  localServiceUpdateState = {
    ...summary,
    message: localServiceUpdateMessage(summary),
  };
  createAppMenu();
  sendLocalServiceUpdateState();
  if (!summary.failed && summary.phase !== "attention") return;
  const failures = summary.results
    .filter((result) => !["current", "updated", "source_managed", "remote"].includes(result.status))
    .map((result) => `${result.name}: ${result.message || serviceActionMessage(result)}`)
    .join("\n");
  await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Local BigBrain MCP Needs Attention",
    message: summary.failed
      ? "BigBrain could not update one or more desktop-managed local MCP services."
      : "One or more local BigBrain MCP services need your attention.",
    detail: `${failures}\n\nRemote BigBrain services were not changed.`,
    buttons: ["OK"],
  });
}

function localServiceUpdateMessage(summary) {
  if (summary.phase === "none") return "No desktop-managed local MCP services";
  if (summary.phase === "development") return "Developer desktop leaves the shared local MCP service unchanged";
  if (summary.phase === "updated") return `Local MCP updated with BigBrain ${app.getVersion()}`;
  if (summary.phase === "current") return `Local MCP is current with BigBrain ${app.getVersion()}`;
  if (summary.phase === "attention" && summary.newer) return "A local MCP is newer than this app; update BigBrain";
  if (summary.phase === "attention" && summary.ownershipUnknown) return "A local MCP has unknown ownership and was left untouched";
  if (summary.phase === "attention") return "A local MCP needs attention before it can be updated";
  if (summary.phase === "error") return `${summary.failed} local MCP update${summary.failed === 1 ? "" : "s"} failed`;
  return "Checking desktop-managed local MCP services…";
}

function serviceActionMessage(result) {
  if (result.action === "update_desktop_app") return "Update the desktop app; the newer service was left untouched.";
  if (result.action === "review_service_ownership") return "Review who manages this service before asking the desktop app to repair it.";
  if (result.action === "resolve_service_identity") return "Resolve the registered brain and port mismatch.";
  if (result.action === "review_service_configuration") return "Review the local service configuration.";
  return "Retry the local service check from the BigBrain app.";
}

function sendLocalServiceUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:local-service-update-state", localServiceUpdateState);
  }
}

function initializeDesktopUpdater() {
  const { DesktopUpdater } = require("./lib/desktop-updater.cjs");
  const updaterAvailable = app.isPackaged && !DEV_BUILD;
  const adapter = updaterAvailable ? require("electron-updater").autoUpdater : {};
  desktopUpdater = new DesktopUpdater({
    adapter,
    version: app.getVersion(),
    isPackaged: updaterAvailable,
  });
  desktopUpdater.on("state", (state) => {
    createAppMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:update-state", state);
    }
    if (dashboardView && !dashboardView.webContents.isDestroyed()) {
      dashboardView.webContents.send("desktop:update-state", state);
    }
    if (state.phase === "downloaded" && state.updateVersion !== promptedUpdateVersion) {
      promptedUpdateVersion = state.updateVersion || "downloaded";
      void prepareDownloadedUpdate(state);
    }
  });
}

async function initializeUpdateRestartCoordinator() {
  const { UpdateRestartCoordinator } = await importModule("electron/lib/update-restart-coordinator.mjs");
  updateRestartCoordinator = new UpdateRestartCoordinator({
    receiptPath: path.join(app.getPath("userData"), "pending-update.json"),
    appVersion: app.getVersion(),
    reconcile: () => DEV_BUILD
      ? developmentServiceReconciliationSummary()
      : startManagedServiceReconciliation({ report: false }),
  });
}

function developmentServiceReconciliationSummary() {
  return {
    phase: "development",
    managedCount: 0,
    current: 0,
    updated: 0,
    newer: 0,
    blocked: 0,
    sourceManaged: 0,
    ownershipUnknown: 0,
    remote: 0,
    failed: 0,
    results: [],
  };
}

async function coordinateManagedServicesAfterLaunch() {
  if (DEV_BUILD) {
    const summary = developmentServiceReconciliationSummary();
    localServiceUpdateState = { ...summary, message: localServiceUpdateMessage(summary) };
    createAppMenu();
    sendLocalServiceUpdateState();
    return summary;
  }
  const verification = await updateRestartCoordinator.verifyAfterRelaunch();
  if (verification.phase === "none") return startManagedServiceReconciliation();
  await reportCoordinatedUpdateVerification(verification);
  return verification.reconciliation || verification;
}

async function reportCoordinatedUpdateVerification(verification) {
  if (verification.phase === "complete") {
    localServiceUpdateState = {
      ...verification.reconciliation,
      updateLifecyclePhase: "complete",
      message: `BigBrain ${verification.appVersion} and its desktop-managed local MCP services are verified`,
    };
    createAppMenu();
    sendLocalServiceUpdateState();
    return;
  }
  localServiceUpdateState = {
    phase: "attention",
    updateLifecyclePhase: verification.phase,
    failed: verification.phase === "app_verification_failed" ? 1 : verification.reconciliation?.failed || 0,
    results: verification.reconciliation?.results || [],
    message: verification.message
      || (verification.reconciliation ? localServiceUpdateMessage(verification.reconciliation) : null)
      || "The app updated, but a desktop-managed local MCP service still needs attention",
  };
  createAppMenu();
  sendLocalServiceUpdateState();
  await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "BigBrain Update Needs Attention",
    message: localServiceUpdateState.message,
    detail: coordinatedUpdateAttentionDetail(localServiceUpdateState),
    buttons: ["OK"],
  });
}

function coordinatedUpdateAttentionDetail(state) {
  const actions = state.results
    .filter((result) => !["current", "updated", "source_managed", "remote"].includes(result.status))
    .map((result) => `${result.name}: ${result.message || serviceActionMessage(result)}`);
  actions.push("The update receipt was kept so BigBrain can verify the update again after the issue is resolved.");
  actions.push("Remote services were not changed.");
  return actions.join("\n\n");
}

async function prepareDownloadedUpdate(state) {
  try {
    if (state.updateVersion) await updateRestartCoordinator.recordDownloadedTarget(state.updateVersion);
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "BigBrain Could Not Prepare the Update",
      message: "The update was downloaded, but BigBrain could not save its verification receipt.",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["OK"],
    });
    return;
  }
  await promptToRestartForUpdate(state);
}

async function restartToInstallUpdate() {
  const state = desktopUpdater.snapshot();
  if (!state.canRestart) return false;
  try {
    if (state.updateVersion) await updateRestartCoordinator.recordDownloadedTarget(state.updateVersion);
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "BigBrain Could Not Prepare the Update",
      message: "BigBrain did not restart because it could not save the update verification receipt.",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["OK"],
    });
    return false;
  }
  return desktopUpdater.restartToInstall();
}

function registerUpdateIpc() {
  ipcMain.handle("desktop:update-state", () => desktopUpdater.snapshot());
  ipcMain.handle("desktop:check-for-updates", () => desktopUpdater.check());
  ipcMain.handle("desktop:restart-to-update", () => restartToInstallUpdate());
  ipcMain.handle("desktop:local-service-update-state", () => localServiceUpdateState);
  ipcMain.handle("desktop:load-failure-state", () => ({ message: pendingLoadFailureMessage }));
  ipcMain.handle("desktop:reload-dashboard", () => {
    loadDashboardWindow();
    return true;
  });
}

function updateMenuStatusLabel() {
  const state = desktopUpdater?.snapshot();
  if (!state) return `Version ${app.getVersion()}`;
  return `Version ${state.version} · ${state.message}`;
}

async function handleManualUpdateCheck() {
  const state = await desktopUpdater.check();
  if (["available", "downloading", "downloaded"].includes(state.phase)) {
    if (state.phase === "downloaded") await promptToRestartForUpdate(state);
    return;
  }
  await dialog.showMessageBox(mainWindow, {
    type: state.phase === "error" ? "warning" : "info",
    title: "BigBrain Updates",
    message: state.message,
    detail: `You are running BigBrain ${state.version}. Desktop-managed local MCP services update with the app; remote services update separately.`,
    buttons: ["OK"],
  });
}

async function promptToRestartForUpdate(state) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "BigBrain Update Ready",
    message: state.updateVersion ? `BigBrain ${state.updateVersion} is ready to install.` : "A BigBrain update is ready to install.",
    detail: "Restart the desktop app to finish. Desktop-managed local MCP services will be reconciled after launch; remote services are not changed.",
    buttons: ["Restart BigBrain", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) await restartToInstallUpdate();
}

function isTrustedInternalUrl(url) {
  if (!dashboardUrl || !dashboardOrigin) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:" && parsed.pathname.startsWith(__dirname)) return true;
    if (desktopController && parsed.hostname === LOCAL_HOST) return true;
    if (connectedDashboardOrigins.has(parsed.origin)) return true;
    return parsed.origin === dashboardOrigin;
  } catch {
    return false;
  }
}

function registerDesktopIpc() {
  const handlers = {
    "desktop:state": async () => rememberConnectedDashboardOrigins(await desktopController.state()),
    "desktop:discover-brains": () => desktopController.discoverBrains(),
    "desktop:api-key-options": (_event, input) => desktopController.availableApiKeys(input),
    "desktop:create-brain": async (_event, input) => {
      const result = await desktopController.createBrain(input);
      await eventRuntimeManager?.ensureBrain(result.brain);
      await eventRuntimeManager?.start();
      return result;
    },
    "desktop:connect-service": async (_event, input) => {
      const brain = rememberConnectedDashboardOrigins(await desktopController.connectService(input));
      await eventRuntimeManager?.ensureBrain(brain);
      await eventRuntimeManager?.start();
      return brain;
    },
    "desktop:open-brain": async (_event, id) => {
      const brain = rememberConnectedDashboardOrigins(await desktopController.activate(id));
      await loadBrainDashboard(brain);
      return true;
    },
    "desktop:show-selector": async () => {
      setDashboardViewVisible(false);
      const shellUrl = pathToFileURL(path.join(__dirname, "desktop.html"));
      shellUrl.searchParams.set("select", "1");
      await mainWindow.loadURL(shellUrl.href);
      return true;
    },
    "desktop:set-dashboard-visible": (_event, visible) => setDashboardViewVisible(Boolean(visible)),
    "desktop:choose-existing-brain": async () => {
      const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Choose an existing BigBrain folder" });
      if (result.canceled || !result.filePaths[0]) return null;
      return desktopController.inspectExistingBrain(result.filePaths[0]);
    },
    "desktop:choose-brain-home": async () => {
      const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Choose a folder for your private local BigBrain" });
      if (result.canceled || !result.filePaths[0]) return null;
      return { home: result.filePaths[0] };
    },
    "desktop:activate": async (_event, id) => rememberConnectedDashboardOrigins(await desktopController.activate(id)),
    "desktop:rename": (_event, id, name) => desktopController.rename(id, name),
    "desktop:restart": (_event, id) => desktopController.restart(id),
    "desktop:instructions": (_event, id) => desktopController.instructions(id),
    "desktop:set-default": (_event, id) => desktopController.setDefault(id),
    "desktop:reveal": (_event, targetPath) => shell.showItemInFolder(targetPath),
    "desktop:event-state": () => eventRuntimeManager?.state() || { ok: false, running: false },
    "desktop:event-listeners": () => eventRuntimeManager?.registry.get().then((value) => ({ revision: value.revision, listeners: value.listeners.map(({ credential_ref, ...listener }) => ({ ...listener, credential_configured: Boolean(credential_ref) })) })) || [],
    "desktop:event-upsert-listener": (_event, value) => eventRuntimeManager.upsertListener(value),
    "desktop:event-upsert-subscription": (_event, value) => eventRuntimeManager.updateSubscription(value),
    "desktop:event-listener-state": (_event, listenerId, action) => eventRuntimeManager.setListenerState(listenerId, action),
    "desktop:event-inbox": (_event, options) => eventRuntimeManager.inboxList(options),
    "desktop:event-retry": (_event, deliveryId) => eventRuntimeManager.retry(deliveryId),
    "desktop:event-discard": (_event, deliveryId, reason) => eventRuntimeManager.discard(deliveryId, reason),
    "desktop:event-quarantine": (_event, deliveryId, reason) => eventRuntimeManager.quarantine(deliveryId, reason),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
}

async function openCanonicalPage({ brain, targetUrl }) {
  rememberConnectedDashboardOrigins(brain);
  await desktopController.activate(brain.id);
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("BigBrain window is unavailable.");
  if (mainWindow.isMinimized()) mainWindow.restore();
  await ensureDesktopShell();
  await loadDashboardViewUrl(targetUrl, brain.id);
  mainWindow.show();
  mainWindow.focus();
}

function isRemoteDashboardAuthUrl(url) {
  if (!remoteDashboardMode && connectedDashboardOrigins.size === 0) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

function rememberConnectedDashboardOrigins(value) {
  const brains = Array.isArray(value?.brains) ? value.brains : [value];
  for (const brain of brains) {
    if (brain?.connectionType !== "service" || !brain.dashboardUrl) continue;
    try {
      connectedDashboardOrigins.add(new URL(brain.dashboardUrl).origin);
    } catch {
      // The controller validates service URLs before they reach the registry.
    }
  }
  return value;
}

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function loadDashboardWindow({ select = false } = {}) {
  if (!mainWindow || !dashboardUrl) return;
  loadFailureActive = false;
  const targetUrl = new URL(dashboardUrl);
  if (select && desktopController) targetUrl.searchParams.set("select", "1");
  void mainWindow.loadURL(targetUrl.href).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Dashboard load failed", message);
    showLoadFailure(message);
  });
}

async function ensureDesktopShell() {
  if (!mainWindow || !desktopController) return;
  const shellUrl = pathToFileURL(path.join(__dirname, "desktop.html")).href;
  if (mainWindow.webContents.getURL().split("?")[0] === shellUrl) return;
  setDashboardViewVisible(false);
  await mainWindow.loadURL(shellUrl);
}

async function loadBrainDashboard(brain) {
  if (!brain?.dashboardUrl) throw new Error("This brain does not expose a dashboard.");
  rememberConnectedDashboardOrigins(brain);
  if (brain.connectionType !== "service") {
    await managedServiceReconciliationPromise;
    await waitForDashboardReady(brain.dashboardUrl);
  }
  await loadDashboardViewUrl(brain.dashboardUrl, brain.id);
}

async function loadDashboardViewUrl(url, brainId) {
  if (!mainWindow || !desktopController) throw new Error("The desktop shell is unavailable.");
  activeDashboardOrigin = new URL(url).origin;
  const view = ensureDashboardView(brainId);
  layoutDashboardView();
  setDashboardViewVisible(false);
  try {
    await view.webContents.loadURL(url);
    setDashboardViewVisible(true);
  } catch (error) {
    setDashboardViewVisible(false);
    throw error;
  }
}

function ensureDashboardView(brainId) {
  if (dashboardView && !dashboardView.webContents.isDestroyed() && dashboardViewBrainId === brainId) return dashboardView;
  if (dashboardView && !dashboardView.webContents.isDestroyed()) {
    mainWindow.contentView.removeChildView(dashboardView);
    dashboardView.webContents.close();
  }
  dashboardView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      partition: dashboardPartition(brainId),
      preload: path.join(__dirname, "dashboard-preload.cjs"),
    },
  });
  dashboardViewBrainId = brainId;
  dashboardView.setBackgroundColor("#18181b");
  mainWindow.contentView.addChildView(dashboardView);
  configureDashboardWebContents(dashboardView.webContents);
  return dashboardView;
}

function configureDashboardWebContents(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedDashboardNavigation(url, activeDashboardOrigin)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            session: webContents.session,
          },
        },
      };
    }
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedDashboardNavigation(url, activeDashboardOrigin)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  webContents.session.setPermissionRequestHandler((_requestingWebContents, _permission, callback) => callback(false));
  webContents.on("render-process-gone", (_event, details) => {
    console.error("Dashboard renderer process exited", details);
    recordAppError(app, "brain-dashboard-renderer-gone", details);
    showLoadFailure(`The dashboard renderer stopped unexpectedly (${details.reason || "unknown reason"}).`);
  });
  webContents.on("unresponsive", () => {
    console.error("Dashboard renderer became unresponsive");
    recordAppError(app, "brain-dashboard-renderer-unresponsive", new Error("The dashboard window stopped responding."));
    showLoadFailure("The dashboard window stopped responding.");
  });
  webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    console.error("Dashboard failed to load", { errorCode, errorDescription, validatedUrl });
  });
}

function layoutDashboardView() {
  if (!mainWindow || !dashboardView) return;
  dashboardView.setBounds(dashboardViewBounds(mainWindow.getContentSize(), DESKTOP_CHROME_HEIGHT));
}

function setDashboardViewVisible(visible) {
  if (!dashboardView || dashboardView.webContents.isDestroyed()) return false;
  dashboardView.setVisible(visible);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:dashboard-visibility", visible);
  }
  return true;
}

function showLoadFailure(message) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    dialog.showErrorBox("BigBrain dashboard unavailable", message);
    return;
  }
  if (loadFailureActive) return;
  loadFailureActive = true;
  pendingLoadFailureMessage = String(message || "The dashboard did not finish loading.");
  recordAppError(app, "dashboard-load-failure", new Error(pendingLoadFailureMessage));
  setDashboardViewVisible(false);
  void mainWindow.loadFile(LOAD_FAILURE_PAGE_PATH).catch((error) => {
    dialog.showErrorBox("BigBrain dashboard unavailable", error instanceof Error ? error.message : String(error));
  });
}

function isLoadFailurePage(url) {
  if (!url) return false;
  try {
    return new URL(url).href.split("?")[0] === pathToFileURL(LOAD_FAILURE_PAGE_PATH).href;
  } catch {
    return false;
  }
}

async function importModule(relativePath) {
  const moduleUrl = pathToFileURL(path.join(app.getAppPath(), relativePath)).href;
  return import(moduleUrl);
}

function resolveRemoteDashboardUrl() {
  const value = process.env[REMOTE_DASHBOARD_URL_ENV] || argValue("--dashboard-url") || argValue("--remote-dashboard-url");
  if (!value) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${REMOTE_DASHBOARD_URL_ENV} must be a valid http or https URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${REMOTE_DASHBOARD_URL_ENV} must use http or https.`);
  }

  if (parsed.pathname === "/" || parsed.pathname === "") {
    parsed.pathname = "/dashboard";
  }

  parsed.hash = "";
  return parsed.toString();
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function getFreePort(preferredPort) {
  if (await canListenOnPort(preferredPort)) {
    return preferredPort;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, LOCAL_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a local port."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, LOCAL_HOST, () => {
      server.close(() => resolve(true));
    });
  });
}
