import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import {
  buildKeepInTouchReviewPayload,
  recordKeepInTouchReview,
} from '../../src/bigbrain/overlays/keep-in-touch-review.js';
import {
  buildKeepInTouchPayload,
  setKeepInTouchEnabled,
} from '../../src/bigbrain/overlays/keep-in-touch.js';
import { getOverlayRecord } from '../../src/bigbrain/overlay-store.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('Keep in Touch reviews every changed people page and advances its private cursor atomically', async () => {
  const fixture = await createFixture('bigbrain-keep-in-touch-review-');
  try {
    const alicePath = await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice Example
---
# Alice Example

Alice messaged me about the new project and I want to keep the relationship warm.
`);
    await writeMarkdown(fixture.brainHome, 'people/research-subject.md', `---
title: Research Subject
---
# Research Subject

Research notes about a company leader. No direct relationship or contact.
`);
    const firstUpdate = new Date('2026-08-27T08:00:00.000Z');
    await fs.utimes(alicePath, firstUpdate, firstUpdate);
    const researchPath = path.join(fixture.brainHome, 'people/research-subject.md');
    await fs.utimes(researchPath, firstUpdate, firstUpdate);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);

    const first = await buildKeepInTouchReviewPayload(config, db, {
      asOf: '2026-08-28T08:00:00.000Z',
      limit: 1,
    });
    assert.equal(first.review.status, 'ready');
    assert.equal(first.review.limit, 1);
    assert.deepEqual(first.review.candidates.map((page) => page.page_slug), ['people/alice']);
    assert.equal(first.review.candidates[0].registry, null);

    const recorded = await recordKeepInTouchReview(config, db, {
      review_id: first.review.review_id,
      as_of: first.review.as_of,
      limit: first.review.limit,
      cursor_before: first.review.cursor_before,
      decisions: [
        {
          page_slug: 'people/alice',
          outcome: 'added',
          reason: 'The page records a direct message and an active intention to maintain the relationship.',
          evidence: ['Alice messaged me about the new project.'],
          confidence: 'high',
        },
      ],
    });
    assert.equal(recorded.review.status, 'recorded');
    assert.deepEqual(recorded.review.summary, {
      scanned: 1,
      added: 1,
      frequency_changed: 0,
      due: 0,
      no_change: 0,
      needs_review: 0,
      due_now: 1,
      overdue: 0,
    });
    assert.equal(recorded.review.items[0].after_frequency_days, 7);
    assert.equal(recorded.review.due_records[0].page_slug, 'people/alice');

    const repeated = await recordKeepInTouchReview(config, db, {
      review_id: first.review.review_id,
      as_of: first.review.as_of,
      limit: first.review.limit,
      cursor_before: first.review.cursor_before,
      decisions: [],
    });
    assert.deepEqual(repeated, recorded);

    const cursor = await getOverlayRecord(db, {
      ownerKey: 'local',
      overlayId: 'keep-in-touch',
      recordType: 'cursor',
      scopeKey: 'daily-review',
    });
    assert.deepEqual(cursor.data, { updated_at: first.review.cursor_after.updated_at, page_slug: 'people/alice' });
    const queue = await buildKeepInTouchPayload(config, db, { now: new Date('2026-08-28T08:00:00.000Z') });
    assert.equal(queue.records[0].frequency_days, 7);
    assert.equal(queue.records[0].cadence_days, 7);
    assert.equal(queue.records[0].next_due_at, '2026-08-28T08:00:00.000Z');

    const backfill = await buildKeepInTouchReviewPayload(config, db, {
      asOf: '2026-08-28T08:00:00.000Z',
      limit: 1,
    });
    assert.deepEqual(backfill.review.candidates.map((page) => page.page_slug), ['people/research-subject']);
    const backfilled = await recordKeepInTouchReview(config, db, {
      review_id: backfill.review.review_id,
      as_of: backfill.review.as_of,
      limit: backfill.review.limit,
      cursor_before: backfill.review.cursor_before,
      decisions: [{
        page_slug: 'people/research-subject',
        outcome: 'no_change',
        reason: 'The page is research about a person without evidence of a direct relationship or contact.',
        evidence: ['Research notes about a company leader.'],
        confidence: 'high',
      }],
    });
    assert.equal(backfilled.review.summary.no_change, 1);

    await fs.appendFile(alicePath, '\nA later page update says we should reconnect soon.\n', 'utf8');
    const secondUpdate = new Date('2026-08-29T08:00:00.000Z');
    await fs.utimes(alicePath, secondUpdate, secondUpdate);
    await syncBrain({ config, apiKey: null });
    const second = await buildKeepInTouchReviewPayload(config, db, {
      asOf: '2026-08-30T08:00:00.000Z',
      limit: 1,
    });
    assert.deepEqual(second.review.candidates.map((page) => page.page_slug), ['people/alice']);
    assert.equal(second.review.candidates[0].registry.frequency_days, 7);
    const changed = await recordKeepInTouchReview(config, db, {
      review_id: second.review.review_id,
      as_of: second.review.as_of,
      limit: second.review.limit,
      cursor_before: second.review.cursor_before,
      decisions: [{
        page_slug: 'people/alice',
        outcome: 'frequency_changed',
        frequency_days: 14,
        reason: 'The newer page context supports maintaining the relationship on a two-week rhythm.',
        evidence: ['A later page update says we should reconnect soon.'],
        confidence: 'medium',
      }],
    });
    assert.equal(changed.review.summary.frequency_changed, 1);
    assert.equal(changed.review.items[0].before_frequency_days, 7);
    assert.equal(changed.review.items[0].after_frequency_days, 14);

    await setKeepInTouchEnabled(config, db, { enabled: false });
    const paused = await buildKeepInTouchReviewPayload(config, db, { asOf: '2026-08-31T08:00:00.000Z' });
    assert.equal(paused.review.status, 'disabled');
    assert.equal(paused.review.paused, true);
    assert.deepEqual(paused.review.candidates, []);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const brainHome = path.join(rootDir, 'brain');
  const env = {
    ...process.env,
    BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
    BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
  };
  const init = await initializeBrainHome(brainHome, { env });
  return { rootDir, brainHome, configPath: init.configPath };
}

async function writeMarkdown(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  return fullPath;
}
