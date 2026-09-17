import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('playbooks stay behind the Playbooks shell instead of becoming primary dashboard views', async () => {
  const [main, shell, conventions] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/playbooks/shell.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../app-conventions/playbooks/README.md', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /PlaybooksController/);
  assert.match(main, /const views = \[/);
  assert.doesNotMatch(main, /KeepInTouchPanel|ComprehensionPanel|PLAYBOOKS|keep-in-touch|comprehension/);
  assert.doesNotMatch(main, /bigbrain:playbooks|api\/playbooks/);

  assert.match(shell, /localStorage/);
  assert.match(shell, /KeepInTouchPanel/);
  assert.match(shell, /ComprehensionPanel/);
  assert.match(shell, /PlaybookOutlet/);
  assert.match(shell, /role="menu"/);
  assert.match(conventions, /Do not append enabled playbooks to the header `views` array/);
});
