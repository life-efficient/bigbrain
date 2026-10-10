import { queryPagesByFrontmatter } from '../frontmatter-query.js';
import {
  getOverlayRecord,
  upsertOverlayRecord,
  withOverlayTransaction,
} from '../overlay-store.js';
import {
  KEEP_IN_TOUCH_CURSOR_RECORD_TYPE,
  KEEP_IN_TOUCH_DEFAULT_FREQUENCY_DAYS,
  KEEP_IN_TOUCH_FREQUENCIES_DAYS,
  KEEP_IN_TOUCH_OVERLAY_ID,
  KEEP_IN_TOUCH_REVIEW_RECORD_TYPE,
  KEEP_IN_TOUCH_SCHEMA_VERSION,
  buildKeepInTouchPayload,
  getKeepInTouchSettings,
  listAllKeepInTouchPersonRecords,
  keepInTouchOwnerKey,
  keepInTouchRecordFrequency,
} from './keep-in-touch.js';

const KEEP_IN_TOUCH_CURSOR_SCOPE_KEY = 'daily-review';
const REVIEW_SCOPE_PREFIX = 'run:';
const REVIEW_OUTCOMES = Object.freeze(['added', 'frequency_changed', 'due', 'no_change', 'needs_review']);
const REVIEW_CONFIDENCE = new Set(['low', 'medium', 'high']);
const PAGE_QUERY_LIMIT = 100;
export const KEEP_IN_TOUCH_DEFAULT_REVIEW_LIMIT = 20;
export const KEEP_IN_TOUCH_MAX_REVIEW_LIMIT = 100;

export async function buildKeepInTouchReviewPayload(config, db, {
  actor = null,
  asOf = new Date(),
  limit = KEEP_IN_TOUCH_DEFAULT_REVIEW_LIMIT,
} = {}) {
  const normalizedAsOf = normalizeTimestamp(asOf, 'as_of');
  const normalizedLimit = normalizeReviewLimit(limit);
  const settings = await getSettings(db, actor);
  const cursorBefore = await getCursor(db, actor);
  if (!settings.enabled) {
    return {
      overlay: {
        id: KEEP_IN_TOUCH_OVERLAY_ID,
        name: 'Keep in Touch',
        schema_version: KEEP_IN_TOUCH_SCHEMA_VERSION,
        enabled: false,
      },
      brain: { brain_id: config.brainId, brain_name: config.brainName },
      review: {
        status: 'disabled',
        paused: true,
        review_id: null,
        as_of: normalizedAsOf,
        limit: normalizedLimit,
        cursor_before: cursorBefore,
        candidates: [],
        summary: emptySummary(),
      },
    };
  }

  const candidates = await listReviewCandidates(db, {
    asOf: normalizedAsOf,
    cursorBefore,
    limit: normalizedLimit,
  });
  const queue = await buildKeepInTouchPayload(config, db, { actor, now: new Date(normalizedAsOf) });
  const currentBySlug = new Map(queue.records.map((record) => [record.page_slug, record]));
  const reviewId = reviewIdFor({ asOf: normalizedAsOf, cursorBefore, limit: normalizedLimit });
  return {
    overlay: queue.overlay,
    brain: queue.brain,
    review: {
      status: 'ready',
      paused: false,
      review_id: reviewId,
      as_of: normalizedAsOf,
      limit: normalizedLimit,
      cursor_before: cursorBefore,
      cursor_after: cursorAfter(candidates, cursorBefore),
      candidates: candidates.map((page) => ({
        page_slug: page.slug,
        title: page.title,
        summary: page.summary,
        updated_at: page.updated_at,
        registry: registrySnapshot(currentBySlug.get(page.slug)),
      })),
      due_records: queue.records.filter((record) => record.is_due).map(compactDueRecord),
      summary: {
        ...emptySummary(),
        scanned: candidates.length,
        due_now: queue.records.filter((record) => record.is_due).length,
        overdue: queue.records.filter((record) => record.is_overdue).length,
      },
    },
  };
}

