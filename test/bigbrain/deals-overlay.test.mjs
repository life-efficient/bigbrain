import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildDealsPayload } from '../../src/bigbrain/overlays/deals.js';

const config = { brainId: 'personal', brainName: 'Personal Brain' };

function fixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE pages (slug TEXT PRIMARY KEY, path TEXT, type TEXT, page_kind TEXT,
    title TEXT, summary TEXT, updated_at TEXT, frontmatter_json TEXT, body_text TEXT)`);
  return {
    db: { backend: 'sqlite', raw },
    add(slug, involvement, options = {}) {
      raw.prepare('INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        slug, `${slug}.md`, options.type || 'deals', options.kind || 'canonical',
        options.title || slug, options.summary ?? 'A concise deal summary.', '2026-10-10T09:00:00Z',
        JSON.stringify({ ...(involvement === undefined ? {} : { deal_involvement: involvement }), ...options.frontmatter }),
        options.body ?? 'Indexed readable content.',
      );
    },
    close: () => raw.close(),
  };
}

test('deals overlay includes explicit actual and network deals, excluding public and supporting pages', async () => {
  const f = fixture();
  try {
    for (const value of ['active', 'network_actionable', 'network_observed']) f.add(`deals/${value}`, value);
    f.add('deals/public', 'public_unrelated');
    f.add('deals/preparation');
    f.add('deals/attachment', 'active', { kind: 'attachment' });
    f.add('deals/other-kind', 'active', { kind: 'raw' });
    f.add('people/contact', 'active', { type: 'people' });
    f.add('deals-elsewhere/lead', 'active');
    const result = await buildDealsPayload(config, f.db);
    assert.equal(result.total, 3);
    assert.equal(result.overlay.enabled, true);
    assert.equal(result.brain.brain_id, 'personal');
    assert.deepEqual(result.records.map((r) => r.deal_involvement), ['active', 'network_actionable', 'network_observed']);
    assert.deepEqual(Object.keys(result.records[0]).sort(), ['anonymised_asks', 'anonymised_description', 'anonymised_title', 'deal_involvement', 'deal_stage', 'deal_status', 'deal_types', 'edit_values', 'introductions', 'page_slug', 'stage_as_of', 'summary', 'tasks', 'title', 'updated_at']);
    const filtered = await buildDealsPayload(config, f.db, { deal_involvement: 'network_observed' });
    assert.equal(filtered.total, 1);
  } finally { f.close(); }
});

test('deals overlay counts and paginates beyond 100 without losing records', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 137; i++) f.add(`deals/${String(i).padStart(3, '0')}`, 'active');
    const first = await buildDealsPayload(config, f.db);
    assert.equal(first.records.length, 100);
    assert.equal(first.total, 137);
    assert.equal(first.next_cursor, 100);
    const second = await buildDealsPayload(config, f.db, { cursor: first.next_cursor });
    assert.equal(second.records.length, 37);
    assert.equal(second.next_cursor, null);
    assert.equal(new Set([...first.records, ...second.records].map((r) => r.page_slug)).size, 137);
    assert.equal((await buildDealsPayload(config, f.db, { cursor: 200 })).records.length, 0);
  } finally { f.close(); }
});

test('summary fallback is bounded readable indexed text, without exposing full content', async () => {
  const f = fixture();
  try {
    f.add('deals/fallback', 'active', { summary: '  ', body: 'Clear\n\nindexed\tcontent. ' + 'Long content '.repeat(200) });
    f.add('deals/empty', 'active', { summary: '', body: '' });
    const { records } = await buildDealsPayload(config, f.db);
    assert.equal(records[0].summary, '');
    assert.match(records[1].summary, /^Clear indexed content\./);
    assert.ok(records[1].summary.length <= 500);
    assert.equal(records[1].body_text, undefined);
  } finally { f.close(); }
});

test('first-class deal summaries remain complete beyond the fallback excerpt limit', async () => {
  const f = fixture();
  try {
    const summary = 'Complete investment context. '.repeat(40);
    f.add('deals/complete', 'active', { summary });
    const result = await buildDealsPayload(config, f.db);
    assert.equal(result.records[0].summary, summary.trim());
    assert.ok(result.records[0].summary.length > 500);
  } finally { f.close(); }
});

test('malformed pagination and involvement inputs are rejected', async () => {
  const f = fixture();
  try {
    for (const input of [null, [], { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '5' },
      { cursor: -1 }, { cursor: true }, { cursor: Number.MAX_SAFE_INTEGER + 1 },
      { deal_involvement: 'public_unrelated' }, { deal_involvement: ['active'] }]) {
      await assert.rejects(buildDealsPayload(config, f.db, input));
    }
  } finally { f.close(); }
});

test('Postgres query stays parameterized and normalizes timestamps', async () => {
  const calls = [];
  const db = { backend: 'postgres', async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT COUNT')) return { rows: [{ total: '1' }] };
    if (sql.startsWith('SELECT slug')) return { rows: [{ slug: 'deals/a', excerpt: 'Readable fallback.' }] };
    return { rows: [{ slug: 'deals/a', title: 'A', summary: '', updated_at: new Date('2026-10-10T09:00:00Z'),
      frontmatter_json: { deal_involvement: 'active' } }] };
  } };
  const result = await buildDealsPayload(config, db);
  assert.equal(result.records[0].updated_at, '2026-10-10T09:00:00.000Z');
  assert.equal(result.records[0].summary, 'Readable fallback.');
  assert.equal(calls.length, 7);
  assert.ok(calls[0].params.includes('active'));
  assert.match(calls[2].sql, /WHERE slug IN \(\$1\)/);
  assert.deepEqual(calls[2].params, ['deals/a']);
});

 test('teaser fields use only explicit frontmatter and normalize malformed values', async () => {
  const f = fixture();
  try {
    f.add('deals/a', 'active', { frontmatter: { anonymised_asks: [' Equity partner ', '', 42, 'Operator'], anonymised_description: ' Anonymous project. ' } });
    f.add('deals/b', 'active', { frontmatter: { anonymised_asks: 'Not a list', anonymised_description: 42 } });
    const { records } = await buildDealsPayload(config, f.db);
    assert.deepEqual(records[0].anonymised_asks, ['Equity partner', 'Operator']);
    assert.equal(records[0].anonymised_description, 'Anonymous project.');
    assert.deepEqual(records[1].anonymised_asks, []);
    assert.equal(records[1].anonymised_description, '');
  } finally { f.close(); }
});


test('legacy sharing fields migrate on read without overriding explicit canonical values', async () => {
  const f = fixture();
  try {
    f.add('deals/a', 'active', { frontmatter: { asks: [' Legacy ask '], teaser_summary: ' Legacy description ' } });
    f.add('deals/b', 'active', { frontmatter: { anonymised_title: ' Anonymous title ', anonymised_description: '', anonymised_asks: [], asks: ['Old ask'], teaser_summary: 'Old description' } });
    const { records, overlay } = await buildDealsPayload(config, f.db);
    assert.equal(overlay.schema_version, 3);
    assert.deepEqual(records[0].anonymised_asks, ['Legacy ask']);
    assert.equal(records[0].anonymised_description, 'Legacy description');
    assert.equal(records[0].anonymised_title, '');
    assert.equal(records[1].anonymised_title, 'Anonymous title');
    assert.deepEqual(records[1].anonymised_asks, []);
    assert.equal(records[1].anonymised_description, '');
    assert.equal(Object.hasOwn(records[0], 'asks'), false);
    assert.equal(Object.hasOwn(records[0], 'teaser_summary'), false);
  } finally { f.close(); }
});

test('legacy statuses read as archived with unknown stage and explicit status takes precedence', async () => {
 const f=fixture();try {
 for(const stage of ['paused','dropped']) f.add(`deals/${stage}`,'active',{frontmatter:{deal_stage:stage}});
 f.add('deals/restored','active',{frontmatter:{deal_stage:'paused',deal_status:'active'}});
 f.add('deals/current','active',{frontmatter:{deal_stage:'establishing_arrangement'}});
 const records=(await buildDealsPayload(config,f.db)).records;
 for(const stage of ['paused','dropped']) {const r=records.find(p=>p.page_slug===`deals/${stage}`);assert.equal(r.deal_status,'archived');assert.equal(r.deal_stage,'unknown');}
 assert.equal(records.find(p=>p.page_slug==='deals/restored').deal_status,'active');
 assert.equal(records.find(p=>p.page_slug==='deals/current').deal_status,'active');
 assert.equal(records.find(p=>p.page_slug==='deals/current').deal_stage,'unknown');
 }finally{f.close();}
});
