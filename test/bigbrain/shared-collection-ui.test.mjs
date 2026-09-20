import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('shared collection page uses Collection wording while retaining the legacy route', async () => {
  const source = await fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8');
  const view = source.slice(source.indexOf('function SharedGroupApp()'), source.indexOf('function isSharedGroupLocation('));

  assert.match(view, /Loading shared collection…/);
  assert.match(view, /Shared collection not found/);
  assert.doesNotMatch(view, /Shared group|shared group/);
  assert.match(view, /\/api\/shared\/group/);
});