export async function recordKeepInTouchReview(config, db, input, { actor = null, now = new Date() } = {}) {
  const normalizedAsOf = normalizeTimestamp(input?.as_of, 'as_of');
  const normalizedLimit = normalizeReviewLimit(input?.limit);
  const cursorBefore = normalizeCursor(input?.cursor_before);
  const reviewId = requireText(input?.review_id, 'review_id');
  if (reviewId !== reviewIdFor({ asOf: normalizedAsOf, cursorBefore, limit: normalizedLimit })) {
    throw new Error('Keep in Touch review_id does not match as_of and cursor_before.');
  }

  return withOverlayTransaction(db, async (transactionDb) => {
    const ownerKey = keepInTouchOwnerKey(actor);
    const storedReview = await getOverlayRecord(transactionDb, {
      ownerKey,
      overlayId: KEEP_IN_TOUCH_OVERLAY_ID,
      recordType: KEEP_IN_TOUCH_REVIEW_RECORD_TYPE,
      scopeKey: reviewScopeKey(reviewId),
    });
    if (storedReview?.data?.result) return storedReview.data.result;

    const settings = await getSettings(transactionDb, actor);
    if (!settings.enabled) throw new Error('Keep in Touch is disabled; the review was not recorded.');
    const currentCursor = await getCursor(transactionDb, actor);
    assertSameCursor(currentCursor, cursorBefore);
    const candidates = await listReviewCandidates(transactionDb, {
      asOf: normalizedAsOf,
      cursorBefore,
      limit: normalizedLimit,
    });
    const decisions = normalizeDecisions(input?.decisions, candidates, normalizedAsOf);
    const records = await listAllKeepInTouchPersonRecords(transactionDb, ownerKey);
    const recordsBySlug = new Map(records.map((record) => [pageSlugFromScope(record.scope_key), record]));
    const applied = [];

    for (const decision of decisions) {
      const existing = recordsBySlug.get(decision.page_slug) || null;
      if (decision.outcome === 'added') {
        if (existing) throw new Error(`Keep in Touch decision marked an enrolled person as added: ${decision.page_slug}`);
        const frequencyDays = decision.frequency_days ?? KEEP_IN_TOUCH_DEFAULT_FREQUENCY_DAYS;
        const lastContactedAt = normalizeOptionalTimestamp(decision.last_contacted_at);
        const nextDueAt = lastContactedAt
          ? addDays(lastContactedAt, frequencyDays)
          : normalizedAsOf;
        const data = {
          status: 'active',
          priority: 3,
          stage: 'building',
          frequency_days: frequencyDays,
          last_contacted_at: lastContactedAt,
          next_due_at: nextDueAt,
        };
        const saved = await upsertPersonRecord(transactionDb, ownerKey, decision.page_slug, data, now);
        recordsBySlug.set(decision.page_slug, saved);
        applied.push({ ...decision, before_frequency_days: null, after_frequency_days: frequencyDays, next_due_at: nextDueAt });
        continue;
      }

      if (decision.outcome === 'frequency_changed') {
        if (!existing) throw new Error(`Keep in Touch frequency change requires an enrolled person: ${decision.page_slug}`);
        const beforeFrequency = frequencyFromRecord(existing);
        if (beforeFrequency === null) throw new Error(`Keep in Touch frequency is None for ${decision.page_slug}; only an explicit user frequency change can re-enable it.`);
        if (beforeFrequency === decision.frequency_days) {
          throw new Error(`Keep in Touch frequency change did not change the frequency: ${decision.page_slug}`);
        }
        const lastContactedAt = normalizeOptionalTimestamp(existing.data?.last_contacted_at);
        const nextDueAt = lastContactedAt ? addDays(lastContactedAt, decision.frequency_days) : normalizedAsOf;
        const data = {
          ...existing.data,
          frequency_days: decision.frequency_days,
          last_contacted_at: lastContactedAt,
          next_due_at: nextDueAt,
        };
        delete data.cadence_days;
        const saved = await upsertPersonRecord(transactionDb, ownerKey, decision.page_slug, data, now);
        recordsBySlug.set(decision.page_slug, saved);
        applied.push({ ...decision, before_frequency_days: beforeFrequency, after_frequency_days: decision.frequency_days, next_due_at: nextDueAt });
        continue;
      }

      if (decision.outcome === 'due' && (!existing || !recordIsDue(existing, normalizedAsOf))) {
        throw new Error(`Keep in Touch due decision is invalid for ${decision.page_slug}.`);
      }
      applied.push({
        ...decision,
        before_frequency_days: existing ? frequencyFromRecord(existing) : null,
        after_frequency_days: existing ? frequencyFromRecord(existing) : null,
      });
    }

    const queue = await buildKeepInTouchPayload(config, transactionDb, { actor, now: new Date(normalizedAsOf) });
    const nextCursor = cursorAfter(candidates, cursorBefore);
    const result = {
      overlay: queue.overlay,
      brain: queue.brain,
      review: {
        status: 'recorded',
        paused: false,
        review_id: reviewId,
        as_of: normalizedAsOf,
        limit: normalizedLimit,
        cursor_before: cursorBefore,
        cursor_after: nextCursor,
        recorded_at: normalizeTimestamp(now, 'recorded_at'),
        items: applied.map((item) => ({
          ...item,
          page_title: candidates.find((page) => page.slug === item.page_slug)?.title || item.page_slug,
          page_updated_at: candidates.find((page) => page.slug === item.page_slug)?.updated_at || null,
        })),
        due_records: queue.records.filter((record) => record.is_due).map(compactDueRecord),
        summary: summarizeApplied(applied, queue.records),
      },
    };

    await upsertOverlayRecord(transactionDb, {
      ownerKey,
      overlayId: KEEP_IN_TOUCH_OVERLAY_ID,
      recordType: KEEP_IN_TOUCH_REVIEW_RECORD_TYPE,
      scopeKey: reviewScopeKey(reviewId),
      schemaVersion: KEEP_IN_TOUCH_SCHEMA_VERSION,
      data: {
        review_id: reviewId,
        as_of: normalizedAsOf,
        limit: normalizedLimit,
        cursor_before: cursorBefore,
        cursor_after: nextCursor,
        decisions: applied,
        result,
        recorded_at: normalizeTimestamp(now, 'recorded_at'),
      },
      now,
    });
    await upsertOverlayRecord(transactionDb, {
      ownerKey,
      overlayId: KEEP_IN_TOUCH_OVERLAY_ID,
      recordType: KEEP_IN_TOUCH_CURSOR_RECORD_TYPE,
      scopeKey: KEEP_IN_TOUCH_CURSOR_SCOPE_KEY,
      schemaVersion: KEEP_IN_TOUCH_SCHEMA_VERSION,
      data: nextCursor || { updated_at: null, page_slug: null },
      now,
    });
    return result;
  });
}

