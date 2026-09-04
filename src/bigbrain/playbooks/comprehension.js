import { randomUUID } from 'node:crypto';

import { getPageRecord, listPages } from '../db.js';
import { normalizeCanonicalPageSlug } from '../page-links.js';
import {
  getPlaybookRecord,
  listPlaybookRecords,
  upsertPlaybookRecord,
} from '../playbook-store.js';

export const COMPREHENSION_PLAYBOOK_ID = 'comprehension';
export const COMPREHENSION_SCHEMA_VERSION = 1;
export const COMPREHENSION_SETUP_RECORD_TYPE = 'setup';
export const COMPREHENSION_SESSION_RECORD_TYPE = 'session';

export function comprehensionOwnerKey(actor = null) {
  return actor?.email ? `member:${String(actor.email).trim().toLowerCase()}` : 'local';
}

export async function getComprehensionSetup(db, { actor = null } = {}) {
  const record = await getPlaybookRecord(db, {
    ownerKey: comprehensionOwnerKey(actor),
    playbookId: COMPREHENSION_PLAYBOOK_ID,
    recordType: COMPREHENSION_SETUP_RECORD_TYPE,
    scopeKey: 'user',
  });
  return record?.data || { guidance: '' };
}

export async function updateComprehensionSetup(db, input, { actor = null, now = new Date() } = {}) {
  const guidance = requireGuidance(input?.guidance);
  const record = await upsertPlaybookRecord(db, {
    ownerKey: comprehensionOwnerKey(actor),
    playbookId: COMPREHENSION_PLAYBOOK_ID,
    recordType: COMPREHENSION_SETUP_RECORD_TYPE,
    scopeKey: 'user',
    schemaVersion: COMPREHENSION_SCHEMA_VERSION,
    data: { guidance },
    now,
  });
  return record.data;
}

export async function buildComprehensionPayload(config, db, { actor = null, limit = 50, historyLimit = 50 } = {}) {
  const [setup, sessions, pages] = await Promise.all([
    getComprehensionSetup(db, { actor }),
    listPlaybookRecords(db, {
      ownerKey: comprehensionOwnerKey(actor),
      playbookId: COMPREHENSION_PLAYBOOK_ID,
      recordType: COMPREHENSION_SESSION_RECORD_TYPE,
      limit: 500,
    }),
    listPages(db),
  ]);
  const pageMap = new Map(pages.map((page) => [page.slug, page]));
  const orderedSessions = sessions.sort(compareRecentSessions);
  const latest = latestSessionsByPage(orderedSessions);
  const history = orderedSessions
    .slice(0, normalizeLimit(historyLimit))
    .map((record) => sessionResponse(record));
  const recent = [...latest.values()]
    .map((record) => hydrateSession(record, pageMap.get(pageSlugFromScope(record.scope_key))))
    .sort(compareRecentSessions)
    .slice(0, normalizeLimit(limit));
  return {
    playbook: {
      id: COMPREHENSION_PLAYBOOK_ID,
      name: 'Comprehension',
      schema_version: COMPREHENSION_SCHEMA_VERSION,
    },
    brain: {
      brain_id: config.brainId,
      brain_name: config.brainName,
    },
    setup,
    summary: {
      pages_with_sessions: latest.size,
      recent_pages: recent.length,
      session_history: history.length,
    },
    pages: recent,
    session_history: history,
  };
}

export async function getComprehensionPage(db, pageSlug, { actor = null, limit = 50 } = {}) {
  const slug = requirePageSlug(pageSlug);
  const page = await getPageRecord(db, slug);
  const records = await listPlaybookRecords(db, {
    ownerKey: comprehensionOwnerKey(actor),
    playbookId: COMPREHENSION_PLAYBOOK_ID,
    recordType: COMPREHENSION_SESSION_RECORD_TYPE,
    scopeKeyPrefix: scopeKeyForPage(slug),
    limit: 500,
  });
  const sessions = records
    .sort(compareRecentSessions)
    .slice(0, normalizeLimit(limit))
    .map((record) => sessionResponse(record));
  return {
    page: page ? {
      slug: page.slug,
      title: page.title,
      type: page.type,
      summary: page.summary,
      updated_at: page.updated_at,
    } : null,
    sessions,
    latest_session: sessions[0] || null,
  };
}

