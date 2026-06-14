#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const APP_NAME = "BigBrain";
const DEV_APP_NAME = `${APP_NAME}.app`;
const DEV_BUNDLE_ID = "ai.diffusing.bigbrain.dashboard.dev";
const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT_DIR, "build", "dev");
const ELECTRON_EXECUTABLE_PATH = require("electron");
const SOURCE_APP_PATH = path.resolve(ELECTRON_EXECUTABLE_PATH, "..", "..", "..");
const TARGET_APP_PATH = path.join(BUILD_DIR, DEV_APP_NAME);
const TARGET_PLIST_PATH = path.join(TARGET_APP_PATH, "Contents", "Info.plist");
const TARGET_RESOURCES_DIR = path.join(TARGET_APP_PATH, "Contents", "Resources");
const TARGET_EXECUTABLE_PATH = path.join(TARGET_APP_PATH, "Contents", "MacOS", "Electron");
const CUSTOM_ICON_SOURCE_PATH = path.join(ROOT_DIR, "electron", "assets", "desktop-app-icon.icns");
const CUSTOM_ICON_TARGET_PATH = path.join(TARGET_RESOURCES_DIR, "app-icon.icns");
const STAMP_PATH = path.join(BUILD_DIR, "launcher-stamp.json");
const LAUNCHER_VERSION = 2;

main();

function main() {
  if (process.platform !== "darwin") {
    launchElectronDirectly();
    return;
  }

  prepareDevAppBundle();
  quitRunningDevApp();

  if (process.argv.includes("--prepare-only")) {
    process.stdout.write(`${TARGET_APP_PATH}\n`);
    return;
  }

  const child = spawn(TARGET_EXECUTABLE_PATH, [ROOT_DIR], {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

function launchElectronDirectly() {
  const child = spawn(ELECTRON_EXECUTABLE_PATH, [ROOT_DIR], {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

function prepareDevAppBundle() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  const expectedStamp = JSON.stringify(
    {
      launcherVersion: LAUNCHER_VERSION,
      electronPath: ELECTRON_EXECUTABLE_PATH,
      sourceAppPath: SOURCE_APP_PATH,
      iconMtimeMs: safeStatMtime(CUSTOM_ICON_SOURCE_PATH),
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

  setPlistValue("CFBundleName", APP_NAME);
  setPlistValue("CFBundleDisplayName", APP_NAME);
  setPlistValue("CFBundleIdentifier", DEV_BUNDLE_ID);
  setPlistValue("CFBundleIconFile", "app-icon.icns");
  setPlistValue("LSApplicationCategoryType", "public.app-category.productivity");
  syncDevAppIcon();
}

function quitRunningDevApp() {
  try {
    if (!isDevAppRunning()) {
      return;
    }

    execFileSync("osascript", ["-e", `tell application id "${DEV_BUNDLE_ID}" to quit`], {
      stdio: "ignore",
    });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!isDevAppRunning()) {
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  } catch {
    // Fall through. Launching will still work when no app is running.
  }
}

function isDevAppRunning() {
  try {
    const result = execFileSync("osascript", ["-e", `application id "${DEV_BUNDLE_ID}" is running`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.trim() === "true";
  } catch {
    return false;
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
  if (!fs.existsSync(CUSTOM_ICON_SOURCE_PATH)) {
    return;
  }

  fs.copyFileSync(CUSTOM_ICON_SOURCE_PATH, CUSTOM_ICON_TARGET_PATH);
}

function safeStatMtime(filePath) {
  return fs.statSync(filePath).mtimeMs;
}
