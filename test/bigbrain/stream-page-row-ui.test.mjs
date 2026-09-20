import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { getGraphTypeIconName } from '../../src/dashboard-client/graph/type-icons.js';

const clientUrl = new URL('../../src/dashboard-client/main.jsx', import.meta.url);
const dashboardUrl = new URL('../../src/bigbrain/dashboard.js', import.meta.url);

test('Stream page rows use the shared page-type icon mapping, not a generic or provenance glyph', async () => {
  const client = await fs.readFile(clientUrl, 'utf8');
  const panel = client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel('));
  const icon = await fs.readFile(new URL('../../src/dashboard-client/graph/graph-type-icon.jsx', import.meta.url), 'utf8');

  assert.equal(getGraphTypeIconName('people'), 'UserRound');
  assert.equal(getGraphTypeIconName('meetings'), 'CalendarDays');
  assert.equal(getGraphTypeIconName('tasks'), 'ListChecks');
  assert.equal(getGraphTypeIconName('videos'), 'Clapperboard');
  assert.equal(typeof getGraphTypeIconName('unregistered-type'), 'string');
  assert.match(client, /import\s*\{\s*PageTypeIcon\s*\}\s*from '\.\/graph\/graph-type-icon\.jsx'/);
  assert.match(icon, /export function PageTypeIcon\(\{ type, size = 20 \}\)/);
  assert.match(icon, /GRAPH_TYPE_ICON_NAMES\[normalizedType\]/);
  assert.match(icon, /ICONS\[getGraphTypeIconName\(normalizedType\)\]/);
  assert.match(icon, /:\s*Shapes/);
  const pageGlyph = panel.match(/<span className="recents-page-glyph"[\s\S]*?<\/span>/)?.[0] || '';
  assert.match(pageGlyph, /role="img" aria-label=\{`\$\{streamPageTypeLabel\(item\.type\)\} page`\}/);
  assert.doesNotMatch(pageGlyph, /GraphFlowSourceIcon/);
  assert.match(panel, /<PageTypeIcon type=\{item\.type\}/);
  assert.doesNotMatch(panel, /recents-page-glyph[^>]*>▤<\/span>/);
  assert.match(panel, /streamPageTypeLabel\(item\.type\)/);
  assert.match(client, /videos:\s*'Video'/);
});

test('Stream page subtitle shows a labeled provenance source instead of the page slug', async () => {
  const [client, dashboard] = await Promise.all([
    fs.readFile(clientUrl, 'utf8'),
    fs.readFile(dashboardUrl, 'utf8'),
  ]);
  const panel = client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel('));
  const sourceText = client.slice(client.indexOf('function streamSourceText('), client.indexOf('function RecentsPanel('));
  const payload = dashboard.slice(dashboard.indexOf('export async function buildRecentsPayload('), dashboard.indexOf('async function walkRecentPagePaths('));

  assert.match(payload, /source_message/);
  assert.match(payload, /source_label/);
  assert.match(payload, /source_type/);
  assert.match(sourceText, /item\.source_message\s*\|\|\s*item\.source_label\s*\|\|\s*'Source not recorded'/);
  assert.match(panel, /recents-item-source/);
  assert.match(panel, /title=\{streamSourceText\(item\)\}/);
  assert.match(panel, /<GraphFlowSourceIcon source=\{\{ type: item\.source_type, label: item\.source_label \}\}/);
  assert.doesNotMatch(panel, /<span>\{item\.slug\}<\/span>/);
  assert.match(dashboard, /\.recents-item-source[^\n]*text-overflow:\s*ellipsis/);
});
