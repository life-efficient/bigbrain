#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const APP_NAME = "BigBrain";
const DEV_DISPLAY_NAME = "BigBrain Dev";
const DEV_PAGE_LINK_PORT = "55558";
const DEV_APP_NAME = `${DEV_DISPLAY_NAME}.app`;
const DEV_EXECUTABLE_NAME = DEV_DISPLAY_NAME;
const DEV_ELECTRON_BINARY_NAME = `${DEV_DISPLAY_NAME}-bin`;
const DEV_BUNDLE_ID = "ai.diffusing.bigbrain.dashboard.dev";
const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT_DIR, "build", "dev");
const ELECTRON_EXECUTABLE_PATH = require("electron");
const SOURCE_APP_PATH = path.resolve(ELECTRON_EXECUTABLE_PATH, "..", "..", "..");
const LEGACY_DEV_APP_PATH = path.join(BUILD_DIR, `${APP_NAME}.app`);
const TARGET_APP_PATH = path.join(BUILD_DIR, DEV_APP_NAME);
const TARGET_PLIST_PATH = path.join(TARGET_APP_PATH, "Contents", "Info.plist");
const TARGET_RESOURCES_DIR = path.join(TARGET_APP_PATH, "Contents", "Resources");
const DEV_RUNTIME_APP_PATH = path.join(TARGET_RESOURCES_DIR, "app");
const TARGET_EXECUTABLE_PATH = path.join(TARGET_APP_PATH, "Contents", "MacOS", DEV_EXECUTABLE_NAME);
const TARGET_ELECTRON_BINARY_PATH = path.join(TARGET_APP_PATH, "Contents", "MacOS", DEV_ELECTRON_BINARY_NAME);
const DEV_ICON_SOURCE_PATH = path.join(ROOT_DIR, "electron", "assets", "desktop-dev-app-icon.icns");
const CUSTOM_ICON_TARGET_PATH = path.join(TARGET_RESOURCES_DIR, "app-icon.icns");
const STAMP_PATH = path.join(BUILD_DIR, "launcher-stamp.json");
const LAUNCHER_VERSION = 9;

main();

function main() {
  if (process.platform !== "darwin") {
    launchElectronDirectly(startDashboardWatcher());
    return;
  }

  stopRunningDevApps();
  prepareDevAppBundle();

  if (process.argv.includes("--prepare-only")) {
    process.stdout.write(`${TARGET_APP_PATH}\n`);
    return;
  }

  const watcher = startDashboardWatcher();
  const child = spawn(TARGET_EXECUTABLE_PATH, [], {
    cwd: ROOT_DIR,
    env: devEnvironment(),
    stdio: "inherit",
  });
  attachChildLifecycle(child, watcher);
}

function launchElectronDirectly(watcher) {
  const child = spawn(ELECTRON_EXECUTABLE_PATH, [ROOT_DIR], {
    cwd: ROOT_DIR,
    env: devEnvironment(),
    stdio: "inherit",
  });
  attachChildLifecycle(child, watcher);
}

function attachChildLifecycle(child, watcher) {
  let shuttingDown = false;

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.once(signal, () => {
      shuttingDown = true;
      stopChild(watcher, signal);
      stopChild(child, signal);
    });
  }

  child.on("exit", (code, signal) => {
    stopChild(watcher, signal || "SIGTERM");
    if (signal && !shuttingDown) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(signal ? 0 : (code ?? 0));
  });
}

function stopChild(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }

  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the check and the signal.
  }
}

function startDashboardWatcher() {
  const watcherPath = path.join(ROOT_DIR, "scripts", "watch-dashboard-client.mjs");
  return spawn(process.execPath, [watcherPath], {
    cwd: ROOT_DIR,
    env: devEnvironment(),
    stdio: "inherit",
  });
}

function devEnvironment() {
  return {
    ...process.env,
    BIGBRAIN_DASHBOARD_DEV: "1",
    BIGBRAIN_LOCAL_PAGE_LINK_PORT: DEV_PAGE_LINK_PORT,
  };
}

function prepareDevAppBundle() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  removeLegacyDevAppBundle();

  const expectedStamp = JSON.stringify(
    {
      launcherVersion: LAUNCHER_VERSION,
      electronPath: ELECTRON_EXECUTABLE_PATH,
      sourceAppPath: SOURCE_APP_PATH,
      iconMtimeMs: safeStatMtime(DEV_ICON_SOURCE_PATH),
    },
    null,
    2,
  );

  const existingStamp = fs.existsSync(STAMP_PATH) ? fs.readFileSync(STAMP_PATH, "utf8") : null;
  if (!fs.existsSync(TARGET_APP_PATH) || existingStamp !== expectedStamp) {
    fs.rmSync(TARGET_APP_PATH, { recursive: true, force: true });
    fs.cpSync(SOURCE_APP_PATH, TARGET_APP_PATH, {
      recursive: true,
      verbatimSymlinks: true,
    });
    fs.writeFileSync(STAMP_PATH, expectedStamp);
  }

  setPlistValue("CFBundleName", DEV_DISPLAY_NAME);
  setPlistValue("CFBundleDisplayName", DEV_DISPLAY_NAME);
  setPlistValue("CFBundleExecutable", DEV_EXECUTABLE_NAME);
  setPlistValue("CFBundleIdentifier", DEV_BUNDLE_ID);
  setPlistValue("CFBundleIconFile", "app-icon.icns");
  setPlistValue("LSApplicationCategoryType", "public.app-category.productivity");
  installDevRuntimeApp();
  syncDevAppIcon();
  installSelfLaunchingExecutable();
}

