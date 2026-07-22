const { EventEmitter } = require('events');

const DEFAULT_INITIAL_DELAY_MS = 30_000;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

class DesktopUpdater extends EventEmitter {
  constructor({
    adapter,
    version,
    isPackaged,
    platform = process.platform,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    setTimeoutImpl = setTimeout,
    setIntervalImpl = setInterval,
  }) {
    super();
    this.adapter = adapter;
    this.initialDelayMs = initialDelayMs;
    this.checkIntervalMs = checkIntervalMs;
    this.setTimeoutImpl = setTimeoutImpl;
    this.setIntervalImpl = setIntervalImpl;
    this.checkPromise = null;
    this.started = false;
    this.state = {
      version,
      phase: isPackaged ? 'idle' : 'unavailable',
      message: isPackaged
        ? 'Updates are checked automatically.'
        : 'Update checks are available in an installed BigBrain app.',
      updateVersion: null,
      canCheck: Boolean(isPackaged),
      canRestart: false,
      lastCheckedAt: null,
    };

    if (!isPackaged) return;
    this.adapter.autoDownload = true;
    this.adapter.autoInstallOnAppQuit = true;
    this.adapter.allowPrerelease = false;
    this.bindAdapterEvents(platform);
  }

  bindAdapterEvents(platform) {
    this.adapter.on('checking-for-update', () => this.transition({
      phase: 'checking', message: 'Checking for updates…', canRestart: false,
    }));
    this.adapter.on('update-available', (info = {}) => this.transition({
      phase: 'available', updateVersion: info.version || null,
      message: info.version ? `BigBrain ${info.version} is downloading…` : 'An update is downloading…',
      canRestart: false,
    }));
    this.adapter.on('download-progress', (progress = {}) => {
      const percent = Number.isFinite(progress.percent) ? ` ${Math.round(progress.percent)}%` : '';
      this.transition({ phase: 'downloading', message: `Downloading update…${percent}`, canRestart: false });
    });
    this.adapter.on('update-not-available', () => this.transition({
      phase: 'up-to-date', message: 'BigBrain is up to date.', updateVersion: null,
      canRestart: false, lastCheckedAt: new Date().toISOString(),
    }));
    this.adapter.on('update-downloaded', (info = {}) => this.transition({
      phase: 'downloaded', updateVersion: info.version || this.state.updateVersion,
      message: 'Update ready. Restart BigBrain to install it.', canRestart: true,
      lastCheckedAt: new Date().toISOString(),
    }));
    this.adapter.on('error', (error) => this.transition({
      phase: 'error', message: friendlyUpdateError(error, platform), canRestart: false,
      lastCheckedAt: new Date().toISOString(),
    }));
  }

  start() {
    if (this.started || !this.state.canCheck) return;
    this.started = true;
    const initialTimer = this.setTimeoutImpl(() => this.check({ automatic: true }), this.initialDelayMs);
    initialTimer?.unref?.();
    const interval = this.setIntervalImpl(() => this.check({ automatic: true }), this.checkIntervalMs);
    interval?.unref?.();
  }

  snapshot() {
    return { ...this.state };
  }

  async check({ automatic = false } = {}) {
    if (!this.state.canCheck) return this.snapshot();
    if (this.checkPromise) return this.checkPromise;
    this.transition({ phase: 'checking', message: 'Checking for updates…', canRestart: false });
    this.checkPromise = Promise.resolve()
      .then(() => this.adapter.checkForUpdates())
      .catch((error) => {
        this.transition({
          phase: 'error', message: friendlyUpdateError(error), canRestart: false,
          lastCheckedAt: new Date().toISOString(),
        });
        if (!automatic) return this.snapshot();
        return this.snapshot();
      })
      .then(() => this.snapshot())
      .finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  restartToInstall() {
    if (!this.state.canRestart) return false;
    this.adapter.quitAndInstall(false, true);
    return true;
  }

  transition(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.snapshot());
  }
}

function friendlyUpdateError(error, platform = process.platform) {
  const detail = error instanceof Error ? error.message : String(error || 'Unknown update error');
  if (platform === 'darwin' && /code signature|could not get code signature|not signed/i.test(detail)) {
    return 'This BigBrain build is not signed, so macOS cannot install updates automatically.';
  }
  if (/latest-mac\.yml|404|no published versions|no releases/i.test(detail)) {
    return 'No published BigBrain update is available yet.';
  }
  return 'BigBrain could not check for updates. Try again later.';
}

module.exports = {
  DesktopUpdater,
  friendlyUpdateError,
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_CHECK_INTERVAL_MS,
};
