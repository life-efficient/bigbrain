import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { syncBrain } from '../../src/bigbrain/sync.js';
import { getOverlayRecord, upsertOverlayRecord } from '../../src/bigbrain/overlay-store.js';
import {
  buildKeepInTouchPayload, buildKeepInTouchDuePayload, enrollKeepInTouchPerson,
  setKeepInTouchFrequency, logKeepInTouchContact, snoozeKeepInTouchPerson,
} from '../../src/bigbrain/overlays/keep-in-touch.js';
import { buildKeepInTouchReviewPayload, recordKeepInTouchReview } from '../../src/bigbrain/overlays/keep-in-touch-review.js';

const now = new Date('2026-10-10T10:00:00.000Z');
const pageSlug = 'people/jen-gale';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-kit-none-'));
  const brainHome = path.join(root, 'brain');
  const init = await initializeBrainHome(brainHome, { env: {
    ...process.env, BIGBRAIN_POINTER_PATH: path.join(root, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(root, 'state'),
  } });
  const personPath = path.join(brainHome, `${pageSlug}.md`);
  await fs.mkdir(path.dirname(personPath), { recursive: true });
  await fs.writeFile(personPath, '---\ntitle: Jen Gale\n---\n# Jen Gale\n\nWe discussed a data centre introduction by email.\n');
  const modifiedAt = new Date('2026-10-09T10:00:00.000Z');
  await fs.utimes(personPath, modifiedAt, modifiedAt);
  const config = await loadConfig({ configPath: init.configPath });
  await syncBrain({ config, apiKey: null });
  const db = await openDatabase(config);
  t.after(async () => {
    await db.close?.();
    db.raw.close?.();
    await fs.rm(root, { recursive: true, force: true });
  });
  const original = await fs.readFile(personPath, 'utf8');
  await enrollKeepInTouchPerson(config, db, {
    page_slug: pageSlug, frequency_days: 7, last_contacted_at: '2026-09-01T10:00:00Z', next_due_at: '2026-09-08T10:00:00Z',
  }, { now });
  return { config, db, personPath, original };
}

async function stored(db) {
  return getOverlayRecord(db, { ownerKey: 'local', overlayId: 'keep-in-touch', recordType: 'person', scopeKey: `page:${pageSlug}` });
}

async function exclude(config, db) {
  return setKeepInTouchFrequency(config, db, { page_slug: pageSlug, frequency_days: null }, { now });
}

test('None removes an overdue person from enrollment and due queues without changing the person page', async (t) => {
  const { config, db, personPath, original } = await fixture(t);
  const result = await exclude(config, db);
  assert.deepEqual(result.summary, { enrolled: 0, due: 0, overdue: 0 });
  assert.equal(result.records[0].frequency_days, null);
  assert.equal(result.records[0].next_due_at, null);
  assert.equal(result.records[0].is_due, false);
  assert.equal(result.records[0].is_overdue, false);
  const record = await stored(db);
  assert.equal(record.data.frequency_days, null);
  assert.equal(record.data.next_due_at, null);
  assert.equal(record.data.status, 'paused');
  assert.equal(record.data.last_contacted_at, '2026-09-01T10:00:00.000Z');
  assert.equal(Object.hasOwn(record.data, 'cadence_days'), false);
  assert.deepEqual((await buildKeepInTouchDuePayload(config, db, { asOf: now })).records, []);
  assert.equal(await fs.readFile(personPath, 'utf8'), original);

  // Old due dates and legacy cadence fields must never override an explicit None.
  await upsertOverlayRecord(db, { ownerKey: 'local', overlayId: 'keep-in-touch', recordType: 'person', scopeKey: `page:${pageSlug}`,
    data: { ...record.data, cadence_days: 7, next_due_at: '2026-01-01T00:00:00Z' }, now });
  const hydrated = await buildKeepInTouchPayload(config, db, { now });
  assert.equal(hydrated.records[0].frequency_days, null);
  assert.equal(hydrated.records[0].is_due, false);
  assert.equal(hydrated.records[0].is_overdue, false);
  assert.equal(hydrated.summary.enrolled, 0);
});

