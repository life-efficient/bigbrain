const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const net = require("net");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_DISPLAY_NAME = "BigBrain";
const LOCAL_HOST = "127.0.0.1";
const DEFAULT_WINDOW_SIZE = { width: 1079, height: 945 };
const APP_ICON_PATH = path.join(__dirname, "assets", "desktop-icon.png");
const MAX_RENDERER_RECOVERY_ATTEMPTS = 2;

let mainWindow = null;
let dashboardServer = null;
let dashboardUrl = null;
let rendererRecoveryAttempts = 0;

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
      dashboardUrl = await startDashboardRuntime();
      createAppMenu();
      createMainWindow();
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
  const [{ resolveBrainHome, loadConfig }, { startDashboard }] = await Promise.all([
    importModule("src/bigbrain/config.js"),
    importModule("src/bigbrain/dashboard.js"),
  ]);

  const brainHome = await resolveBrainHome();
  const config = await loadConfig({ brainHome });
  const port = await getFreePort(config.dashboardPort);
  dashboardServer = await startDashboard(config, { port });
  return `http://${LOCAL_HOST}:${port}`;
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
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedInternalUrl(url)) {
      return { action: "allow" };
    }

    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedInternalUrl(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
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

function isTrustedInternalUrl(url) {
  return Boolean(dashboardUrl && url.startsWith(dashboardUrl));
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
