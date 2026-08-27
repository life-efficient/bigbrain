const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,254}$/;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

export async function upsertPlaybookRecord(db, input) {
  const key = normalizeRecordKey(input);
  const dataJson = JSON.stringify(normalizeJsonObject(input?.data, 'data'));
  const schemaVersion = normalizeSchemaVersion(input?.schemaVersion);
  const now = normalizeTimestamp(input?.now ?? new Date(), 'now');

  if (db.backend === 'postgres') {
    await db.query(`
      INSERT INTO playbook_records (
        owner_key, playbook_id, record_type, scope_key, data_json, schema_version, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (owner_key, playbook_id, record_type, scope_key) DO UPDATE SET
        data_json = EXCLUDED.data_json,
        schema_version = EXCLUDED.schema_version,
        updated_at = EXCLUDED.updated_at
    `, [key.ownerKey, key.playbookId, key.recordType, key.scopeKey, dataJson, schemaVersion, now, now]);
  } else {
    sqlite(db).prepare(`
      INSERT INTO playbook_records (
        owner_key, playbook_id, record_type, scope_key, data_json, schema_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_key, playbook_id, record_type, scope_key) DO UPDATE SET
        data_json = excluded.data_json,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at
    `).run(key.ownerKey, key.playbookId, key.recordType, key.scopeKey, dataJson, schemaVersion, now, now);
  }

  return getPlaybookRecord(db, key);
}

export async function getPlaybookRecord(db, input) {
  const key = normalizeRecordKey(input);
  if (db.backend === 'postgres') {
    const result = await db.query(`
      SELECT owner_key, playbook_id, record_type, scope_key, data_json, schema_version, created_at, updated_at
      FROM playbook_records
      WHERE owner_key = $1 AND playbook_id = $2 AND record_type = $3 AND scope_key = $4
    `, [key.ownerKey, key.playbookId, key.recordType, key.scopeKey]);
    return normalizeRecordRow(result.rows[0]);
  }

  const row = sqlite(db).prepare(`
    SELECT owner_key, playbook_id, record_type, scope_key, data_json, schema_version, created_at, updated_at
    FROM playbook_records
    WHERE owner_key = ? AND playbook_id = ? AND record_type = ? AND scope_key = ?
  `).get(key.ownerKey, key.playbookId, key.recordType, key.scopeKey);
  return normalizeRecordRow(row);
}

export async function listPlaybookRecords(db, options = {}) {
  const ownerKey = normalizeIdentifier(options.ownerKey, 'ownerKey');
  const playbookId = normalizeIdentifier(options.playbookId, 'playbookId');
  const recordType = options.recordType == null ? null : normalizeIdentifier(options.recordType, 'recordType');
  const scopeKeyPrefix = options.scopeKeyPrefix == null ? null : normalizeIdentifier(options.scopeKeyPrefix, 'scopeKeyPrefix');
  const limit = normalizeListLimit(options.limit);
  const cursor = normalizeCursor(options.cursor);

  if (db.backend === 'postgres') {
    const result = await db.query(`
      SELECT owner_key, playbook_id, record_type, scope_key, data_json, schema_version, created_at, updated_at
      FROM playbook_records
      WHERE owner_key = $1
        AND playbook_id = $2
        AND ($3::text IS NULL OR record_type = $3)
        AND ($4::text IS NULL OR scope_key = $4 OR scope_key LIKE $4 || '/%')
      ORDER BY record_type, scope_key
      OFFSET $5
      LIMIT $6
    `, [ownerKey, playbookId, recordType, scopeKeyPrefix, cursor, limit]);
    return result.rows.map(normalizeRecordRow);
  }

  return sqlite(db).prepare(`
    SELECT owner_key, playbook_id, record_type, scope_key, data_json, schema_version, created_at, updated_at
    FROM playbook_records
    WHERE owner_key = ?
      AND playbook_id = ?
      AND (? IS NULL OR record_type = ?)
      AND (? IS NULL OR scope_key = ? OR scope_key LIKE ? || '/%')
    ORDER BY record_type, scope_key
    LIMIT ? OFFSET ?
  `).all(ownerKey, playbookId, recordType, recordType, scopeKeyPrefix, scopeKeyPrefix, scopeKeyPrefix, limit, cursor)
    .map(normalizeRecordRow);
}

export async function deletePlaybookRecord(db, input) {
  const key = normalizeRecordKey(input);
  if (db.backend === 'postgres') {
    const result = await db.query(`
      DELETE FROM playbook_records
      WHERE owner_key = $1 AND playbook_id = $2 AND record_type = $3 AND scope_key = $4
    `, [key.ownerKey, key.playbookId, key.recordType, key.scopeKey]);
    return result.rowCount > 0;
  }

  return sqlite(db).prepare(`
    DELETE FROM playbook_records
    WHERE owner_key = ? AND playbook_id = ? AND record_type = ? AND scope_key = ?
  `).run(key.ownerKey, key.playbookId, key.recordType, key.scopeKey).changes > 0;
}

function normalizeRecordKey(input) {
  if (!input || typeof input !== 'object') throw new Error('A playbook record key is required.');
  return {
    ownerKey: normalizeIdentifier(input.ownerKey, 'ownerKey'),
    playbookId: normalizeIdentifier(input.playbookId, 'playbookId'),
    recordType: normalizeIdentifier(input.recordType, 'recordType'),
    scopeKey: normalizeIdentifier(input.scopeKey, 'scopeKey'),
  };
}

function normalizeIdentifier(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized || !IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${name} must be a non-empty identifier without whitespace or control characters.`);
  }
  return normalized;
}

function normalizeJsonObject(value, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be a JSON object.`);
  return cloneJsonValue(value, name);
}

function cloneJsonValue(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item, `${path}.${key}`)]));
  }
  throw new Error(`${path} must contain only JSON values.`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeSchemaVersion(value) {
  const normalized = value ?? 1;
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new Error('schemaVersion must be a positive safe integer.');
  return normalized;
}

function normalizeTimestamp(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid timestamp.`);
  return date.toISOString();
}

function normalizeListLimit(value) {
  const limit = value ?? DEFAULT_LIST_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}.`);
  }
  return limit;
}

function normalizeCursor(value) {
  const cursor = value ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer.');
  return cursor;
}

function normalizeRecordRow(row) {
  if (!row) return null;
  return {
    owner_key: row.owner_key,
    playbook_id: row.playbook_id,
    record_type: row.record_type,
    scope_key: row.scope_key,
    data: parseJsonObject(row.data_json),
    schema_version: Number(row.schema_version),
    created_at: normalizeTimestamp(row.created_at, 'created_at'),
    updated_at: normalizeTimestamp(row.updated_at, 'updated_at'),
  };
}

function parseJsonObject(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error('Stored playbook record data is not valid JSON.');
  }
  return normalizeJsonObject(parsed, 'stored data');
}

function sqlite(db) {
  if (db?.backend === 'sqlite') return db.raw;
  return db;
}

