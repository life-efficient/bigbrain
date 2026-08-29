import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('standalone dashboard development command starts the source watcher and dashboard', async () => {
  const [packageJson, script, readme] = await Promise.all([
    fs.readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../scripts/dashboard-dev.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../README.md', import.meta.url), 'utf8'),
  ]);

  const packageValue = JSON.parse(packageJson);
  assert.equal(packageValue.scripts['dashboard:dev'], 'node ./scripts/dashboard-dev.mjs');
  assert.match(script, /BIGBRAIN_DASHBOARD_DEV: '1'/);
  assert.match(script, /watch-dashboard-client\.mjs/);
  assert.match(script, /bin', 'bigbrain\.js/);
  assert.match(script, /splitCliArgs/);
  assert.match(script, /globalOptionsWithValues/);
  assert.match(script, /dashboardProcess = spawn/);
  assert.match(readme, /npm run dashboard:dev -- --port 3474/);
});
