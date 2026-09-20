import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const clientUrl = new URL('../../src/dashboard-client/main.jsx', import.meta.url);
const dashboardUrl = new URL('../../src/bigbrain/dashboard.js', import.meta.url);

async function sources() {
  const [client, dashboard] = await Promise.all([
    fs.readFile(clientUrl, 'utf8'),
    fs.readFile(dashboardUrl, 'utf8'),
  ]);
  return {
    panel: client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel(')),
    client,
    dashboard,
  };
}

test('Stream offers its first-class provenance sources even when their current count is zero', async () => {
  const { panel, client } = await sources();
  const choices = client.match(/const STREAM_SOURCE_TYPES\s*=\s*\[([\s\S]*?)\];/)?.[1];

  assert.ok(choices, 'Stream should have a stable, first-class source list');
  for (const source of ['whatsapp', 'substack', 'youtube']) {
    assert.match(choices, new RegExp(`['"]${source}['"]`));
  }
  assert.match(panel, /const sourceCounts = new Map\(\)/);
  assert.match(panel, /graphFlowSourceType\(item\.source_type\)/);
  assert.match(panel, /const sourceTypes = STREAM_SOURCE_TYPES\.map\(/);
  assert.match(panel, /sourceTypes\.map\(\(\[type, count\]\) => \(/);
  assert.match(client, /youtube:\s*'YouTube'/);
  assert.match(client, /youtube:\s*Youtube/);
});

test('Stream source buttons support multi-select and a fixed leading icon-only all/none toggle', async () => {
  const { panel } = await sources();
  const filter = panel.slice(panel.indexOf('className="recents-source-filter"'), panel.indexOf("{result.status === 'ready' && !visibleItems.length"));

  assert.match(panel, /const \[selectedSourceTypes, setSelectedSourceTypes\] = useState\(null\)/);
  assert.match(filter, /role="group" aria-label="Filter Stream pages by source"/);
  assert.match(filter, /aria-pressed=\{allSourcesSelected \|\| selectedSourceTypes\.has\(type\)\}/);
  assert.match(filter, /<GraphFlowSourceIcon source=\{\{ type \}\}/);
  assert.match(filter, /graphFlowSourceLabel\(type\)/);
  assert.match(filter, /recents-source-toggle-all/);
  assert.match(filter, /aria-label=\{allSourcesSelected \? 'Deselect all sources' : 'Select all sources'\}/);
  assert.match(filter, /aria-pressed=\{allSourcesSelected\}/);
  assert.match(filter, /onClick=\{\(\) => setSelectedSourceTypes\(allSourcesSelected \? new Set\(\) : null\)\}/);
  assert.match(filter, /allSourcesSelected \? <SquareCheckBig[^>]*> : <Square[^>]*>/);
  assert.match(filter, /className="recents-source-filter"[^>]*>\s*<button[^>]*recents-source-toggle-all/);
  assert.match(filter, /<div className="recents-source-strip">\s*\{sourceTypes\.map\(/);
  assert.ok(filter.indexOf('recents-source-toggle-all') < filter.indexOf('recents-source-strip'), 'all/none control must precede the scrolling source strip');
  assert.ok(filter.indexOf('recents-source-strip') < filter.indexOf('sourceTypes.map('), 'source choices belong inside the scrolling strip');
  assert.doesNotMatch(filter, />All sources<|<span>All sources<|<small>\{result\.items\.length\}<\/small>/);
  assert.match(panel, /setSelectedSourceTypes\(/);
  assert.match(panel, /const next = current === null\s*\? new Set\(STREAM_SOURCE_TYPES\.filter\(\(sourceType\) => sourceType !== type\)\)/);
  assert.match(panel, /result\.items\.filter\(/);
  assert.match(panel, /No sources selected/);
  assert.doesNotMatch(panel.slice(panel.indexOf('const params = new URLSearchParams'), panel.indexOf('const timeField')), /params\.set\('source/);
});

test('Stream source pills scroll independently of the leading toggle and stay keyboard accessible', async () => {
  const { dashboard } = await sources();
  const filterRule = dashboard.match(/\.recents-source-filter\s*\{([^}]*)\}/)?.[1] || '';
  const stripRule = dashboard.match(/\.recents-source-strip\s*\{([^}]*)\}/)?.[1] || '';
  const toggleRule = dashboard.match(/\.recents-source-toggle-all\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(filterRule, /display:\s*flex/);
  assert.doesNotMatch(filterRule, /overflow-x:\s*auto/, 'outer row must not scroll or clip its leading toggle');
  assert.match(stripRule, /flex:\s*1/);
  assert.match(stripRule, /min-width:\s*0/, 'scroll strip must shrink within a narrow viewport');
  assert.match(stripRule, /overflow-x:\s*auto/, 'only source pills should scroll horizontally');
  assert.match(toggleRule, /flex:\s*0\s+0\s+(?:auto|[0-9]+px)/, 'toggle must keep its width when the strip shrinks');
  assert.doesNotMatch(toggleRule, /position:\s*(?:sticky|absolute|fixed)|box-shadow:/, 'toggle must not overlay source pills');
  assert.match(dashboard, /\.recents-source-pill\s*\{[^}]*padding:\s*0\s+[0-9]+px/);
  assert.match(dashboard, /\.recents-source-pill:focus-visible/);
  assert.match(dashboard, /\.recents-source-toggle-all:focus-visible/);
  assert.match(dashboard, /\.recents-source-pill-icon\s+\.graph-flow-card-source/);
  assert.match(dashboard, /\.graph-flow-card-source-whatsapp\s*\{[^}]*color:/);
  assert.match(dashboard, /\.graph-flow-card-source-substack\s*\{[^}]*color:/);
  assert.match(dashboard, /\.graph-flow-card-source-youtube\s*\{[^}]*color:/);
  assert.match(dashboard, /\.recents-source-pill(?:\.active|\[aria-pressed="true"\])\s*\{/);
  assert.match(dashboard, /\.recents-gallery\s*\{[^}]*grid-template-columns:/);
});
