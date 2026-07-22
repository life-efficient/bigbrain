const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const net = require("net");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_DISPLAY_NAME = "BigBrain";
const LOCAL_HOST = "127.0.0.1";
const DEFAULT_WINDOW_SIZE = { width: 1079, height: 945 };
const APP_ICON_PATH = path.join(__dirname, "assets", "desktop-icon.png");
const MAX_RENDERER_RECOVERY_ATTEMPTS = 2;
const REMOTE_DASHBOARD_URL_ENV = "BIGBRAIN_DASHBOARD_URL";

let mainWindow = null;
let dashboardServer = null;
let dashboardUrl = null;
let dashboardOrigin = null;
let remoteDashboardMode = false;
let rendererRecoveryAttempts = 0;
let desktopController = null;
let desktopUpdater = null;
let promptedUpdateVersion = null;
const connectedDashboardOrigins = new Set();

const singleInstanceLock = app.requestSingleInstanceLock();

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
        rememberConnectedDashboardOrigins(await desktopController.state());
        registerDesktopIpc();
        dashboardUrl = pathToFileURL(path.join(__dirname, "desktop.html")).href;
        dashboardOrigin = "null";
      }
      initializeDesktopUpdater();
      registerUpdateIpc();
      createAppMenu();
      createMainWindow();
      desktopUpdater.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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

function createMainWindow() {
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
    recoverRenderer(`The dashboard renderer stopped unexpectedly (${details.reason || "unknown reason"}).`);
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("Dashboard renderer became unresponsive");
    recoverRenderer("The dashboard window stopped responding.");
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    if (errorCode === -3) return;
    if (validatedUrl && !isTrustedInternalUrl(validatedUrl)) return;
    console.error("Dashboard failed to load", { errorCode, errorDescription, validatedUrl });
    showLoadFailure(errorDescription || `Load failed with code ${errorCode}`);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && isTrustedInternalUrl(currentUrl)) {
      rendererRecoveryAttempts = 0;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  loadDashboardWindow();
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
          click: () => desktopUpdater.restartToInstall(),
        }] : []),
        {
          label: updateMenuStatusLabel(),
          enabled: false,
        },
        {
          label: "Connected services update separately",
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

function initializeDesktopUpdater() {
  const { DesktopUpdater } = require("./lib/desktop-updater.cjs");
  const adapter = app.isPackaged ? require("electron-updater").autoUpdater : {};
  desktopUpdater = new DesktopUpdater({
    adapter,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  });
  desktopUpdater.on("state", (state) => {
    createAppMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:update-state", state);
    }
    if (state.phase === "downloaded" && state.updateVersion !== promptedUpdateVersion) {
      promptedUpdateVersion = state.updateVersion || "downloaded";
      void promptToRestartForUpdate(state);
    }
  });
}

function registerUpdateIpc() {
  ipcMain.handle("desktop:update-state", () => desktopUpdater.snapshot());
  ipcMain.handle("desktop:check-for-updates", () => desktopUpdater.check());
  ipcMain.handle("desktop:restart-to-update", () => desktopUpdater.restartToInstall());
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
    detail: `You are running BigBrain ${state.version}. Connected BigBrain services are not changed by desktop updates.`,
    buttons: ["OK"],
  });
}

async function promptToRestartForUpdate(state) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "BigBrain Update Ready",
    message: state.updateVersion ? `BigBrain ${state.updateVersion} is ready to install.` : "A BigBrain update is ready to install.",
    detail: "Restart the desktop app to finish. Connected BigBrain services are not changed.",
    buttons: ["Restart BigBrain", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) desktopUpdater.restartToInstall();
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
    "desktop:create-brain": (_event, input) => desktopController.createBrain(input),
    "desktop:connect-service": async (_event, input) => rememberConnectedDashboardOrigins(await desktopController.connectService(input)),
    "desktop:open-brain": async (_event, id) => {
      const brain = rememberConnectedDashboardOrigins(await desktopController.activate(id));
      if (brain.connectionType !== "service") throw new Error('Only connected BigBrain services open as a full-window dashboard.');
      setTimeout(() => { if (mainWindow) void mainWindow.loadURL(brain.dashboardUrl); }, 0);
      return true;
    },
    "desktop:choose-existing-brain": async () => {
      const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Choose an existing BigBrain folder" });
      if (result.canceled || !result.filePaths[0]) return null;
      return desktopController.inspectExistingBrain(result.filePaths[0]);
    },
    "desktop:activate": async (_event, id) => rememberConnectedDashboardOrigins(await desktopController.activate(id)),
    "desktop:rename": (_event, id, name) => desktopController.rename(id, name),
    "desktop:restart": (_event, id) => desktopController.restart(id),
    "desktop:instructions": (_event, id) => desktopController.instructions(id),
    "desktop:set-default": (_event, id) => desktopController.setDefault(id),
    "desktop:reveal": (_event, targetPath) => shell.showItemInFolder(targetPath),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
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

function loadDashboardWindow() {
  if (!mainWindow || !dashboardUrl) return;
  void mainWindow.loadURL(dashboardUrl).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Dashboard load failed", message);
    showLoadFailure(message);
  });
}

function recoverRenderer(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (rendererRecoveryAttempts >= MAX_RENDERER_RECOVERY_ATTEMPTS) {
    showLoadFailure(`${message} Automatic recovery was attempted ${MAX_RENDERER_RECOVERY_ATTEMPTS} times.`);
    return;
  }
  rendererRecoveryAttempts += 1;
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    loadDashboardWindow();
  }, 250);
}

function showLoadFailure(message) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    dialog.showErrorBox("BigBrain dashboard unavailable", message);
    return;
  }
  const escapedMessage = escapeHtml(message);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>BigBrain dashboard unavailable</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f4; color: #20201d; }
    main { width: min(640px, calc(100vw - 48px)); border: 1px solid #d8d5cc; border-radius: 8px; background: #fff; padding: 24px; box-shadow: 0 18px 48px rgba(30, 28, 24, 0.12); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0 0 16px; color: #57534a; line-height: 1.5; }
    pre { overflow: auto; white-space: pre-wrap; word-break: break-word; border: 1px solid #e5e2da; border-radius: 8px; padding: 12px; background: #f8f8f6; }
    button { border: 1px solid #222; border-radius: 6px; background: #222; color: #fff; padding: 8px 12px; font: inherit; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Dashboard unavailable</h1>
    <p>The desktop window could not load the local dashboard. Reloading may fix a temporary renderer failure.</p>
    <button onclick="location.href='${dashboardUrl}'">Reload dashboard</button>
    <pre>${escapedMessage}</pre>
  </main>
</body>
</html>`;
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error) => {
    dialog.showErrorBox("BigBrain dashboard unavailable", error instanceof Error ? error.message : String(error));
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