async function getSettings(db, actor) {
  return getKeepInTouchSettings(db, { actor });
}

async function getCursor(db, actor) {
  const record = await getOverlayRecord(db, {
    ownerKey: keepInTouchOwnerKey(actor),
    overlayId: KEEP_IN_TOUCH_OVERLAY_ID,
    recordType: KEEP_IN_TOUCH_CURSOR_RECORD_TYPE,
    scopeKey: KEEP_IN_TOUCH_CURSOR_SCOPE_KEY,
  });
  if (!record?.data?.updated_at) return null;
  return normalizeCursor(record.data);
}

async function listReviewCandidates(db, { asOf, cursorBefore, limit }) {
  const filters = [
    { field: 'updated_at', operator: 'lte', value: asOf, value_type: 'timestamp' },
  ];
  if (cursorBefore?.updated_at) {
    filters.push({ field: 'updated_at', operator: 'gte', value: cursorBefore.updated_at, value_type: 'timestamp' });
  }
  const pages = [];
  let cursor = 0;
  while (pages.length < limit) {
    const result = await queryPagesByFrontmatter({
      db,
      type: 'people',
      filters,
      orderBy: [
        { field: 'updated_at', direction: 'asc', value_type: 'timestamp' },
        { field: 'slug', direction: 'asc' },
      ],
      limit: PAGE_QUERY_LIMIT,
      cursor,
      includeTotal: true,
      asOf,
    });
    pages.push(...result.pages.filter((page) => isAfterCursor(page, cursorBefore)));
    if (result.next_cursor === null) break;
    cursor = result.next_cursor;
  }
  return pages.slice(0, limit);
}

