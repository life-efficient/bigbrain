const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const net = require("net");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_DISPLAY_NAME = "BigBrain";
const LOCAL_HOST = "127.0.0.1";
const DEFAULT_WINDOW_SIZE = { width: 1079, height: 927 };
const APP_ICON_PATH = path.join(__dirname, "assets", "desktop-icon.png");

let mainWindow = null;
let dashboardServer = null;
let dashboardUrl = null;

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

  void mainWindow.loadURL(dashboardUrl);
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
