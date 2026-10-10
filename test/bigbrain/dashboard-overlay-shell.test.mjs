import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('overlays stay behind the Overlays shell instead of becoming primary dashboard views', async () => {
  const [main, shell, conventions] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/overlays/shell.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../app-conventions/overlays/README.md', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /OverlaysController/);
  assert.match(main, /const views = \[/);
  assert.doesNotMatch(main, /KeepInTouchPanel|ComprehensionPanel|OVERLAYS|keep-in-touch|comprehension/);
  assert.doesNotMatch(main, /bigbrain:overlays|api\/overlays/);

  assert.match(shell, /localStorage/);
  assert.match(shell, /KeepInTouchPanel/);
  assert.match(shell, /ComprehensionPanel/);
  assert.match(shell, /OverlayOutlet/);
  assert.match(shell, /role="menu"/);
  assert.match(conventions, /Do not append enabled overlays to the header `views` array/);
});