async function upsertPersonRecord(db, ownerKey, pageSlug, data, now) {
  return upsertOverlayRecord(db, {
    ownerKey,
    overlayId: KEEP_IN_TOUCH_OVERLAY_ID,
    recordType: 'person',
    scopeKey: `page:${pageSlug}`,
    schemaVersion: KEEP_IN_TOUCH_SCHEMA_VERSION,
    data,
    now,
  });
}

function normalizeDecisions(value, candidates, asOf) {
  if (!Array.isArray(value)) throw new Error('Keep in Touch review decisions must be an array.');
  const candidateSlugs = new Set(candidates.map((page) => page.slug));
  const seen = new Set();
  const decisions = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each Keep in Touch review decision must be an object.');
    const pageSlug = String(item.page_slug || '').trim();
    if (!candidateSlugs.has(pageSlug)) throw new Error(`Keep in Touch review decision is not in the review window: ${pageSlug || '(missing page_slug)'}`);
    if (seen.has(pageSlug)) throw new Error(`Keep in Touch review contains duplicate decisions for ${pageSlug}.`);
    seen.add(pageSlug);
    const outcome = String(item.outcome || '').trim().toLowerCase();
    if (!REVIEW_OUTCOMES.includes(outcome)) throw new Error(`Unsupported Keep in Touch review outcome: ${outcome || '(missing)'}.`);
    const reason = requireText(item.reason, `reason for ${pageSlug}`);
    const evidence = normalizeEvidence(item.evidence, pageSlug);
    const confidence = String(item.confidence || '').trim().toLowerCase();
    if (!REVIEW_CONFIDENCE.has(confidence)) throw new Error(`Keep in Touch confidence for ${pageSlug} must be low, medium, or high.`);
    const decision = { page_slug: pageSlug, outcome, reason, evidence, confidence };
    if (item.frequency_days !== undefined && item.frequency_days !== null) decision.frequency_days = normalizeFrequency(item.frequency_days, pageSlug);
    if (item.last_contacted_at !== undefined) decision.last_contacted_at = normalizeOptionalTimestamp(item.last_contacted_at);
    if (outcome === 'added' && decision.frequency_days === undefined) decision.frequency_days = KEEP_IN_TOUCH_DEFAULT_FREQUENCY_DAYS;
    if (outcome === 'frequency_changed' && decision.frequency_days === undefined) throw new Error(`Keep in Touch frequency_changed requires frequency_days for ${pageSlug}.`);
    if (decision.last_contacted_at && Date.parse(decision.last_contacted_at) > Date.parse(asOf)) throw new Error(`Keep in Touch last_contacted_at cannot be after as_of for ${pageSlug}.`);
    return decision;
  });
  if (seen.size !== candidateSlugs.size) {
    const missing = [...candidateSlugs].filter((slug) => !seen.has(slug));
    throw new Error(`Keep in Touch review must include one decision for every candidate. Missing: ${missing.join(', ')}`);
  }
  return decisions;
}

