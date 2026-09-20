import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Recents shows a collection selector and sends the selection to its API', async () => {
  const client = await fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8');
  const panel = client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel('));

  assert.match(panel, /<span>Collection<\/span>/);
  assert.match(panel, /<option value="">All pages<\/option>/);
  assert.match(panel, /result\.collections\.map\(\(entry\) => <option key=\{entry\.id\} value=\{entry\.id\}>\{entry\.title\}<\/option>\)/);
  assert.match(panel, /if \(collection\) params\.set\('collection', collection\)/);
  assert.match(panel, /No \$\{kind\} in \$\{collectionName\}/);
  assert.match(panel, /Try another collection or choose All pages\./);
});
