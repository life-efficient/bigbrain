import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { appendUniqueRecentItems, createBottomReachGate } from '../../src/dashboard-client/stream-pagination.js';

const clientUrl = new URL('../../src/dashboard-client/main.jsx', import.meta.url);

async function panelSource() {
  const client = await fs.readFile(clientUrl, 'utf8');
  return client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel('));
}

test('Stream appends new pages without reordering or duplicating earlier results', () => {
  const first = [
    { slug: 'pages/newest', title: 'Newest' },
    { slug: 'pages/middle', title: 'Middle' },
  ];
  const next = [
    { slug: 'pages/middle', title: 'Updated duplicate' },
    { slug: 'pages/oldest', title: 'Oldest' },
  ];

  const merged = appendUniqueRecentItems(first, next, 'pages');

  assert.deepEqual(merged.map((item) => item.slug), [
    'pages/newest', 'pages/middle', 'pages/oldest',
  ]);
  assert.equal(merged[1], first[1], 'already displayed pages keep their first-page position and data');
  assert.equal(first.length, 2, 'the helper must not mutate the response data');
  assert.equal(next.length, 2);
});

test('Stream retains distinct images on the same page while deduplicating page-boundary repeats', () => {
  const first = [
    { slug: 'pages/gallery', image: { path: 'images/a.png' } },
    { slug: 'pages/gallery', image: { path: 'images/b.png' } },
  ];
  const next = [
    { slug: 'pages/gallery', image: { path: 'images/b.png' } },
    { slug: 'pages/gallery', image: { path: 'images/c.png' } },
  ];

  const merged = appendUniqueRecentItems(first, next, 'images');

  assert.deepEqual(merged.map((item) => item.image.path), [
    'images/a.png', 'images/b.png', 'images/c.png',
  ]);
  assert.equal(merged[1], first[1]);
});

test('Stream deduplicates URL-only images at page boundaries', () => {
  const first = [{ slug: 'pages/gallery', image: { url: '/api/media/one' } }];
  const next = [
    { slug: 'pages/gallery', image: { url: '/api/media/one' } },
    { slug: 'pages/gallery', image: { url: '/api/media/two' } },
  ];

  const merged = appendUniqueRecentItems(first, next, 'images');

  assert.deepEqual(merged.map((item) => item.image.url), ['/api/media/one', '/api/media/two']);
});

test('bottom reach loads once and cannot chain while the viewport stays parked there', () => {
  const gate = createBottomReachGate(100);
  gate.observe({ scrollTop: 0, clientHeight: 400, scrollHeight: 1000 });
  assert.equal(gate.onScroll({ scrollTop: 510, clientHeight: 400, scrollHeight: 1000 }, true), true);
  assert.equal(gate.onScroll({ scrollTop: 520, clientHeight: 400, scrollHeight: 1000 }, true), false);

  // Appending a page moves the bottom away. A layout or scroll-anchoring event
  // can return the viewport to the bottom, but it is not a new user reach.
  gate.observe({ scrollTop: 520, clientHeight: 400, scrollHeight: 1600 });
  assert.equal(gate.onScroll({ scrollTop: 1110, clientHeight: 400, scrollHeight: 1600 }, false), false);
  assert.equal(gate.onScroll({ scrollTop: 1120, clientHeight: 400, scrollHeight: 1600 }, false), false);
  assert.equal(gate.onScroll({ scrollTop: 1120, clientHeight: 400, scrollHeight: 1600 }, true), false);

  // Only leaving and intentionally re-entering the threshold re-arms it.
  assert.equal(gate.onScroll({ scrollTop: 800, clientHeight: 400, scrollHeight: 1600 }, false), false);
  assert.equal(gate.onScroll({ scrollTop: 1110, clientHeight: 400, scrollHeight: 1600 }, true), true);
});

test('a list that fits the viewport does not auto-fetch every cursor', () => {
  const gate = createBottomReachGate();
  gate.observe({ scrollTop: 0, clientHeight: 700, scrollHeight: 300 });
  assert.equal(gate.onScroll({ scrollTop: 0, clientHeight: 700, scrollHeight: 300 }, true), false);
});

test('Stream requests successive offsets and appends the next response rather than replacing the first', async () => {
  const panel = await panelSource();

  assert.match(panel, /limit:\s*String\(STREAM_PAGE_SIZE\)/);
  assert.match(panel, /offset:\s*'0'/);
  assert.match(panel, /offset:\s*String\(nextOffset\)/);
  assert.match(panel, /next_offset/);
  assert.match(panel, /appendUniqueRecentItems\(/);
  assert.match(panel, /items:\s*appendUniqueRecentItems\(current\.items,/);
});

test('Stream resets pagination when activity, content type, or collection changes', async () => {
  const panel = await panelSource();

  assert.match(panel, /\[activity, kind, collection\]/);
  assert.match(panel, /status:\s*'loading',\s*items:\s*\[\]/);
  assert.match(panel, /offset:\s*'0'/);
  const continuation = panel.slice(panel.indexOf('function loadMore()'), panel.indexOf('const timeField'));
  assert.doesNotMatch(continuation, /setSelectedSourceTypes\(/, 'loading another page must keep source choices');
  assert.match(panel, /result\.items\.filter\(\(item\) => allSourcesSelected \|\| selectedSourceTypes\.has\(/);
});

test('Stream exposes continuation, loading, and finished states', async () => {
  const panel = await panelSource();

  assert.doesNotMatch(panel, /Load more (?:pages|images)|`Load more \$\{kind\}`/);
  assert.match(panel, /Scroll for more/);
  assert.match(panel, /Loading more/);
  assert.match(panel, /has_more/);
  assert.match(panel, /No more|You.re all caught up|End of (?:Stream|results)/i);
  assert.match(panel, /moreError \? \(/, 'the retry button is shown only after an error');
  assert.match(panel, /onClick=\{loadMore\}>Try again/, 'failed pages remain retryable');
  assert.match(panel, /onScroll=\{handleStreamScroll\}/);
  assert.match(panel, /completedOffsetsRef\.current\.has\(nextOffset\)/);
  assert.match(panel, /bottomReachGateRef\.current\.onScroll\(event\.currentTarget, intentional\)/);
});

test('Stream source choices come from the API taxonomy rather than a client-side list', async () => {
  const panel = await panelSource();
  const client = await fs.readFile(clientUrl, 'utf8');

  assert.doesNotMatch(client, /const STREAM_SOURCE_TYPES\s*=/);
  assert.match(panel, /sourceTypes:\s*Array\.isArray\(data\.source_types\)\s*\?\s*data\.source_types\s*:\s*\[\]/);
  assert.match(panel, /result\.sourceTypes/);
  assert.match(panel, /sourceTypes\.map\(/);
});
