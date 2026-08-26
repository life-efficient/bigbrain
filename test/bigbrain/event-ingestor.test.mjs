import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyEventState,
  hmacSignature,
  normalizeRssItem,
  parseRssFeed,
  rssRawPath,
  sidecarPathForRaw,
  stableRssItemKey,
  timingSafeSignatureMatches,
  upsertRssItemInPageBody,
  validateEventEnvelope,
} from '../../src/bigbrain/event-ingestor.js';

const fixture = `<?xml version="1.0"?><rss><channel><title>OpenAI News</title><item><title><![CDATA[How loveholidays is making everyone a builder with Codex]]></title><description><![CDATA[Discover how teams build faster.]]></description><link>https://openai.com/index/loveholidays</link><guid isPermaLink="true">https://openai.com/index/loveholidays</guid><pubDate>Wed, 26 Aug 2026 00:00:00 GMT</pubDate><category><![CDATA[Company]]></category></item></channel></rss>`;

test('parses RSS items and creates stable raw paths', () => {
  const feed = parseRssFeed(fixture);
  assert.equal(feed.title, 'OpenAI News');
  assert.equal(feed.items.length, 1);
  const item = normalizeRssItem(feed.items[0]);
  assert.equal(item.title, 'How loveholidays is making everyone a builder with Codex');
  assert.equal(item.publishedAt, '2026-08-26T00:00:00.000Z');
  const source = { id: 'openai-news', raw_collection: 'organizations', raw_prefix: 'openai-news' };
  const rawPath = rssRawPath(source, item, new Date('2026-08-26T13:00:00.000Z'));
  assert.match(rawPath, /^organizations\/\.raw\/openai-news-2026-08-26-how-loveholidays-is-making-everyone-a-builder-with-codex-[a-f0-9]{10}\.xml$/);
  assert.equal(sidecarPathForRaw(rawPath).endsWith('.md'), true);
  assert.equal(stableRssItemKey('openai-news', item), stableRssItemKey('openai-news', item));
});

test('upserts the feed section once and keeps the newest item first', () => {
  const source = { id: 'openai-news', url: 'https://openai.com/news/rss.xml' };
  const item = normalizeRssItem(parseRssFeed(fixture).items[0]);
  const first = upsertRssItemInPageBody('# OpenAI\n\n## Context\n- Existing context.', {
    source,
    item,
    rawPath: 'organizations/.raw/openai-news.xml',
    retrievedAt: '2026-08-26T13:00:00.000Z',
    now: new Date('2026-08-26T13:00:00.000Z'),
  });
  assert.equal(first.changed, true);
  const second = upsertRssItemInPageBody(first.body, {
    source,
    item,
    rawPath: 'organizations/.raw/openai-news.xml',
    retrievedAt: '2026-08-26T13:00:00.000Z',
    now: new Date('2026-08-26T13:00:00.000Z'),
  });
  assert.equal(second.changed, false);
  assert.equal((second.body.match(/\[How loveholidays is making everyone a builder with Codex\]/g) || []).length, 1);
});

test('validates event envelopes and HMAC signatures', () => {
  const event = validateEventEnvelope({ id: 'evt-1', source: 'openai-news', type: 'rss.item', payload: { title: 'x' } });
  assert.equal(event.id, 'evt-1');
  const signature = hmacSignature('{"ok":true}', 'secret');
  assert.equal(timingSafeSignatureMatches(signature, signature), true);
  assert.equal(timingSafeSignatureMatches(signature, `${signature}x`), false);
  assert.deepEqual(createEmptyEventState(), { version: 1, sources: {}, received_events: {} });
  assert.throws(() => validateEventEnvelope({ id: 'evt-2', source: 'x', type: 'y' }), /payload/);
});