export async function saveComprehensionSession(db, input, { actor = null, now = new Date() } = {}) {
  const pageSlug = requirePageSlug(input?.page_slug);
  const page = await getPageRecord(db, pageSlug);
  if (!page) throw new Error(`Comprehension page not found: ${pageSlug}`);
  const summary = requireSummary(input?.summary);
  const sessionId = normalizeSessionId(input?.session_id) || randomUUID();
  const record = await upsertPlaybookRecord(db, {
    ownerKey: comprehensionOwnerKey(actor),
    playbookId: COMPREHENSION_PLAYBOOK_ID,
    recordType: COMPREHENSION_SESSION_RECORD_TYPE,
    scopeKey: `${scopeKeyForPage(pageSlug)}/${sessionId}`,
    schemaVersion: COMPREHENSION_SCHEMA_VERSION,
    data: { summary },
    now,
  });
  return sessionResponse(record);
}

function latestSessionsByPage(records) {
  const latest = new Map();
  for (const record of records) {
    const slug = pageSlugFromScope(record.scope_key);
    if (!slug) continue;
    const existing = latest.get(slug);
    if (!existing || Date.parse(record.updated_at) > Date.parse(existing.updated_at)) latest.set(slug, record);
  }
  return latest;
}

function hydrateSession(record, page) {
  return {
    ...sessionResponse(record),
    title: page?.title || pageSlugFromScope(record.scope_key),
    type: page?.type || null,
    page_summary: page?.summary || '',
    page_updated_at: page?.updated_at || null,
    page_exists: Boolean(page),
  };
}

function sessionResponse(record) {
  const { pageSlug, sessionId } = sessionParts(record.scope_key);
  return {
    page_slug: pageSlug,
    session_id: sessionId,
    summary: record.data.summary,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function compareRecentSessions(left, right) {
  return (Date.parse(right.updated_at) || 0) - (Date.parse(left.updated_at) || 0)
    || sessionPageSlug(left).localeCompare(sessionPageSlug(right));
}

function sessionPageSlug(value) {
  return value.page_slug || pageSlugFromScope(value.scope_key) || '';
}

function scopeKeyForPage(pageSlug) {
  return `page:${pageSlug}`;
}

function pageSlugFromScope(scopeKey) {
  const value = String(scopeKey || '');
  if (!value.startsWith('page:')) return null;
  const remainder = value.slice(5);
  const separator = remainder.lastIndexOf('/');
  return separator > 0 ? remainder.slice(0, separator) : remainder;
}

function sessionParts(scopeKey) {
  const remainder = String(scopeKey || '').replace(/^page:/, '');
  const separator = remainder.lastIndexOf('/');
  return separator > 0
    ? { pageSlug: remainder.slice(0, separator), sessionId: remainder.slice(separator + 1) }
    : { pageSlug: remainder, sessionId: null };
}

function requirePageSlug(value) {
  const slug = normalizeCanonicalPageSlug(value);
  if (!slug || slug.startsWith('tasks/')) throw new Error('Comprehension requires a non-task Brain page slug.');
  return slug;
}

function requireGuidance(value) {
  if (typeof value !== 'string') throw new Error('Comprehension guidance must be a string.');
  return value.trim();
}

function requireSummary(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Comprehension session summary is required.');
  return value.trim();
}

function normalizeSessionId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value)) {
    throw new Error('Comprehension session_id must be a simple identifier.');
  }
  return value;
}

function normalizeLimit(value) {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Comprehension limit must be an integer between 1 and 500.');
  return limit;
}
