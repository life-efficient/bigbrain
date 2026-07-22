import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ROUTING_LEDGER_SCHEMA_VERSION = 1;
export const ROUTE_STATES = Object.freeze([
  'discovered',
  'classified',
  'held',
  'approved',
  'writing',
  'verified',
  'failed',
  'rejected',
]);
export const APPROVAL_STATES = Object.freeze(['pending', 'approved', 'rejected', 'not_required']);
export const CONFIDENCE_BANDS = Object.freeze(['unknown', 'low', 'medium', 'high', 'deterministic']);

const ROUTE_STATE_SET = new Set(ROUTE_STATES);
const DEFAULT_LEASE_DURATION_MS = 10 * 60 * 1000;
const MAX_LIST_LIMIT = 1000;

export function defaultRoutingLedgerPath(env = process.env) {
  if (env.BIGBRAIN_ROUTING_LEDGER_PATH) return path.resolve(env.BIGBRAIN_ROUTING_LEDGER_PATH);
  const machineHome = env.BIGBRAIN_MACHINE_HOME
    ? path.resolve(env.BIGBRAIN_MACHINE_HOME)
    : path.join(path.resolve(env.HOME || os.homedir()), '.config', 'bigbrain');
  return path.join(machineHome, 'routing-ledger.sqlite');
}

export async function openRoutingLedger({
  ledgerPath = null,
  env = process.env,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  const resolvedPath = path.resolve(ledgerPath || defaultRoutingLedgerPath(env));
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(resolvedPath), 0o700).catch(() => {});
  const db = new DatabaseSync(resolvedPath);
  try {
    initializeRoutingLedgerSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }
  await fs.chmod(resolvedPath, 0o600).catch(() => {});
  return new RoutingLedger({ db, ledgerPath: resolvedPath, now, randomUUID });
}

