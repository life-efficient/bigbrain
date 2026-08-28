import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DesktopUpdater,
  friendlyUpdateError,
  DEFAULT_CHECK_INTERVAL_MS,
} = require('../../electron/lib/desktop-updater.cjs');

class FakeUpdater extends EventEmitter {
  checks = 0;
  installs = [];

  async checkForUpdates() {
    this.checks += 1;
    this.emit('checking-for-update');
    this.emit('update-not-available', { version: '0.15.0' });
  }

  quitAndInstall(...args) {
    this.installs.push(args);
  }
}

test('development builds explain why updates are unavailable without touching an adapter', async () => {
  const updater = new DesktopUpdater({ adapter: null, version: '0.15.0', isPackaged: false });
  assert.deepEqual(updater.snapshot(), {
    version: '0.15.0', phase: 'unavailable',
    message: 'Update checks are available in an installed BigBrain app.',
    updateVersion: null, downloadPercent: null,
    canCheck: false, canRestart: false, lastCheckedAt: null,
  });
  assert.equal((await updater.check()).phase, 'unavailable');
  assert.equal(updater.restartToInstall(), false);
});

test('packaged builds check automatically and use the same engine for manual checks', async () => {
  const adapter = new FakeUpdater();
  let initialCheck;
  let recurringCheck;
  const updater = new DesktopUpdater({
    adapter, version: '0.15.0', isPackaged: true,
    setTimeoutImpl: (callback, delay) => { initialCheck = { callback, delay }; return { unref() {} }; },
    setIntervalImpl: (callback, delay) => { recurringCheck = { callback, delay }; return { unref() {} }; },
  });

  updater.start();
  updater.start();
  assert.equal(initialCheck.delay, 30_000);
  assert.equal(recurringCheck.delay, 24 * 60 * 60 * 1_000);
  assert.equal(DEFAULT_CHECK_INTERVAL_MS, 24 * 60 * 60 * 1_000);
  await initialCheck.callback();
  await updater.check();
  await recurringCheck.callback();
  assert.equal(adapter.checks, 3);
  assert.equal(updater.snapshot().phase, 'up-to-date');
  assert.equal(adapter.autoDownload, true);
  assert.equal(adapter.autoInstallOnAppQuit, false);
  assert.equal(adapter.allowPrerelease, false);
});

test('download progress is normalized and downloaded updates require an explicit controlled restart', () => {
  const adapter = new FakeUpdater();
  const updater = new DesktopUpdater({ adapter, version: '0.15.0', isPackaged: true });
  adapter.emit('update-available', { version: '0.16.0' });
  adapter.emit('download-progress', { percent: 47.6 });
  assert.match(updater.snapshot().message, /48%/);
  assert.equal(updater.snapshot().downloadPercent, 48);
  adapter.emit('update-downloaded', { version: '0.16.0' });
  assert.equal(updater.snapshot().canRestart, true);
  assert.equal(updater.snapshot().downloadPercent, 100);
  assert.equal(updater.restartToInstall(), true);
  assert.deepEqual(adapter.installs, [[false, true]]);
  assert.equal(updater.snapshot().phase, 'installing');
  assert.equal(updater.snapshot().canRestart, false);
  assert.equal(updater.restartToInstall(), false);
  assert.equal('desktopController' in updater, false);
});

test('download progress stays within the accessible percentage range', () => {
  const adapter = new FakeUpdater();
  const updater = new DesktopUpdater({ adapter, version: '0.15.0', isPackaged: true });
  adapter.emit('download-progress', { percent: -12 });
  assert.equal(updater.snapshot().downloadPercent, 0);
  adapter.emit('download-progress', { percent: 140 });
  assert.equal(updater.snapshot().downloadPercent, 100);
  adapter.emit('download-progress', {});
  assert.equal(updater.snapshot().downloadPercent, null);
});

test('a failed explicit restart remains actionable without installing on ordinary quit', () => {
  const adapter = new FakeUpdater();
  adapter.quitAndInstall = () => { throw new Error('restart rejected'); };
  const updater = new DesktopUpdater({ adapter, version: '0.15.0', isPackaged: true });
  adapter.emit('update-downloaded', { version: '0.16.0' });
  assert.equal(updater.restartToInstall(), false);
  assert.equal(updater.snapshot().phase, 'error');
  assert.equal(updater.snapshot().canRestart, false);
  assert.equal(adapter.autoInstallOnAppQuit, false);
});

test('unsigned and unpublished builds fail with useful, non-technical messages', () => {
  assert.match(friendlyUpdateError(new Error('Could not get code signature for running application'), 'darwin'), /not signed/);
  assert.match(friendlyUpdateError(new Error('latest-mac.yml returned 404'), 'darwin'), /No published/);
  assert.doesNotMatch(friendlyUpdateError(new Error('request failed at https://example.test?token=secret')), /token=secret/);
});

test('desktop exposes compact inline update controls without a service-update command', async () => {
  const [mainSource, preloadSource, dashboardPreloadSource, desktopSource, desktopHtml] = await Promise.all([
    fs.readFile(new URL('../../electron/main.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../electron/dashboard-preload.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../electron/desktop.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../electron/desktop.html', import.meta.url), 'utf8'),
  ]);
  assert.match(mainSource, /Check for Updates…/);
  assert.match(mainSource, /Desktop-managed local MCP updates with BigBrain/);
  assert.match(mainSource, /Remote services update separately/);
  assert.match(mainSource, /startManagedServiceReconciliation/);
  assert.match(mainSource, /connectionType !== 'service'|ManagedServiceReconciler/);
  assert.match(mainSource, /desktopUpdater\.start\(\)/);
  assert.match(preloadSource, /desktop:check-for-updates/);
  assert.match(preloadSource, /desktop:restart-to-update/);
  assert.match(dashboardPreloadSource, /desktop:check-for-updates/);
  assert.match(dashboardPreloadSource, /desktop:restart-to-update/);
  assert.match(dashboardPreloadSource, /Check for updates/);
  assert.match(dashboardPreloadSource, /className = 'popover'/);
  assert.doesNotMatch(desktopSource, /renderUpdateControl|initUpdateControl/);
  assert.doesNotMatch(desktopHtml, /id="update-control"/);
  assert.doesNotMatch(mainSource, /desktop:update-service|desktopController\.update/);
});

test('release workflow labels unsigned packages and excludes them from the automatic-update feed', async () => {
  const workflow = await fs.readFile(new URL('../../.github/workflows/release-macos.yml', import.meta.url), 'utf8');
  assert.match(workflow, /Determine macOS distribution mode/);
  assert.match(workflow, /Build signed and notarized universal macOS packages/);
  assert.match(workflow, /Build unsigned universal macOS packages/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: false/);
  assert.match(workflow, /mac-universal-unsigned\.dmg/);
  assert.match(workflow, /mac-universal-unsigned\.zip/);
  assert.match(workflow, /UNSIGNED-MACOS\.txt/);
  assert.match(workflow, /rm -f .*latest-mac\.yml/);
  assert.match(workflow, /Attach unsigned packages to GitHub Release/);
  assert.match(workflow, /steps\.signing\.outputs\.enabled != 'true'/);
});
