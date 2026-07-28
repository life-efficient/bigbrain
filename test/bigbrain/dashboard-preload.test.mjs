import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

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
  assert.match(source, /className = 'popover'/);
  assert.match(source, /popover\.hidden = true/);
  assert.match(source, /updateState\.phase === 'error'/);
  assert.match(source, /updateState\.canRestart/);
  assert.match(source, /Check for updates/);
  assert.match(source, /Restart to update/);
});

test('macOS traffic-light clearance applies only to the desktop dashboard topline', async () => {
  const source = await fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /html\.bigbrain-desktop \.topline \{[^}]*padding-left: 60px;/);
  assert.doesNotMatch(source, /html\.bigbrain-desktop main \{[^}]*padding-left:/);
});