export function initializeRoutingLedgerSchema(db) {
  const currentVersion = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (currentVersion > ROUTING_LEDGER_SCHEMA_VERSION) {
    throw new Error(`Routing ledger schema version ${currentVersion} is newer than supported version ${ROUTING_LEDGER_SCHEMA_VERSION}.`);
  }
  if (currentVersion < 0 || !Number.isInteger(currentVersion)) {
    throw new Error(`Invalid routing ledger schema version: ${currentVersion}.`);
  }

  db.exec('PRAGMA foreign_keys = ON;');
  if (currentVersion === ROUTING_LEDGER_SCHEMA_VERSION) {
    assertRoutingLedgerSchema(db);
    db.exec('PRAGMA journal_mode = WAL;');
    return;
  }

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      metadata_hash TEXT,
      policy_revision TEXT NOT NULL,
      selected_brain_id TEXT,
      decision_state TEXT NOT NULL CHECK (decision_state IN ('discovered', 'classified', 'held', 'approved', 'writing', 'verified', 'failed', 'rejected')),
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      confidence_band TEXT NOT NULL DEFAULT 'unknown' CHECK (confidence_band IN ('unknown', 'low', 'medium', 'high', 'deterministic')),
      approval_state TEXT NOT NULL DEFAULT 'pending' CHECK (approval_state IN ('pending', 'approved', 'rejected', 'not_required')),
      approval_actor_id TEXT,
      approval_at TEXT,
      approval_expires_at TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      destination_verification_ref TEXT,
      last_error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (source, source_item_id)
    );
    CREATE INDEX IF NOT EXISTS routes_state_updated_idx
      ON routes (decision_state, updated_at DESC);
    CREATE TABLE IF NOT EXISTS route_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      actor_id TEXT,
      reason_code TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS route_events_route_idx
      ON route_events (route_id, id);
    `);
    assertRoutingLedgerSchema(db);
    db.exec(`PRAGMA user_version = ${ROUTING_LEDGER_SCHEMA_VERSION};`);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw new Error(`Cannot initialize routing ledger schema version ${ROUTING_LEDGER_SCHEMA_VERSION}: ${error.message}`);
  }
}

function assertRoutingLedgerSchema(db) {
  assertTableColumns(db, 'routes', [
    'id', 'source', 'source_item_id', 'metadata_hash', 'policy_revision',
    'selected_brain_id', 'decision_state', 'reason_codes_json', 'confidence_band',
    'approval_state', 'approval_actor_id', 'approval_at', 'approval_expires_at',
    'lease_token', 'lease_expires_at', 'attempt_count', 'destination_verification_ref',
    'last_error_code', 'created_at', 'updated_at',
  ]);
  assertTableColumns(db, 'route_events', [
    'id', 'route_id', 'event_type', 'from_state', 'to_state', 'actor_id',
    'reason_code', 'created_at',
  ]);
}

function assertTableColumns(db, table, expectedColumns) {
  const actualColumns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  if (actualColumns.length !== expectedColumns.length || expectedColumns.some((column) => !actualColumns.includes(column))) {
    throw new Error(`Routing ledger table ${table} does not match schema version ${ROUTING_LEDGER_SCHEMA_VERSION}.`);
  }
}

export class RoutingLedger {
  constructor({ db, ledgerPath, now, randomUUID }) {
    this.db = db;
    this.ledgerPath = ledgerPath;
    this.now = now;
    this.randomUUID = randomUUID;
  }

  close() {
    this.db.close();
  }

  discover({ source, sourceItemId, metadataHash = null, policyRevision }) {
    const input = normalizeRouteIdentity({ source, sourceItemId });
    const normalizedHash = normalizeMetadataHash(metadataHash);
    const revision = requireOpaque(policyRevision, 'policyRevision');
    const createdAt = this.timestamp();
    const insert = this.db.prepare(`
      INSERT INTO routes (
        source, source_item_id, metadata_hash, policy_revision,
        decision_state, approval_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'discovered', 'pending', ?, ?)
      ON CONFLICT (source, source_item_id) DO NOTHING
    `);

    return this.transaction(() => {
      const result = insert.run(input.source, input.sourceItemId, normalizedHash, revision, createdAt, createdAt);
      const route = this.get(input);
      if (Number(result.changes) > 0) this.insertEvent(route.id, 'discovered', null, 'discovered', null, null, createdAt);
      return { ...route, already_exists: Number(result.changes) === 0 };
    });
  }

  get({ source, sourceItemId }) {
    const input = normalizeRouteIdentity({ source, sourceItemId });
    const row = this.db.prepare('SELECT * FROM routes WHERE source = ? AND source_item_id = ?')
      .get(input.source, input.sourceItemId);
    return row ? decodeRoute(row) : null;
  }

  list({ states = null, source = null, limit = 100 } = {}) {
    const normalizedStates = states === null
      ? null
      : [...new Set((Array.isArray(states) ? states : [states]).map(requireRouteState))];
    const normalizedSource = source === null ? null : requireOpaque(source, 'source');
    const normalizedLimit = normalizeLimit(limit);
    const clauses = [];
    const parameters = [];
    if (normalizedStates?.length) {
      clauses.push(`decision_state IN (${normalizedStates.map(() => '?').join(', ')})`);
      parameters.push(...normalizedStates);
    }
    if (normalizedSource) {
      clauses.push('source = ?');
      parameters.push(normalizedSource);
    }
    parameters.push(normalizedLimit);
    const rows = this.db.prepare(`
      SELECT * FROM routes
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(...parameters);
    return rows.map(decodeRoute);
  }

  recordDecision({
    source,
    sourceItemId,
    decision,
    selectedBrainId = null,
    metadataHash = null,
    policyRevision,
    reasonCodes = [],
    confidenceBand = 'unknown',
  }) {
    const identity = normalizeRouteIdentity({ source, sourceItemId });
    const normalizedDecision = requireOneOf(decision, ['classify', 'hold', 'auto', 'deny'], 'decision');
    const target = {
      classify: { state: 'classified', approval: 'pending' },
      hold: { state: 'held', approval: 'pending' },
      auto: { state: 'approved', approval: 'not_required' },
      deny: { state: 'rejected', approval: 'rejected' },
    }[normalizedDecision];
    const brainId = selectedBrainId === null ? null : requireOpaque(selectedBrainId, 'selectedBrainId');
    if ((normalizedDecision === 'auto' || normalizedDecision === 'hold') && !brainId) {
      throw new Error(`${normalizedDecision} decisions require selectedBrainId.`);
    }
    const revision = requireOpaque(policyRevision, 'policyRevision');
    const normalizedReasons = normalizeReasonCodes(reasonCodes);
    const confidence = requireOneOf(confidenceBand, CONFIDENCE_BANDS, 'confidenceBand');
    const normalizedHash = normalizeMetadataHash(metadataHash);
    const updatedAt = this.timestamp();

    return this.transaction(() => {
      const current = requireExistingRoute(this.get(identity), identity);
      assertTransition(current.decision_state, target.state);
      this.db.prepare(`
        UPDATE routes SET
          metadata_hash = COALESCE(?, metadata_hash),
          policy_revision = ?,
          selected_brain_id = ?,
          decision_state = ?,
          reason_codes_json = ?,
          confidence_band = ?,
          approval_state = ?,
          approval_actor_id = NULL,
          approval_at = NULL,
          approval_expires_at = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          destination_verification_ref = NULL,
          last_error_code = NULL,
          updated_at = ?
        WHERE id = ?
      `).run(
        normalizedHash,
        revision,
        brainId,
        target.state,
        JSON.stringify(normalizedReasons),
        confidence,
        target.approval,
        updatedAt,
        current.id,
      );
      this.insertEvent(current.id, `decision_${normalizedDecision}`, current.decision_state, target.state, null, normalizedReasons[0] || null, updatedAt);
      return this.get(identity);
    });
  }

  approve({ source, sourceItemId, actorId, selectedBrainId = null, expiresAt = null }) {
    const identity = normalizeRouteIdentity({ source, sourceItemId });
    const actor = requireOpaque(actorId, 'actorId');
    const approvedAt = this.timestamp();
    const normalizedExpiry = expiresAt === null ? null : normalizeIsoTimestamp(expiresAt, 'expiresAt');

    return this.transaction(() => {
      const current = requireExistingRoute(this.get(identity), identity);
      assertTransition(current.decision_state, 'approved');
      const brainId = selectedBrainId === null
        ? current.selected_brain_id
        : requireOpaque(selectedBrainId, 'selectedBrainId');
      if (!brainId) throw new Error('Approval requires a selected destination brain.');
      this.db.prepare(`
        UPDATE routes SET selected_brain_id = ?, decision_state = 'approved',
          approval_state = 'approved', approval_actor_id = ?, approval_at = ?,
          approval_expires_at = ?, lease_token = NULL, lease_expires_at = NULL,
          last_error_code = NULL, updated_at = ?
        WHERE id = ?
      `).run(brainId, actor, approvedAt, normalizedExpiry, approvedAt, current.id);
      this.insertEvent(current.id, 'approved', current.decision_state, 'approved', actor, null, approvedAt);
      return this.get(identity);
    });
  }

  reject({ source, sourceItemId, actorId, reasonCode = 'user_rejected' }) {
    const identity = normalizeRouteIdentity({ source, sourceItemId });
    const actor = requireOpaque(actorId, 'actorId');
    const reason = normalizeReasonCode(reasonCode);
    const updatedAt = this.timestamp();

    return this.transaction(() => {
      const current = requireExistingRoute(this.get(identity), identity);
      assertTransition(current.decision_state, 'rejected');
      this.db.prepare(`
        UPDATE routes SET decision_state = 'rejected', approval_state = 'rejected',
          approval_actor_id = ?, approval_at = ?, lease_token = NULL,
          lease_expires_at = NULL, last_error_code = NULL, updated_at = ?
        WHERE id = ?
      `).run(actor, updatedAt, updatedAt, current.id);
      this.insertEvent(current.id, 'rejected', current.decision_state, 'rejected', actor, reason, updatedAt);
      return this.get(identity);
    });
  }

  retry({ source, sourceItemId, actorId = null }) {
    const identity = normalizeRouteIdentity({ source, sourceItemId });
    const actor = actorId === null ? null : requireOpaque(actorId, 'actorId');
    const updatedAt = this.timestamp();

    return this.transaction(() => {
      const current = requireExistingRoute(this.get(identity), identity);
      if (current.decision_state !== 'failed') throw new Error('Only failed routes can be retried.');
      const targetState = ['approved', 'not_required'].includes(current.approval_state) ? 'approved' : 'held';
      this.db.prepare(`
        UPDATE routes SET decision_state = ?, lease_token = NULL,
          lease_expires_at = NULL, last_error_code = NULL, updated_at = ?
        WHERE id = ?
      `).run(targetState, updatedAt, current.id);
      this.insertEvent(current.id, 'retried', 'failed', targetState, actor, null, updatedAt);
      return this.get(identity);
    });
  }

  acquireLease({ source, sourceItemId, durationMs = DEFAULT_LEASE_DURATION_MS }) {
    const identity = normalizeRouteIdentity({ source, sourceItemId });
    const leaseDuration = normalizePositiveInteger(durationMs, 'durationMs');
    const now = this.timestamp();
    const expiresAt = new Date(Date.parse(now) + leaseDuration).toISOString();
    const leaseToken = this.randomUUID();

    return this.transaction(() => {
      const current = requireExistingRoute(this.get(identity), identity);
      if (approvalExpired(current, now)) throw new Error('Route approval has expired.');
      const result = this.db.prepare(`
        UPDATE routes SET decision_state = 'writing', lease_token = ?,
          lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND (
          decision_state = 'approved'
          OR (decision_state = 'writing' AND lease_expires_at <= ?)
        )
      `).run(leaseToken, expiresAt, now, current.id, now);
      if (Number(result.changes) === 0) return null;
      this.insertEvent(current.id, 'lease_acquired', current.decision_state, 'writing', null, null, now);
      return this.get(identity);
    });
  }

  markVerified({ source, sourceItemId, leaseToken, destinationVerificationRef }) {
    return this.completeLease({
      source,
      sourceItemId,
      leaseToken,
      targetState: 'verified',
      eventType: 'verified',
      destinationVerificationRef: requireOpaque(destinationVerificationRef, 'destinationVerificationRef', 512),
      errorCode: null,
    });
  }

  markFailed({ source, sourceItemId, leaseToken, errorCode }) {
    return this.completeLease({
      source,
      sourceItemId,
      leaseToken,
      targetState: 'failed',
      eventType: 'failed',
      destinationVerificationRef: null,
      errorCode: normalizeReasonCode(errorCode),
    });
  }

  listEvents({ source, sourceItemId }) {
    const identity = normalizeRouteIdentity({ source, sourceItemId });
    const route = requireExistingRoute(this.get(identity), identity);
    return this.db.prepare(`
      SELECT event_type, from_state, to_state, actor_id, reason_code, created_at
      FROM route_events WHERE route_id = ? ORDER BY id ASC
    `).all(route.id);
  }

  completeLease({ source, sourceItemId, leaseToken, targetState, eventType, destinationVerificationRef, errorCode }) {
    const identity = normalizeRouteIdentity({ source, sourceItemId });
    const token = requireOpaque(leaseToken, 'leaseToken');
    const updatedAt = this.timestamp();

    return this.transaction(() => {
      const current = requireExistingRoute(this.get(identity), identity);
      assertTransition(current.decision_state, targetState);
      const result = this.db.prepare(`
        UPDATE routes SET decision_state = ?, destination_verification_ref = ?,
          last_error_code = ?, lease_token = NULL, lease_expires_at = NULL,
          updated_at = ?
        WHERE id = ? AND decision_state = 'writing' AND lease_token = ?
          AND lease_expires_at > ?
      `).run(targetState, destinationVerificationRef, errorCode, updatedAt, current.id, token, updatedAt);
      if (Number(result.changes) === 0) throw new Error('The routing lease is missing, expired, or owned by another worker.');
      this.insertEvent(current.id, eventType, 'writing', targetState, null, errorCode, updatedAt);
      return this.get(identity);
    });
  }

  insertEvent(routeId, eventType, fromState, toState, actorId, reasonCode, createdAt) {
    this.db.prepare(`
      INSERT INTO route_events (
        route_id, event_type, from_state, to_state, actor_id, reason_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(routeId, eventType, fromState, toState, actorId, reasonCode, createdAt);
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  timestamp() {
    const value = this.now();
    return normalizeIsoTimestamp(value instanceof Date ? value.toISOString() : value, 'clock');
  }
}

function decodeRoute(row) {
  const { reason_codes_json: reasonCodesJson, ...route } = row;
  return {
    ...route,
    reason_codes: parseJsonArray(reasonCodesJson),
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeRouteIdentity({ source, sourceItemId }) {
  return {
    source: requireOpaque(source, 'source'),
    sourceItemId: requireOpaque(sourceItemId, 'sourceItemId', 256),
  };
}

function normalizeMetadataHash(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('metadataHash must be a SHA-256 hex digest.');
  return normalized;
}

function normalizeReasonCodes(values) {
  if (!Array.isArray(values)) throw new Error('reasonCodes must be an array.');
  return [...new Set(values.map(normalizeReasonCode))];
}

function normalizeReasonCode(value) {
  const normalized = requireOpaque(value, 'reasonCode');
  if (!/^[a-z0-9][a-z0-9_.:-]*$/i.test(normalized)) {
    throw new Error('reasonCode must be an opaque machine-readable code.');
  }
  return normalized;
}

function requireOpaque(value, name, maximumLength = 128) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required.`);
  if (normalized.length > maximumLength || !/^[a-z0-9][a-z0-9._:/-]*$/i.test(normalized)) {
    throw new Error(`${name} must be a short opaque identifier.`);
  }
  return normalized;
}

