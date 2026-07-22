import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MACHINE_CATALOG_VERSION = 2;
export const MACHINE_CATALOG_FILENAME = 'brains.json';

const KINDS = new Set(['local', 'remote']);
const CONNECTION_TYPES = new Set(['local_runtime', 'codex_mcp']);
const VERIFICATION_STATES = new Set(['verified', 'unverified', 'needs_auth', 'unreachable']);
const PROFILE_STATES = new Set(['valid', 'draft', 'missing', 'invalid', 'unknown']);
const AUTH_STATES = new Set(['authenticated', 'local_trusted', 'needs_auth', 'unknown']);
const WRITABILITY_STATES = new Set(['writable', 'read_only', 'approval_required', 'unknown']);
const HEALTH_STATES = new Set(['healthy', 'degraded', 'unreachable', 'unknown']);
const SECRET_KEY = /(?:token|secret|password|authorization|cookie|api[_-]?key|credential)/i;
const BRAIN_ID = /^brn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function defaultMachineCatalogDir(env = process.env) {
  if (env.BIGBRAIN_CONFIG_DIR) return path.resolve(env.BIGBRAIN_CONFIG_DIR);
  return path.join(path.resolve(env.HOME || os.homedir()), '.config', 'bigbrain');
}

export function defaultMachineCatalogPath(env = process.env) {
  return env.BIGBRAIN_CATALOG_PATH
    ? path.resolve(env.BIGBRAIN_CATALOG_PATH)
    : path.join(defaultMachineCatalogDir(env), MACHINE_CATALOG_FILENAME);
}

export function emptyMachineCatalog() {
  return { version: MACHINE_CATALOG_VERSION, active_entry_id: null, brains: [] };
}

export class MachineCatalog {
  constructor({ env = process.env, catalogPath = null, now = () => new Date() } = {}) {
    this.catalogPath = path.resolve(catalogPath || defaultMachineCatalogPath(env));
    this.now = now;
  }

  async load() {
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(this.catalogPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyMachineCatalog();
      if (error instanceof SyntaxError) throw new Error(`Invalid BigBrain machine catalog JSON: ${error.message}`);
      throw error;
    }
    return normalizeMachineCatalog(parsed);
  }

