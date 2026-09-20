import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Recents shows a collection selector and sends the selection to its API', async () => {
  const client = await fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8');
  const panel = client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel('));

  assert.match(panel, /className="recents-collection-shell"/);
  assert.match(panel, /aria-haspopup="menu"/);
  assert.match(panel, /aria-label="Collections"/);
  assert.match(panel, /selectedCollection\?\.title \|\| collection \|\| 'All collections'/);
  assert.match(panel, /<span>All collections<\/span>/);
  assert.match(panel, /result\.collections\.map\(\(entry\) => \(/);
  assert.match(panel, /role="menuitemradio" aria-checked=\{collection === entry\.id\}/);
  assert.match(panel, /if \(collection\) params\.set\('collection', collection\)/);
  assert.match(panel, /No \$\{kind\} in \$\{collectionName\}/);
  assert.match(panel, /Try another collection or choose All collections\./);
});