test('daily review preserves explicit None and rejects automatic reenrollment', async (t) => {
  const { config, db } = await fixture(t);
  await exclude(config, db);
  const frozen = await buildKeepInTouchReviewPayload(config, db, { asOf: now });
  assert.equal(frozen.review.candidates[0].registry.enrolled, false);
  assert.equal(frozen.review.candidates[0].registry.excluded, true);
  assert.equal(frozen.review.candidates[0].registry.frequency_days, null);
  const input = { review_id: frozen.review.review_id, as_of: frozen.review.as_of,
    limit: frozen.review.limit, cursor_before: frozen.review.cursor_before };
  const decision = { page_slug: pageSlug, reason: 'User explicitly removed this person from Keep in Touch.',
    evidence: ['Explicit None frequency in the private overlay.'], confidence: 'high' };
  await assert.rejects(recordKeepInTouchReview(config, db, { ...input, decisions: [{ ...decision, outcome: 'added' }] }));
  await assert.rejects(recordKeepInTouchReview(config, db, { ...input,
    decisions: [{ ...decision, outcome: 'frequency_changed', frequency_days: 7 }] }));
  await assert.rejects(recordKeepInTouchReview(config, db, { ...input, decisions: [{ ...decision, outcome: 'due' }] }));
  const recorded = await recordKeepInTouchReview(config, db, { ...input, decisions: [{ ...decision, outcome: 'no_change' }] });
  assert.equal(recorded.review.status, 'recorded');
  assert.equal(recorded.review.summary.no_change, 1);
  assert.equal((await stored(db)).data.frequency_days, null);
});

test('contact logging and snoozing cannot silently reactivate a None frequency', async (t) => {
  const { config, db } = await fixture(t);
  await exclude(config, db);
  const unchanged = await enrollKeepInTouchPerson(config, db, { page_slug: pageSlug, priority: 2 }, { now });
  assert.equal(unchanged.records[0].frequency_days, null);
  assert.equal(unchanged.summary.enrolled, 0);
  const logged = await logKeepInTouchContact(config, db, { page_slug: pageSlug, contacted_at: '2026-10-07T12:00:00Z' }, { now });
  assert.equal(logged.records[0].last_contacted_at, '2026-10-07T12:00:00.000Z');
  assert.equal(logged.records[0].frequency_days, null);
  assert.equal(logged.records[0].next_due_at, null);
  assert.equal(logged.records[0].status, 'paused');
  try { await snoozeKeepInTouchPerson(config, db, { page_slug: pageSlug, days: 7 }, { now }); }
  catch (error) { assert.match(error.message, /frequency|excluded|paused|enrolled|None/i); }
  const after = await stored(db);
  assert.equal(after.data.frequency_days, null);
  assert.equal(after.data.next_due_at, null);
  assert.equal(after.data.status, 'paused');
});

test('explicit frequency changes restore None and omitted frequency is not mistaken for None', async (t) => {
  const { config, db } = await fixture(t);
  await exclude(config, db);
  await assert.rejects(setKeepInTouchFrequency(config, db, { page_slug: pageSlug }, { now }), /frequency/i);
  assert.equal((await stored(db)).data.frequency_days, null);
  const restored = await setKeepInTouchFrequency(config, db, { page_slug: pageSlug, frequency_days: 14 }, { now });
  assert.equal(restored.records[0].frequency_days, 14);
  assert.equal(restored.records[0].status, 'active');
  assert.equal(restored.records[0].next_due_at, '2026-09-15T10:00:00.000Z');
  assert.equal(restored.summary.enrolled, 1);
  await exclude(config, db);
  const enrolled = await enrollKeepInTouchPerson(config, db, { page_slug: pageSlug, cadence_days: 7 }, { now });
  assert.equal(enrolled.records[0].frequency_days, 7);
  assert.equal(enrolled.records[0].status, 'active');
  assert.equal(enrolled.summary.enrolled, 1);
});
