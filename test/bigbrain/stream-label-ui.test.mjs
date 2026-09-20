import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const clientUrl = new URL('../../src/dashboard-client/main.jsx', import.meta.url);
const dashboardUrl = new URL('../../src/bigbrain/dashboard.js', import.meta.url);

test('dashboard calls the activity view Stream while keeping its existing internal identifiers', async () => {
  const client = await fs.readFile(clientUrl, 'utf8');
  const panel = client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel('));

  assert.match(client, /\{ id: 'recents', label: 'Stream', shortcut: 'R' \}/);
  assert.match(client, /\['recents', 'Recent files'\]/);
  assert.match(panel, /<h1>Stream<\/h1>/);
  assert.match(panel, /<section className="recents-panel" aria-label="Stream">/);
  assert.match(panel, /aria-label="Stream activity"/);
  assert.match(panel, /aria-label="Loading Stream"/);
  assert.match(panel, /Stream is off in demo mode/);
  assert.match(panel, /Stream is unavailable/);
  assert.match(panel, /Restart BigBrain to load Stream\./);
  assert.match(panel, /fetchJson\(`\/api\/recents\?\$\{params\}`/);
  assert.doesNotMatch(panel, />Recents</);
  assert.doesNotMatch(client, /\['recents', 'Recents'\]/);
});

test('Recents API path remains compatible but its validation message names Stream', async () => {
  const dashboard = await fs.readFile(dashboardUrl, 'utf8');

  assert.match(dashboard, /requestUrl\.pathname === '\/api\/recents'/);
  assert.match(dashboard, /new Error\('Stream requires activity=updated\|added\|viewed and kind=pages\|images\.'\)/);
});