function removeLegacyDevAppBundle() {
  if (LEGACY_DEV_APP_PATH !== TARGET_APP_PATH && fs.existsSync(LEGACY_DEV_APP_PATH)) {
    fs.rmSync(LEGACY_DEV_APP_PATH, { recursive: true, force: true });
  }
}

function installDevRuntimeApp() {
  fs.rmSync(DEV_RUNTIME_APP_PATH, { recursive: true, force: true });
  fs.mkdirSync(DEV_RUNTIME_APP_PATH, { recursive: true });

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
  packageJson.productName = DEV_DISPLAY_NAME;
  fs.writeFileSync(
    path.join(DEV_RUNTIME_APP_PATH, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );

  for (const directory of [".bigbrain-dashboard", "automations", "bin", "electron", "node_modules", "schemas", "scripts", "skills", "src"]) {
    fs.symlinkSync(path.join(ROOT_DIR, directory), path.join(DEV_RUNTIME_APP_PATH, directory), "dir");
  }
}

function installSelfLaunchingExecutable() {
  // A copied Electron.app normally expects the application path as its first
  // command-line argument. Finder and Spotlight cannot provide that argument,
  // so keep Electron's binary inside this disposable bundle and put a tiny
  // launcher at CFBundleExecutable. It points only at the source checkout; it
  // does not copy or start a brain service.
  if (!fs.existsSync(TARGET_ELECTRON_BINARY_PATH)) {
    const copiedElectronPath = path.join(path.dirname(TARGET_EXECUTABLE_PATH), "Electron");
    fs.renameSync(copiedElectronPath, TARGET_ELECTRON_BINARY_PATH);
  }

  const appPath = shellSingleQuote(DEV_RUNTIME_APP_PATH);
  const binaryPath = shellSingleQuote(TARGET_ELECTRON_BINARY_PATH);
  const launcher = [
    "#!/bin/sh",
    `cd ${shellSingleQuote(ROOT_DIR)} || exit 1`,
    "export BIGBRAIN_DASHBOARD_DEV=1",
    `export BIGBRAIN_LOCAL_PAGE_LINK_PORT=${DEV_PAGE_LINK_PORT}`,
    `exec ${binaryPath} ${appPath} "$@"`,
    "",
  ].join("\n");
  fs.writeFileSync(TARGET_EXECUTABLE_PATH, launcher, { mode: 0o755 });
  fs.chmodSync(TARGET_EXECUTABLE_PATH, 0o755);
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function stopRunningDevApps() {
  requestDevAppQuit();

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const pids = runningDevAppPids();
    if (pids.length === 0) {
      return;
    }

    terminateDevAppPids(pids, "SIGTERM");
    waitBriefly();
  }

  terminateDevAppPids(runningDevAppPids(), "SIGKILL");
}

function requestDevAppQuit() {
  try {
    execFileSync("osascript", ["-e", `tell application id "${DEV_BUNDLE_ID}" to quit`], {
      stdio: "ignore",
    });
  } catch {
    // Exact process cleanup below is the source of truth when AppleScript is
    // unavailable or the app has already lost its UI registration.
  }
}

function runningDevAppPids() {
  try {
    const output = execFileSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return output
      .split("\n")
      .map((line) => line.trimStart().match(/^(\d+)\s+(.+)$/))
      .filter(Boolean)
      .filter(([, pid, command]) => {
        if (Number(pid) === process.pid) {
          return false;
        }
        return command === TARGET_ELECTRON_BINARY_PATH
          || command.startsWith(`${TARGET_ELECTRON_BINARY_PATH} `);
      })
      .map(([, pid]) => Number(pid));
  } catch {
    return [];
  }
}

function terminateDevAppPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may have exited between enumeration and termination.
    }
  }
}

function waitBriefly() {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  } catch {
    // Best effort only. The next process scan remains authoritative.
  }
}

function setPlistValue(key, value) {
  const escapedValue = String(value).replace(/"/g, '\\"');

  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} \"${escapedValue}\"`, TARGET_PLIST_PATH], {
      stdio: "ignore",
    });
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string \"${escapedValue}\"`, TARGET_PLIST_PATH], {
      stdio: "ignore",
    });
  }
}

function syncDevAppIcon() {
  if (!fs.existsSync(DEV_ICON_SOURCE_PATH)) {
    return;
  }

  fs.copyFileSync(DEV_ICON_SOURCE_PATH, CUSTOM_ICON_TARGET_PATH);
}

function safeStatMtime(filePath) {
  return fs.statSync(filePath).mtimeMs;
}
