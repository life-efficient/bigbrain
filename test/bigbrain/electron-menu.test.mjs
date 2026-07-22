import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('desktop menu keeps standard editing shortcuts available', async () => {
  const mainSource = await fs.readFile(new URL('../../electron/main.cjs', import.meta.url), 'utf8');

  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    assert.match(mainSource, new RegExp(`role: ["']${role}["']`));
  }
});
