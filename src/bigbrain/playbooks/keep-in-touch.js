import { getPageRecord, listPages } from '../db.js';
import {
  getPlaybookRecord,
  listPlaybookRecords,
  upsertPlaybookRecord,
} from '../playbook-store.js';
import { normalizeCanonicalPageSlug } from '../page-links.js';
import { readBrainPage, updateBrainPage } from '../page-ops.js';

export const KEEP_IN_TOUCH_PLAYBOOK_ID = 'keep-in-touch';
export const KEEP_IN_TOUCH_RECORD_TYPE = 'person';
export const KEEP_IN_TOUCH_SCHEMA_VERSION = 1;

export function keepInTouchOwnerKey(actor = null) {
  return actor?.email ? `member:${String(actor.email).trim().toLowerCase()}` : 'local';
}

export async function buildKeepInTouchPayload(config, db, { actor = null, now = new Date() } = {}) {
  const ownerKey = keepInTouchOwnerKey(actor);
  const [records, people] = await Promise.all([
    listPlaybookRecords(db, {
      ownerKey,
      playbookId: KEEP_IN_TOUCH_PLAYBOOK_ID,
      recordType: KEEP_IN_TOUCH_RECORD_TYPE,
      limit: 500,
    }),
    listPages(db, { type: 'people' }),
  ]);
  const pageMap = new Map(people.map((person) => [person.slug, person]));
  const nowMs = now.getTime();
  const hydratedRecords = records
    .map((record) => hydrateRecord(record, pageMap.get(pageSlugFromScope(record.scope_key)), nowMs))
    .filter(Boolean)
    .sort(compareKeepInTouchRecords);
  const enrolled = new Set(hydratedRecords.map((record) => record.page_slug));
  return {
    playbook: {
      id: KEEP_IN_TOUCH_PLAYBOOK_ID,
      name: 'Keep in Touch',
      schema_version: KEEP_IN_TOUCH_SCHEMA_VERSION,
    },
    brain: {
      brain_id: config.brainId,
      brain_name: config.brainName,
    },
    summary: {
      enrolled: hydratedRecords.length,
      due: hydratedRecords.filter((record) => record.is_due).length,
      overdue: hydratedRecords.filter((record) => record.is_overdue).length,
    },
    records: hydratedRecords,
    people: people
      .filter((person) => !enrolled.has(person.slug))
      .map((person) => ({
        slug: person.slug,
        title: person.title,
        summary: person.summary,
      })),
  };
}

export async function enrollKeepInTouchPerson(config, db, input, { actor = null, now = new Date() } = {}) {
  const pageSlug = requirePersonSlug(input.page_slug);
  await requirePersonPage(db, pageSlug);
  const existing = await getRecord(db, actor, pageSlug);
  const data = {
    status: existing?.data?.status || 'active',
    priority: normalizePriority(input.priority ?? existing?.data?.priority ?? 3),
    stage: normalizeStage(input.stage ?? existing?.data?.stage ?? 'building'),
    cadence_days: normalizeCadence(input.cadence_days ?? existing?.data?.cadence_days ?? 14),
    last_contacted_at: normalizeOptionalTimestamp(input.last_contacted_at ?? existing?.data?.last_contacted_at),
    next_due_at: normalizeOptionalTimestamp(input.next_due_at ?? existing?.data?.next_due_at) || now.toISOString(),
  };
  await saveRecord(db, actor, pageSlug, data, now);
  return buildKeepInTouchPayload(config, db, { actor, now });
}

export async function logKeepInTouchContact(config, db, input, { actor = null, now = new Date() } = {}) {
  const pageSlug = requirePersonSlug(input.page_slug);
  await requirePersonPage(db, pageSlug);
  const existing = await getRecord(db, actor, pageSlug);
  if (!existing) throw new Error(`Keep in Touch person is not enrolled: ${pageSlug}`);
  const contactedAt = normalizeTimestamp(input.contacted_at || now.toISOString(), 'contacted_at');
  const cadenceDays = normalizeCadence(input.cadence_days ?? existing.data.cadence_days ?? 14);
  const nextDue = new Date(Date.parse(contactedAt) + cadenceDays * 24 * 60 * 60 * 1000).toISOString();
  await saveRecord(db, actor, pageSlug, {
    ...existing.data,
    status: 'active',
    cadence_days: cadenceDays,
    last_contacted_at: contactedAt,
    next_due_at: nextDue,
  }, now);

  const page = await readBrainPage({ config, pagePath: pageSlug });
  await updateBrainPage({
    config,
    pagePath: pageSlug,
    body: page.body,
    timelineEntry: `Keep in Touch contact logged${actor?.email ? ` by ${actor.email}` : ''}.`,
  });
  return buildKeepInTouchPayload(config, db, { actor, now });
}

