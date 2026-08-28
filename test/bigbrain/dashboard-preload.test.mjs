import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { updatePresentation } = require('../../electron/dashboard-preload.cjs');

test('dashboard preload keeps desktop chrome isolated and inline with dashboard controls', async () => {
  const source = await fs.readFile(new URL('../../electron/dashboard-preload.cjs', import.meta.url), 'utf8');
  assert.match(source, /require\('electron'\)/);
  assert.match(source, /document\.documentElement\.classList\.add\('bigbrain-desktop'\)/);
  assert.match(source, /document\.querySelector\('\.topline-brand'\)/);
  assert.match(source, /document\.querySelector\('\.topline-actions'\)/);
  assert.match(source, /attachShadow\(\{ mode: 'closed' \}\)/g);
  assert.match(source, /-webkit-app-region: no-drag/);
  assert.match(source, /aria-haspopup/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /desktop:open-brain/);
  assert.match(source, /desktop:show-selector/);
  assert.match(source, /desktop:check-for-updates/);
  assert.match(source, /desktop:restart-to-update/);
  assert.match(source, /ipcRenderer\.on\('desktop:update-state'/);
  assert.doesNotMatch(source, /contextBridge|exposeInMainWorld/);
});

test('desktop update status is compact by default and reveals its action in a popover', async () => {
  const source = await fs.readFile(new URL('../../electron/dashboard-preload.cjs', import.meta.url), 'utf8');
  assert.match(source, /width: 38px; height: 38px/);
  assert.match(source, /version\.textContent = `v\$\{presentation\.currentVersion\}`/);
  assert.match(source, /rgba\(59,130,246/);
  assert.match(source, /className = 'popover'/);
  assert.match(source, /popover\.hidden = true/);
  assert.match(source, /aria-haspopup', 'dialog'/);
  assert.match(source, /aria-live', 'polite'/);
  assert.match(source, /aria-valuenow/);
  assert.match(source, /Try update check again/);
  assert.match(source, /Restart to install BigBrain/);
});

test('header presentation always identifies the running version and shows update activity precisely', () => {
  const idle = updatePresentation({ version: '0.21.0', phase: 'up-to-date', message: 'BigBrain is up to date.' });
  assert.equal(idle.currentVersion, '0.21.0');
  assert.equal(idle.controlVisible, false);

  const downloading = updatePresentation({
    version: '0.21.0', phase: 'downloading', updateVersion: '0.22.0', downloadPercent: 47.6,
  });
  assert.equal(downloading.controlVisible, true);
  assert.equal(downloading.tone, 'update');
  assert.equal(downloading.icon, '48%');
  assert.equal(downloading.progressPercent, 48);
  assert.match(downloading.triggerLabel, /BigBrain 0\.22\.0.*48% complete/);
  assert.equal(downloading.actionDisabled, true);

  const downloaded = updatePresentation({
    version: '0.21.0', phase: 'downloaded', updateVersion: '0.22.0', canRestart: true,
  });
  assert.equal(downloaded.controlVisible, true);
  assert.equal(downloaded.actionLabel, 'Restart to install BigBrain 0.22.0');
  assert.equal(downloaded.actionDisabled, false);
});

test('update errors remain visible and offer a retry without exposing stale progress', () => {
  const failed = updatePresentation({
    version: '0.21.0', phase: 'error', message: 'BigBrain could not check for updates.', downloadPercent: 63,
  });
  assert.equal(failed.controlVisible, true);
  assert.equal(failed.tone, 'error');
  assert.equal(failed.actionLabel, 'Try update check again');
  assert.equal(failed.actionDisabled, false);
  assert.equal(failed.progressVisible, false);
  assert.match(failed.triggerLabel, /needs attention/);
});

test('macOS traffic-light clearance applies only to the desktop dashboard topline', async () => {
  const [source, clientSource] = await Promise.all([
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /html\.bigbrain-desktop \.topline \{[^}]*padding-left: 60px;/);
  assert.doesNotMatch(source, /html\.bigbrain-desktop main \{[^}]*padding-left:/);
  assert.match(clientSource, /className="desktop-drag-strip" aria-hidden="true"/);
  assert.match(source, /\.topline \{[^}]*-webkit-app-region: no-drag;/);
  assert.match(source, /\.view-nav, \.view-chip, \.topline-actions, \.topline-actions > \*, \.settings-button, \.health-button,[^{]*\{ -webkit-app-region: no-drag; \}/);
  assert.match(source, /html\.bigbrain-desktop \.desktop-drag-strip \{[^}]*height: 14px;[^}]*-webkit-app-region: drag;/);
  assert.doesNotMatch(source, /\.topline \{[^}]*-webkit-app-region: drag;/);
});
