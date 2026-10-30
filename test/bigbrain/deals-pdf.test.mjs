import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readAnonymisedDeals, buildDealsPdf } from '../../src/bigbrain/overlays/deals-pdf.js';
import { buildDealIntroductionsPayload } from '../../src/bigbrain/overlays/deals.js';

function fixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE pages (slug TEXT PRIMARY KEY, path TEXT, type TEXT, page_kind TEXT,
    title TEXT, summary TEXT, updated_at TEXT, frontmatter_json TEXT, body_text TEXT)`);
  return { db: { backend: 'sqlite', raw }, close: () => raw.close(),
    add(slug, frontmatter = {}, { type = 'deals', kind = 'canonical' } = {}) {
      raw.prepare('INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(slug, `${slug}.md`, type, kind,
        'PRIVATE_TITLE_CANARY', 'PRIVATE_SUMMARY_CANARY', '2026-10-29', JSON.stringify(frontmatter), 'PRIVATE_BODY_CANARY');
    } };
}
const anonymous = { deal_involvement: 'active', anonymised_title: 'European infrastructure', anonymised_description: 'Capacity for cloud services.', anonymised_asks: [] };

test('PDF projection loads beyond 100 and admits only anonymised fields', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 137; i++) f.add(`deals/private-${i}`, { ...anonymous, anonymised_title: `Anonymous ${i}`, tasks: ['PRIVATE_TASK'], parties: ['PRIVATE_PARTY'], asks: ['PRIVATE_LEGACY'], teaser_summary: 'PRIVATE_LEGACY_SUMMARY' });
    f.add('deals/unrelated', { ...anonymous, deal_involvement: 'public_unrelated' });
    f.add('deals/source', anonymous, { kind: 'attachment' });
    const records = await readAnonymisedDeals(f.db);
    assert.equal(records.length, 137);
    assert.ok(records.some(r => r.title === 'Anonymous 136'));
    assert.deepEqual(Object.keys(records[0]).sort(), ['asks', 'description', 'stage', 'stage_comment', 'stage_label', 'title']);
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE_|private-|public_unrelated/);
  } finally { f.close(); }
});

test('missing anonymised fields never fall back to internal or legacy text', async () => {
  for (const patch of [{ anonymised_title: '' }, { anonymised_description: null }, { anonymised_asks: [''] }, { anonymised_asks: null }]) {
    const f = fixture();
    try {
      f.add('deals/private', { ...anonymous, ...patch, asks: ['PRIVATE_LEGACY'], teaser_summary: 'PRIVATE_LEGACY_DESCRIPTION' });
      await assert.rejects(buildDealsPdf({}, f.db), e => e.statusCode === 422 && !/PRIVATE_|deals\//.test(e.message));
    } finally { f.close(); }
  }
});

test('PDF uses embedded Unicode fonts, complete asks and multiple pages', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 15; i++) f.add(`deals/${i}`, { ...anonymous, anonymised_title: `Développement ${i} – São Paulo`, anonymised_description: 'A complete project description. '.repeat(i === 0 ? 500 : 60), anonymised_asks: ['Capital for phased delivery.', 'An operating partner.'] });
    const pdf = await buildDealsPdf({}, f.db, { generatedAt: new Date('2026-10-29T12:00:00Z') });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const raw = pdf.toString('latin1');
    assert.match(raw, /%%EOF/);
    assert.match(raw, /\/FontFile2/);
    assert.ok((raw.match(/\/Type \/Page\b/g) || []).length > 1);
    assert.doesNotMatch(raw, /PRIVATE_|deals\//);
  } finally { f.close(); }
});

test('unsupported characters fail instead of silently losing anonymised content', async () => {
  const f = fixture();
  try {
    f.add('deals/unsupported', { ...anonymous, anonymised_title: 'Project 🦄' });
    await assert.rejects(buildDealsPdf({}, f.db), /font cannot display/);
  } finally { f.close(); }
});

test('introduction list includes unenrolled parents and paginates with linked tasks', async () => {
  const f = fixture();
  try {
    f.add('deals/not-enrolled', {});
    f.add('people/party', {}, { type: 'people' });
    for (let i = 0; i < 103; i++) f.add(`deal_introductions/${String(i).padStart(3, '0')}`, { deal: 'deals/not-enrolled', parties: ['people/party'], stage: 'proposed', purpose: 'Commercial introduction' }, { type: 'deal_introductions' });
    f.add('tasks/follow-up', { source: ['deal_introductions/000'], status: 'waiting', waiting_on: ['people/party'] }, { type: 'tasks' });
    const first = await buildDealIntroductionsPayload({}, f.db);
    assert.equal(first.total, 103); assert.equal(first.records.length, 100); assert.equal(first.next_cursor, 100);
    assert.equal(first.records[0].parent_deal.page_slug, 'deals/not-enrolled');
    assert.equal(first.records[0].tasks[0].waiting_on[0].page_slug, 'people/party');
    const second = await buildDealIntroductionsPayload({}, f.db, { cursor: first.next_cursor });
    assert.equal(second.records.length, 3); assert.equal(second.next_cursor, null);
  } finally { f.close(); }
});


test('footer stays on the content page instead of creating a trailing page', async () => {
  const f = fixture();
  try {
    f.add('deals/one', anonymous);
    const pdf = await buildDealsPdf({}, f.db);
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
  } finally { f.close(); }
});


test('PDF excludes archived and legacy paused or dropped deals before checking shareable fields', async () => {
 const f=fixture();try {
 f.add('deals/active',anonymous);
 for(const [slug,metadata] of [['archived',{deal_status:'archived',deal_stage:'qualifying'}],['paused',{deal_stage:'paused'}],['dropped',{deal_stage:'dropped'}]]) f.add(`deals/${slug}`,{deal_involvement:'active',...metadata});
 assert.deepEqual(await readAnonymisedDeals(f.db),[{title:anonymous.anonymised_title,description:anonymous.anonymised_description,asks:[], stage: 'unknown', stage_label: 'Stage not established', stage_comment: ''}]);
 } finally {f.close();}
});

test('selected PDF exports only requested active deals through the anonymised projection', async () => {
  const f = fixture();
  try {
    f.add('deals/selected', { ...anonymous, anonymised_title: 'Selected project', anonymised_asks: ['A delivery partner.'] });
    f.add('deals/unselected', { ...anonymous, anonymised_title: 'Unselected 🦄', anonymised_description: '' });
    const options = { pageSlugs: ['deals/selected', 'deals/selected'] };
    assert.deepEqual(await readAnonymisedDeals(f.db, options), [
      { title: 'Selected project', description: anonymous.anonymised_description, asks: ['A delivery partner.'], stage: 'unknown', stage_label: 'Stage not established', stage_comment: '' },
    ]);
    const pdf = await buildDealsPdf({}, f.db, options);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.doesNotMatch(pdf.toString('latin1'), /PRIVATE_|deals\//);
    await assert.rejects(buildDealsPdf({}, f.db), /anonymised title or description/);
  } finally { f.close(); }
});

test('explicit empty, malformed, missing or ineligible PDF selections never export all deals', async () => {
  const f = fixture();
  try {
    f.add('deals/active', anonymous);
    f.add('deals/archived', { ...anonymous, deal_status: 'archived' });
    f.add('deals/unrelated', { ...anonymous, deal_involvement: 'public_unrelated' });
    f.add('deals/attachment', anonymous, { kind: 'attachment' });
    for (const pageSlugs of [[], null, 'deals/active', [null], [''], ['people/private'],
      ['deals/../active'], ['deals/active '], ['deals/missing'], ['deals/archived'],
      ['deals/unrelated'], ['deals/attachment'], ['deals/active', 'deals/missing']]) {
      await assert.rejects(buildDealsPdf({}, f.db, { pageSlugs }),
        error => error.statusCode === 422 && !/PRIVATE_|deals\//.test(error.message));
    }
  } finally { f.close(); }
});

test('selected export retains pagination and requires complete anonymised fields', async () => {
  const f = fixture();
  try {
    const pageSlugs = Array.from({ length: 105 }, (_, i) => `deals/selected-${i}`);
    for (const slug of pageSlugs) f.add(slug, anonymous);
    f.add('deals/not-selected', anonymous);
    assert.equal((await readAnonymisedDeals(f.db, { pageSlugs })).length, 105);
    f.add('deals/incomplete', { ...anonymous, anonymised_asks: null });
    await assert.rejects(buildDealsPdf({}, f.db, { pageSlugs: ['deals/incomplete'] }), /incomplete anonymised asks/);
  } finally { f.close(); }
});


test('export includes safe stage progress and excludes explicitly non-shareable records', async () => {
 const f = fixture();
 try {
  f.add('deals/shareable', { ...anonymous, deal_stage: 'qualifying', anonymised_stage_comment: 'The owner is confirming the power allocation.', stage_comment: 'PRIVATE_ROUTE' });
  f.add('deals/restricted', { deal_involvement: 'active', shareable: false });
  const records = await readAnonymisedDeals(f.db);
  assert.equal(records.length, 1);
  assert.equal(records[0].stage_label, 'Qualifying');
  assert.equal(records[0].stage_comment, 'The owner is confirming the power allocation.');
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_/);
  await assert.rejects(readAnonymisedDeals(f.db, { pageSlugs: ['deals/restricted'] }), /no longer available/);
  const pdf = await buildDealsPdf({}, f.db);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
 } finally { f.close(); }
});

test('invalid stages never leak arbitrary text and invalid comments fail safely', async () => {
 const f = fixture();
 try {
  f.add('deals/unknown', { ...anonymous, deal_stage: 'PRIVATE_STAGE', stage_comment: 'PRIVATE_COMMENT' });
  assert.equal((await readAnonymisedDeals(f.db))[0].stage, 'unknown');
  assert.doesNotMatch(JSON.stringify(await readAnonymisedDeals(f.db)), /PRIVATE_/);
  f.add('deals/bad-comment', { ...anonymous, anonymised_stage_comment: { name: 'PRIVATE_PERSON' } });
  await assert.rejects(readAnonymisedDeals(f.db), /invalid anonymised stage comment/);
 } finally { f.close(); }
});