  async save(value) {
    const normalized = normalizeMachineCatalog(value);
    await fs.mkdir(path.dirname(this.catalogPath), { recursive: true });
    const temporaryPath = `${this.catalogPath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporaryPath, this.catalogPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
    return normalized;
  }

  async upsert(input) {
    assertNoSecretFields(input);
    const catalog = await this.load();
    const now = this.now().toISOString();
    const next = normalizeBrainEntry({ ...input, updated_at: now }, { requireCanonicalId: true });
    const duplicateHandle = catalog.brains.find((brain) =>
      brain.brain_id !== next.brain_id
      && brain.connection.handle === next.connection.handle
    );
    if (duplicateHandle) {
      throw new Error(`Connection handle is already assigned to ${duplicateHandle.brain_name}.`);
    }

    const index = catalog.brains.findIndex((brain) => brain.brain_id === next.brain_id);
    if (index >= 0) {
      next.entry_id = catalog.brains[index].entry_id;
      next.created_at = catalog.brains[index].created_at;
      catalog.brains[index] = next;
    } else {
      catalog.brains.push({ ...next, created_at: next.created_at || now });
    }
    return this.save(catalog);
  }

  async remove(brainId) {
    const normalizedId = requireBrainId(brainId);
    const catalog = await this.load();
    const index = catalog.brains.findIndex((brain) => brain.brain_id === normalizedId);
    if (index < 0) throw new Error(`Unknown brain: ${normalizedId}`);
    const [removed] = catalog.brains.splice(index, 1);
    if (catalog.active_entry_id === removed.entry_id) catalog.active_entry_id = null;
    await this.save(catalog);
    return removed;
  }

  async activate(brainId) {
    const normalizedId = requireBrainId(brainId);
    const catalog = await this.load();
    const brain = catalog.brains.find((candidate) => candidate.brain_id === normalizedId);
    if (!brain) throw new Error(`Unknown brain: ${normalizedId}`);
    catalog.active_entry_id = brain.entry_id;
    await this.save(catalog);
    return brain;
  }
}

export function normalizeMachineCatalog(value) {
  requireObject(value, 'BigBrain machine catalog');
  assertNoSecretFields(value);
  if (value.version === 1 || ('activeBrainId' in value && !('active_entry_id' in value))) {
    return migrateRegistryV1(value);
  }
  if (value.version !== MACHINE_CATALOG_VERSION) {
    throw new Error(`Unsupported BigBrain machine catalog version: ${value.version ?? 'missing'}.`);
  }
  if (!Array.isArray(value.brains)) throw new Error('BigBrain machine catalog brains must be an array.');
  const brains = value.brains.map((brain) => normalizeBrainEntry(brain));
  assertCatalogUniqueness(brains);
  const activeEntryId = optionalString(value.active_entry_id);
  return {
    version: MACHINE_CATALOG_VERSION,
    active_entry_id: activeEntryId && brains.some((brain) => brain.entry_id === activeEntryId) ? activeEntryId : null,
    brains,
  };
}

export function migrateRegistryV1(value) {
  requireObject(value, 'BigBrain registry v1');
  if (!Array.isArray(value.brains)) throw new Error('BigBrain registry v1 brains must be an array.');
  const byLegacyId = new Map();
  const brains = [];
  for (const legacy of value.brains) {
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) continue;
    const legacyId = optionalString(legacy.id);
    if (!legacyId) continue;
    const reportedBrainId = optionalString(legacy.brainId || legacy.brain_id || (BRAIN_ID.test(legacyId) ? legacyId : null));
    const brainId = reportedBrainId && BRAIN_ID.test(reportedBrainId) ? reportedBrainId : null;
    const kind = legacy.connectionType === 'service' ? 'remote' : 'local';
    const entryId = brainId || `legacy:${legacyId}`;
    const endpoint = kind === 'remote' ? normalizeEndpoint(legacy.serviceUrl, { allowMissing: true }) : null;
    const handle = kind === 'remote'
      ? optionalString(legacy.connectionHandle || legacy.connection_handle) || (endpoint ? `service:${new URL(endpoint).host}` : `legacy:${legacyId}`)
      : optionalString(legacy.serviceLabel) || `local:${legacyId}`;
    const migrated = normalizeBrainEntry({
      entry_id: entryId,
      brain_id: brainId,
      brain_name: optionalString(legacy.name) || 'Unnamed brain',
      kind,
      connection: {
        type: kind === 'remote' ? 'codex_mcp' : 'local_runtime',
        handle,
        endpoint,
      },
      verification: { state: 'unverified', verified_at: null },
      profile: { state: 'unknown', schema_version: null, profile_version: null },
      access: { auth_state: 'unknown', writability: 'unknown' },
      health: { status: 'unknown', checked_at: null },
      local: kind === 'local' ? {
        home: optionalAbsolutePath(legacy.home),
        host: optionalString(legacy.host),
        port: optionalPort(legacy.port),
        service_label: optionalString(legacy.serviceLabel),
        service_status: optionalString(legacy.status),
      } : null,
      created_at: optionalIsoDate(legacy.createdAt),
      updated_at: optionalIsoDate(legacy.lastOpenedAt || legacy.createdAt),
    });
    byLegacyId.set(legacyId, migrated.entry_id);
    const duplicate = brains.findIndex((brain) => brain.brain_id && brain.brain_id === migrated.brain_id);
    if (duplicate >= 0) brains[duplicate] = migrated;
    else brains.push(migrated);
  }
  assertCatalogUniqueness(brains);
  return {
    version: MACHINE_CATALOG_VERSION,
    active_entry_id: byLegacyId.get(optionalString(value.activeBrainId)) || null,
    brains,
  };
}

function normalizeBrainEntry(value, { requireCanonicalId = false } = {}) {
  requireObject(value, 'Brain catalog entry');
  assertNoSecretFields(value);
  const brainId = value.brain_id === null || value.brain_id === undefined ? null : requireBrainId(value.brain_id);
  if (requireCanonicalId && !brainId) throw new Error('brain_id is required for a verified catalog entry.');
  const kind = requireEnum(value.kind, KINDS, 'kind');
  const connection = requireObject(value.connection, 'connection');
  const connectionType = requireEnum(connection.type, CONNECTION_TYPES, 'connection.type');
  if ((kind === 'local') !== (connectionType === 'local_runtime')) {
    throw new Error('Local brains require local_runtime connections and remote brains require codex_mcp connections.');
  }
  const verification = requireObject(value.verification, 'verification');
  const profile = requireObject(value.profile, 'profile');
  const access = requireObject(value.access, 'access');
  const health = requireObject(value.health, 'health');
  const verificationState = requireEnum(verification.state, VERIFICATION_STATES, 'verification.state');
  if (verificationState === 'verified' && !brainId) throw new Error('Verified catalog entries require a canonical brain_id.');
  const verifiedAt = optionalIsoDate(verification.verified_at);
  if (verificationState === 'verified' && !verifiedAt) throw new Error('Verified catalog entries require verification.verified_at.');
  const endpoint = normalizeEndpoint(connection.endpoint, { allowMissing: kind === 'local' });
  const local = kind === 'local' ? normalizeLocalMetadata(value.local) : null;
  const profileState = requireEnum(profile.state, PROFILE_STATES, 'profile.state');
  const profileSchemaVersion = optionalPositiveInteger(profile.schema_version, 'profile.schema_version');
  const profileVersion = optionalPositiveInteger(profile.profile_version, 'profile.profile_version');
  if (profileState === 'valid' && (!profileSchemaVersion || !profileVersion)) {
    throw new Error('Valid profiles require schema_version and profile_version.');
  }
  const healthStatus = requireEnum(health.status, HEALTH_STATES, 'health.status');
  const healthCheckedAt = optionalIsoDate(health.checked_at);
  if (healthStatus !== 'unknown' && !healthCheckedAt) throw new Error('Known health status requires health.checked_at.');
  return {
    entry_id: optionalString(value.entry_id) || brainId || null,
    brain_id: brainId,
    brain_name: requireString(value.brain_name, 'brain_name'),
    kind,
    connection: {
      type: connectionType,
      handle: requireConnectionHandle(connection.handle),
      endpoint,
    },
    verification: {
      state: verificationState,
      verified_at: verifiedAt,
    },
    profile: {
      state: profileState,
      schema_version: profileSchemaVersion,
      profile_version: profileVersion,
    },
    access: {
      auth_state: requireEnum(access.auth_state, AUTH_STATES, 'access.auth_state'),
      writability: requireEnum(access.writability, WRITABILITY_STATES, 'access.writability'),
    },
    health: {
      status: healthStatus,
      checked_at: healthCheckedAt,
    },
    local,
    created_at: optionalIsoDate(value.created_at),
    updated_at: optionalIsoDate(value.updated_at),
  };
}

function normalizeLocalMetadata(value) {
  if (value === null || value === undefined) return null;
  requireObject(value, 'local');
  return {
    home: optionalAbsolutePath(value.home),
    host: optionalString(value.host),
    port: optionalPort(value.port),
    service_label: optionalString(value.service_label),
    service_status: optionalString(value.service_status),
  };
}

function assertCatalogUniqueness(brains) {
  const entryIds = new Set();
  const brainIds = new Set();
  const handles = new Set();
  for (const brain of brains) {
    if (!brain.entry_id) throw new Error('Catalog entries require entry_id.');
    if (entryIds.has(brain.entry_id)) throw new Error(`Duplicate catalog entry_id: ${brain.entry_id}`);
    entryIds.add(brain.entry_id);
    if (brain.brain_id) {
      if (brainIds.has(brain.brain_id)) throw new Error(`Duplicate canonical brain_id: ${brain.brain_id}`);
      brainIds.add(brain.brain_id);
    }
    if (handles.has(brain.connection.handle)) throw new Error(`Duplicate connection handle: ${brain.connection.handle}`);
    handles.add(brain.connection.handle);
  }
}

function assertNoSecretFields(value, trail = []) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretFields(entry, [...trail, String(index)]));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`Machine catalog cannot store credential field: ${[...trail, key].join('.')}`);
    assertNoSecretFields(entry, [...trail, key]);
  }
}

function normalizeEndpoint(value, { allowMissing = false } = {}) {
  const string = optionalString(value);
  if (!string && allowMissing) return null;
  if (!string) throw new Error('connection.endpoint is required for remote brains.');
  let parsed;
  try {
    parsed = new URL(string);
  } catch {
    throw new Error('connection.endpoint must be a valid http or https URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('connection.endpoint must use http or https.');
  if (parsed.username || parsed.password) throw new Error('connection.endpoint cannot contain credentials.');
  if (parsed.search || parsed.hash) throw new Error('connection.endpoint cannot contain query parameters or a fragment.');
  return parsed.toString().replace(/\/$/, '');
}

function requireConnectionHandle(value) {
  const handle = requireString(value, 'connection.handle');
  if (handle.length > 200 || /\s/.test(handle)) throw new Error('connection.handle must be a compact credential-free identifier.');
  return handle;
}

function requireBrainId(value) {
  const brainId = requireString(value, 'brain_id');
  if (!BRAIN_ID.test(brainId)) throw new Error('brain_id must be a canonical BigBrain ID.');
  return brainId;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireEnum(value, allowed, name) {
  const string = requireString(value, name);
  if (!allowed.has(string)) throw new Error(`${name} must be one of: ${Array.from(allowed).join(', ')}.`);
  return string;
}

function optionalIsoDate(value) {
  const string = optionalString(value);
  if (!string) return null;
  if (Number.isNaN(Date.parse(string))) throw new Error(`Invalid catalog timestamp: ${string}`);
  return new Date(string).toISOString();
}

function optionalPositiveInteger(value, name) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer or null.`);
  return number;
}

function optionalPort(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('local.port must be a valid TCP port.');
  return number;
}

function optionalAbsolutePath(value) {
  const string = optionalString(value);
  if (!string) return null;
  if (!path.isAbsolute(string)) throw new Error('local.home must be an absolute path.');
  return path.resolve(string);
}
