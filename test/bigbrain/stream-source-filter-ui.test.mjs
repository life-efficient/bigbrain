import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const clientUrl = new URL('../../src/dashboard-client/main.jsx', import.meta.url);
const dashboardUrl = new URL('../../src/bigbrain/dashboard.js', import.meta.url);

async function streamSource() {
  const client = await fs.readFile(clientUrl, 'utf8');
  return client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel('));
}

test('Stream offers only source types present in the loaded page items', async () => {
  const panel = await streamSource();

  assert.match(panel, /const \[sourceFilter, setSourceFilter\] = useState\(''\)/);
  assert.match(panel, /const sourceCounts = new Map\(\);\s+if \(kind === 'pages'\) \{\s+for \(const item of result\.items\)/);
  assert.match(panel, /graphFlowSourceType\(item\.source_type\)/);
  assert.match(panel, /sourceCounts\.set\(type, \(sourceCounts\.get\(type\) \|\| 0\) \+ 1\)/);
  assert.match(panel, /result\.status === 'ready' && kind === 'pages' && result\.items\.length \? \(/);
  assert.match(panel, /sourceTypes\.map\(\(\[type, count\]\) => \(/);
  assert.match(panel, /<GraphFlowSourceIcon source=\{\{ type \}\}/);
  assert.match(panel, /graphFlowSourceLabel\(/);
});

test('Stream source pills are accessible and only filter visible page entries', async () => {
  const panel = await streamSource();

  assert.match(panel, /role="group" aria-label="Filter Stream pages by source"/);
  assert.match(panel, /aria-pressed=\{!activeSourceFilter\} onClick=\{\(\) => setSourceFilter\(''\)\}/);
  assert.match(panel, /<span>All sources<\/span>/);
  assert.match(panel, /aria-pressed=\{activeSourceFilter === type\} onClick=\{\(\) => setSourceFilter\(type\)\}/);
  assert.match(panel, /const activeSourceFilter = sourceCounts\.has\(sourceFilter\) \? sourceFilter : ''/);
  assert.match(panel, /const visibleItems = kind === 'images'\s+\? galleryItems\s+: result\.items\.filter\(\(item\) => !activeSourceFilter \|\| graphFlowSourceType\(item\.source_type\) === activeSourceFilter\)/);
  assert.doesNotMatch(panel.slice(panel.indexOf('const params = new URLSearchParams'), panel.indexOf('const timeField')), /params\.set\('source/);
});

test('Stream source pills scroll horizontally without changing the full-width image gallery', async () => {
  const dashboard = await fs.readFile(dashboardUrl, 'utf8');

  assert.match(dashboard, /\.recents-source-filter\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(dashboard, /\.recents-source-pill\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(dashboard, /\.recents-source-pill:focus-visible/);
  assert.match(dashboard, /\.recents-gallery\s*\{[^}]*grid-template-columns:/);
});
