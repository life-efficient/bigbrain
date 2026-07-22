import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DesktopUpdater, friendlyUpdateError } = require('../../electron/lib/desktop-updater.cjs');

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
    updateVersion: null, canCheck: false, canRestart: false, lastCheckedAt: null,
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
  assert.equal(recurringCheck.delay, 6 * 60 * 60 * 1_000);
  await initialCheck.callback();
  await updater.check();
  await recurringCheck.callback();
  assert.equal(adapter.checks, 3);
  assert.equal(updater.snapshot().phase, 'up-to-date');
  assert.equal(adapter.autoDownload, true);
  assert.equal(adapter.autoInstallOnAppQuit, true);
  assert.equal(adapter.allowPrerelease, false);
});

test('downloaded updates require an explicit restart and install only the desktop package', () => {
  const adapter = new FakeUpdater();
  const updater = new DesktopUpdater({ adapter, version: '0.15.0', isPackaged: true });
  adapter.emit('update-available', { version: '0.16.0' });
  adapter.emit('download-progress', { percent: 47.6 });
  assert.match(updater.snapshot().message, /48%/);
  adapter.emit('update-downloaded', { version: '0.16.0' });
  assert.equal(updater.snapshot().canRestart, true);
  assert.equal(updater.restartToInstall(), true);
  assert.deepEqual(adapter.installs, [[false, true]]);
  assert.equal('desktopController' in updater, false);
});

test('unsigned and unpublished builds fail with useful, non-technical messages', () => {
  assert.match(friendlyUpdateError(new Error('Could not get code signature for running application'), 'darwin'), /not signed/);
  assert.match(friendlyUpdateError(new Error('latest-mac.yml returned 404'), 'darwin'), /No published/);
  assert.doesNotMatch(friendlyUpdateError(new Error('request failed at https://example.test?token=secret')), /token=secret/);
});

test('desktop exposes update status and manual controls without a service-update command', async () => {
  const [mainSource, preloadSource, desktopSource, desktopHtml] = await Promise.all([
    fs.readFile(new URL('../../electron/main.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../electron/desktop.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../electron/desktop.html', import.meta.url), 'utf8'),
  ]);
  assert.match(mainSource, /Check for Updates…/);
  assert.match(mainSource, /Connected services update separately/);
  assert.match(mainSource, /desktopUpdater\.start\(\)/);
  assert.match(preloadSource, /desktop:check-for-updates/);
  assert.match(preloadSource, /desktop:restart-to-update/);
  assert.match(desktopSource, /Check for updates/);
  assert.match(desktopHtml, /id="update-control"/);
  assert.doesNotMatch(mainSource, /desktop:update-service|desktopController\.update/);
});