function requireOneOf(value, allowed, name) {
  const normalized = String(value ?? '').trim();
  if (!allowed.includes(normalized)) throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
  return normalized;
}

function requireRouteState(value) {
  const normalized = String(value ?? '').trim();
  if (!ROUTE_STATE_SET.has(normalized)) throw new Error(`Unknown route state: ${normalized || '(empty)'}.`);
  return normalized;
}

function normalizeLimit(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_LIST_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}.`);
  }
  return normalized;
}

function normalizePositiveInteger(value, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) throw new Error(`${name} must be a positive integer.`);
  return normalized;
}

function normalizeIsoTimestamp(value, name) {
  const timestamp = String(value ?? '').trim();
  const milliseconds = Date.parse(timestamp);
  if (!timestamp || !Number.isFinite(milliseconds)) throw new Error(`${name} must be an ISO timestamp.`);
  return new Date(milliseconds).toISOString();
}

function requireExistingRoute(route, identity) {
  if (!route) throw new Error(`Unknown route: ${identity.source}/${identity.sourceItemId}.`);
  return route;
}

function approvalExpired(route, now) {
  return route.approval_state === 'approved'
    && route.approval_expires_at
    && route.approval_expires_at <= now;
}

function assertTransition(fromState, toState) {
  requireRouteState(fromState);
  requireRouteState(toState);
  const allowed = {
    discovered: new Set(['classified', 'held', 'approved', 'rejected']),
    classified: new Set(['classified', 'held', 'approved', 'rejected']),
    held: new Set(['held', 'approved', 'rejected']),
    approved: new Set(['approved', 'writing', 'rejected']),
    writing: new Set(['writing', 'verified', 'failed']),
    failed: new Set(['classified', 'held', 'approved', 'rejected']),
    verified: new Set(),
    rejected: new Set(),
  };
  if (!allowed[fromState].has(toState)) throw new Error(`Invalid route transition: ${fromState} -> ${toState}.`);
}