export async function setKeepInTouchPriority(config, db, input, { actor = null, now = new Date() } = {}) {
  const pageSlug = requirePersonSlug(input.page_slug);
  const existing = await getRecord(db, actor, pageSlug);
  if (!existing) throw new Error(`Keep in Touch person is not enrolled: ${pageSlug}`);
  await saveRecord(db, actor, pageSlug, {
    ...existing.data,
    priority: normalizePriority(input.priority),
  }, now);
  return buildKeepInTouchPayload(config, db, { actor, now });
}

export async function snoozeKeepInTouchPerson(config, db, input, { actor = null, now = new Date() } = {}) {
  const pageSlug = requirePersonSlug(input.page_slug);
  const existing = await getRecord(db, actor, pageSlug);
  if (!existing) throw new Error(`Keep in Touch person is not enrolled: ${pageSlug}`);
  const days = normalizeCadence(input.days ?? 7);
  const nextDue = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  await saveRecord(db, actor, pageSlug, {
    ...existing.data,
    status: 'active',
    next_due_at: nextDue,
  }, now);
  return buildKeepInTouchPayload(config, db, { actor, now });
}

async function getRecord(db, actor, pageSlug) {
  return getPlaybookRecord(db, {
    ownerKey: keepInTouchOwnerKey(actor),
    playbookId: KEEP_IN_TOUCH_PLAYBOOK_ID,
    recordType: KEEP_IN_TOUCH_RECORD_TYPE,
    scopeKey: scopeKeyForPage(pageSlug),
  });
}

async function saveRecord(db, actor, pageSlug, data, now) {
  return upsertPlaybookRecord(db, {
    ownerKey: keepInTouchOwnerKey(actor),
    playbookId: KEEP_IN_TOUCH_PLAYBOOK_ID,
    recordType: KEEP_IN_TOUCH_RECORD_TYPE,
    scopeKey: scopeKeyForPage(pageSlug),
    schemaVersion: KEEP_IN_TOUCH_SCHEMA_VERSION,
    data,
    now,
  });
}

async function requirePersonPage(db, pageSlug) {
  const page = await getPageRecord(db, pageSlug);
  if (!page) throw new Error(`Person page not found: ${pageSlug}`);
  if (page.type !== 'people') throw new Error(`Keep in Touch requires a people page: ${pageSlug}`);
  return page;
}

function hydrateRecord(record, page, nowMs) {
  const pageSlug = page?.slug || pageSlugFromScope(record.scope_key);
  if (!pageSlug) return null;
  const data = record.data || {};
  const dueMs = data.next_due_at ? Date.parse(data.next_due_at) : Number.NaN;
  const isDue = Number.isFinite(dueMs) && dueMs <= nowMs;
  const overdueDays = isDue ? Math.max(0, Math.ceil((nowMs - dueMs) / (24 * 60 * 60 * 1000))) : 0;
  return {
    page_slug: pageSlug,
    title: page?.title || pageSlug,
    summary: page?.summary || '',
    status: data.status || 'active',
    priority: normalizePriority(data.priority ?? 3),
    stage: normalizeStage(data.stage),
    cadence_days: normalizeCadence(data.cadence_days ?? 14),
    last_contacted_at: normalizeOptionalTimestamp(data.last_contacted_at),
    next_due_at: normalizeOptionalTimestamp(data.next_due_at),
    is_due: isDue,
    is_overdue: isDue,
    overdue_days: overdueDays,
    updated_at: record.updated_at,
  };
}

function compareKeepInTouchRecords(left, right) {
  return normalizePriority(left.priority) - normalizePriority(right.priority)
    || (Date.parse(left.next_due_at || '') || Number.MAX_SAFE_INTEGER) - (Date.parse(right.next_due_at || '') || Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title);
}

function scopeKeyForPage(pageSlug) {
  return `page:${pageSlug}`;
}

function pageSlugFromScope(scopeKey) {
  const value = String(scopeKey || '');
  return value.startsWith('page:') ? value.slice(5) : null;
}

function requirePersonSlug(value) {
  const slug = normalizeCanonicalPageSlug(value);
  if (!slug.startsWith('people/')) throw new Error('Keep in Touch requires a people page slug.');
  return slug;
}

function normalizePriority(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new Error('Keep in Touch priority must be an integer from 1 to 5.');
  return number;
}

function normalizeCadence(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 3650) throw new Error('Keep in Touch cadence must be an integer from 1 to 3650 days.');
  return number;
}

function normalizeStage(value) {
  const normalized = String(value || 'building').trim().toLowerCase();
  if (!['new', 'building', 'maintaining', 'paused'].includes(normalized)) throw new Error('Keep in Touch stage is invalid.');
  return normalized;
}

function normalizeOptionalTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeTimestamp(value, 'timestamp');
}

function normalizeTimestamp(value, name) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Keep in Touch ${name} must be a valid timestamp.`);
  return date.toISOString();
}