function normalizeEvidence(value, pageSlug) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Keep in Touch evidence for ${pageSlug} must contain at least one non-empty string.`);
  }
  return value.map((item) => item.trim());
}

function normalizeFrequency(value, pageSlug) {
  const number = Number(value);
  if (!KEEP_IN_TOUCH_FREQUENCIES_DAYS.includes(number)) {
    throw new Error(`Keep in Touch frequency for ${pageSlug} must be one of: ${KEEP_IN_TOUCH_FREQUENCIES_DAYS.join(', ')} days.`);
  }
  return number;
}

function normalizeReviewLimit(value) {
  const number = value === null || value === undefined || value === ''
    ? KEEP_IN_TOUCH_DEFAULT_REVIEW_LIMIT
    : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > KEEP_IN_TOUCH_MAX_REVIEW_LIMIT) {
    throw new Error(`Keep in Touch review limit must be an integer from 1 to ${KEEP_IN_TOUCH_MAX_REVIEW_LIMIT}.`);
  }
  return number;
}

function frequencyFromRecord(record) {
  return keepInTouchRecordFrequency(record?.data);
}

function recordIsDue(record, asOf) {
  return Boolean(frequencyFromRecord(record) !== null && record?.data?.status !== 'paused'
    && record?.data?.stage !== 'paused' && record?.data?.next_due_at
    && Date.parse(record.data.next_due_at) <= Date.parse(asOf));
}

function registrySnapshot(record) {
  if (!record) return null;
  return {
    enrolled: record.frequency_days !== null,
    excluded: record.frequency_days === null,
    frequency_days: record.frequency_days,
    last_contacted_at: record.last_contacted_at,
    next_due_at: record.next_due_at,
    is_due: record.is_due,
    is_overdue: record.is_overdue,
  };
}

function compactDueRecord(record) {
  return {
    page_slug: record.page_slug,
    title: record.title,
    summary: record.summary,
    frequency_days: record.frequency_days,
    last_contacted_at: record.last_contacted_at,
    next_due_at: record.next_due_at,
    is_overdue: record.is_overdue,
    overdue_days: record.overdue_days,
  };
}

function summarizeApplied(items, queue) {
  return {
    scanned: items.length,
    added: items.filter((item) => item.outcome === 'added').length,
    frequency_changed: items.filter((item) => item.outcome === 'frequency_changed').length,
    due: items.filter((item) => item.outcome === 'due').length,
    no_change: items.filter((item) => item.outcome === 'no_change').length,
    needs_review: items.filter((item) => item.outcome === 'needs_review').length,
    due_now: queue.filter((record) => record.is_due).length,
    overdue: queue.filter((record) => record.is_overdue).length,
  };
}

function emptySummary() {
  return { scanned: 0, added: 0, frequency_changed: 0, due: 0, no_change: 0, needs_review: 0, due_now: 0, overdue: 0 };
}

function normalizeCursor(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Keep in Touch cursor must be an object or null.');
  if (!value.updated_at) throw new Error('Keep in Touch cursor requires updated_at.');
  return {
    updated_at: normalizeTimestamp(value.updated_at, 'cursor.updated_at'),
    page_slug: value.page_slug ? String(value.page_slug).trim() : '',
  };
}

function cursorAfter(candidates, cursorBefore) {
  const last = candidates.at(-1);
  return last ? { updated_at: last.updated_at, page_slug: last.slug } : cursorBefore;
}

function isAfterCursor(page, cursor) {
  if (!cursor) return true;
  const pageTime = Date.parse(page.updated_at);
  const cursorTime = Date.parse(cursor.updated_at);
  return pageTime > cursorTime || (pageTime === cursorTime && page.slug > cursor.page_slug);
}

function assertSameCursor(left, right) {
  if ((left?.updated_at || null) !== (right?.updated_at || null) || (left?.page_slug || '') !== (right?.page_slug || '')) {
    throw new Error('Keep in Touch review cursor is stale. Start a new review before recording decisions.');
  }
}

function reviewIdFor({ asOf, cursorBefore, limit }) {
  const cursorPart = cursorBefore ? `${cursorBefore.updated_at}:${cursorBefore.page_slug}` : 'start';
  return `daily-${compactId(asOf)}-limit-${limit}-${compactId(cursorPart)}`.slice(0, 240);
}

function reviewScopeKey(reviewId) {
  return `${REVIEW_SCOPE_PREFIX}${reviewId}`;
}

function pageSlugFromScope(scopeKey) {
  const value = String(scopeKey || '');
  return value.startsWith('page:') ? value.slice(5) : null;
}

function compactId(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'start';
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`Keep in Touch ${label} is required.`);
  return text;
}

function normalizeOptionalTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeTimestamp(value, 'timestamp');
}

function normalizeTimestamp(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Keep in Touch ${label} must be a valid timestamp.`);
  return date.toISOString();
}

function addDays(value, days) {
  return new Date(Date.parse(value) + days * 24 * 60 * 60 * 1000).toISOString();
}
