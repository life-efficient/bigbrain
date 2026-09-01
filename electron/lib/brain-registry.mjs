import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  MachineCatalog,
  defaultMachineCatalogPath,
} from '../../src/bigbrain/machine-catalog.js';

export const REGISTRY_VERSION = 2;
export const DEFAULT_PORT_START = 55560;
export const SERVICE_OWNERSHIPS = Object.freeze({
  DESKTOP_BUNDLE: 'desktop_bundle',
  SOURCE: 'source',
  REMOTE: 'remote',
  UNKNOWN: 'unknown',
});

export function defaultAppSupport(home = os.homedir()) {
  return path.join(home, 'Library', 'Application Support', 'BigBrain');
}

export class BrainRegistry {
  constructor({ appSupport = null, catalogPath = null, host = '127.0.0.1', env = process.env, now = () => new Date() } = {}) {
    const home = path.resolve(env.HOME || os.homedir());
    this.appSupport = path.resolve(appSupport || defaultAppSupport(home));
    this.catalogPath = path.resolve(catalogPath || (appSupport
      ? path.join(this.appSupport, 'brains.json')
      : defaultMachineCatalogPath(env)));
    this.registryPath = this.catalogPath;
    this.legacyRegistryPath = path.join(this.appSupport, 'registry.json');
    this.legacyBackupPath = `${this.legacyRegistryPath}.legacy`;
    this.host = host;
    this.now = now;
    this.catalog = new MachineCatalog({ catalogPath: this.catalogPath, now });
  }

  async load() {
    return desktopRegistryFromCatalog(await this.loadCatalog());
  }

  async save(registry) {
    const value = normalizeRegistry(registry);
    const catalog = await this.loadCatalog();
    const saved = await this.catalog.save(mergeDesktopRegistryIntoCatalog(catalog, value, this.now));
    return desktopRegistryFromCatalog(saved);
  }

  async createDraft({ name, description = '', ownerName, ownerEmail, home = null, backupPreference = 'github' }) {
    const registry = await this.load();
    const id = crypto.randomUUID();
    const port = await allocatePort(registry.brains.map((brain) => brain.port), this.host);
    const resolvedHome = path.resolve(home || path.join(this.appSupport, 'brains', id));
    if (registry.brains.some((brain) => path.resolve(brain.home || '') === resolvedHome)) {
      throw new Error(`A brain is already registered at ${resolvedHome}.`);
    }
    const brain = {
      id,
      name: String(name).trim(),
      description: String(description || '').trim(),
      home: resolvedHome,
      port,
      host: this.host,
      serviceLabel: `ai.diffusing.bigbrain.${id}`,
      serviceOwnership: SERVICE_OWNERSHIPS.DESKTOP_BUNDLE,
      serviceOwnershipReason: 'created_by_desktop',
      status: 'setup',
      owner: { name: String(ownerName).trim(), email: String(ownerEmail).trim().toLowerCase() },
      aiAccess: { type: 'bring_your_own_key', provider: 'openai' },
      hosting: 'local',
      visibility: 'private',
      backupPreference: backupPreference === 'none' ? 'none' : 'github',
      onboarding: { step: 4, completed: false, error: null },
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    registry.brains.push(brain);
    registry.activeBrainId = id;
    await this.save(registry);
    return brain;
  }

  async registerExisting({ id, name, home, ownerName, ownerEmail, port: existingPort = null, replacedService = null, backupPreference = 'github' }) {
    const registry = await this.load();
    const resolvedHome = path.resolve(home);
    const duplicate = registry.brains.find((brain) => brain.id === id || path.resolve(brain.home) === resolvedHome);
    if (duplicate) throw new Error(`This brain is already registered as ${duplicate.name}.`);
    const port = existingPort || await allocatePort(registry.brains.map((brain) => brain.port), this.host);
    if (registry.brains.some((brain) => brain.port === port)) throw new Error(`Port ${port} is already assigned to another registered brain.`);
    const brain = {
      id, brainId: id, name: String(name).trim(), home: resolvedHome, port, host: this.host,
      serviceLabel: `ai.diffusing.bigbrain.${id}`, replacedService, status: 'setup',
      serviceOwnership: SERVICE_OWNERSHIPS.DESKTOP_BUNDLE,
      serviceOwnershipReason: 'adopted_by_desktop',
      owner: { name: String(ownerName).trim(), email: String(ownerEmail).trim().toLowerCase() },
      aiAccess: { type: 'bring_your_own_key', provider: 'openai' },
      hosting: 'local',
      visibility: 'private',
      backupPreference: backupPreference === 'none' ? 'none' : 'github',
      onboarding: { step: 4, completed: false, error: null },
      createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(),
    };
    registry.brains.push(brain);
    registry.activeBrainId = id;
    await this.save(registry);
    return brain;
  }

  async registerService({ brainId, name, serviceUrl }) {
    const registry = await this.load();
    const duplicate = registry.brains.find((brain) => brain.connectionType === 'service' && normalizeServiceOrigin(brain.serviceUrl) === normalizeServiceOrigin(serviceUrl));
    if (duplicate) throw new Error(`This BigBrain service is already connected as ${duplicate.name}.`);
    const brain = {
      id: isCanonicalBrainId(brainId) ? brainId : crypto.randomUUID(),
      brainId,
      name: String(name).trim(),
      connectionType: 'service',
      serviceUrl,
      connectionHandle: `remote:${new URL(serviceUrl).hostname}`,
      serviceOwnership: SERVICE_OWNERSHIPS.REMOTE,
      serviceOwnershipReason: 'remote_connection',
      status: 'connected',
      onboarding: { step: 5, completed: true, error: null },
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    registry.brains.push(brain);
    registry.activeBrainId = brain.id;
    const saved = await this.save(registry);
    return saved.brains.find((candidate) => candidate.id === brain.id) || brain;
  }

  async update(id, updates) {
    const registry = await this.load();
    const index = registry.brains.findIndex((brain) => brain.id === id);
    if (index < 0) throw new Error(`Unknown brain: ${id}`);
    registry.brains[index] = { ...registry.brains[index], ...updates, id };
    const saved = await this.save(registry);
    return saved.brains.find((brain) => brain.id === id) || registry.brains[index];
  }

  async activate(id) {
    const registry = await this.load();
    const brain = registry.brains.find((candidate) => candidate.id === id);
    if (!brain) throw new Error(`Unknown brain: ${id}`);
    brain.lastOpenedAt = new Date().toISOString();
    registry.activeBrainId = id;
    const saved = await this.save(registry);
    return saved.brains.find((candidate) => candidate.id === id) || brain;
  }

  async loadCatalog() {
    let catalog = await this.catalog.load();
    if (await fileExists(this.legacyBackupPath) || !await fileExists(this.legacyRegistryPath)) return catalog;
    const legacy = normalizeRegistry(JSON.parse(await fs.readFile(this.legacyRegistryPath, 'utf8')));
    catalog = await this.catalog.save(mergeDesktopRegistryIntoCatalog(catalog, legacy, this.now));
    await fs.rename(this.legacyRegistryPath, this.legacyBackupPath);
    return catalog;
  }
}

export function emptyRegistry() {
  return { version: REGISTRY_VERSION, activeBrainId: null, brains: [] };
}

function normalizeRegistry(value) {
  if (!value || typeof value !== 'object') throw new Error('BigBrain registry must be an object.');
  return {
    version: REGISTRY_VERSION,
    activeBrainId: typeof value.activeBrainId === 'string' ? value.activeBrainId : null,
    brains: Array.isArray(value.brains)
      ? value.brains
        .filter((brain) => brain && typeof brain.id === 'string')
        .map(normalizeBrainServiceOwnership)
      : [],
  };
}

function desktopRegistryFromCatalog(catalog) {
  return {
    version: REGISTRY_VERSION,
    activeBrainId: catalog.active_entry_id || null,
    brains: catalog.brains.map(desktopBrainFromCatalog),
  };
}

function desktopBrainFromCatalog(entry) {
  const desktop = entry.desktop || {};
  const remote = entry.kind === 'remote';
  const local = entry.local || {};
  const healthStatus = entry.health?.status || 'unknown';
  const defaultStatus = remote
    ? (healthStatus === 'healthy' ? 'connected' : healthStatus)
    : (healthStatus === 'healthy' ? 'running' : healthStatus);
  return {
    id: entry.entry_id,
    brainId: entry.brain_id,
    name: entry.brain_name,
    description: desktop.description || '',
    home: remote ? null : local.home,
    host: remote ? null : (local.host || '127.0.0.1'),
    port: remote ? null : local.port,
    serviceLabel: remote ? null : local.service_label || desktop.service_label,
    serviceOwnership: desktop.service_ownership || (remote ? SERVICE_OWNERSHIPS.REMOTE : SERVICE_OWNERSHIPS.UNKNOWN),
    serviceOwnershipReason: desktop.service_ownership_reason || (remote ? 'remote_connection' : 'catalog_entry'),
    status: desktop.status || defaultStatus,
    owner: desktop.owner ? {
      name: desktop.owner.name,
      email: desktop.owner.email,
      personSlug: desktop.owner.person_slug,
    } : null,
    aiAccess: desktop.ai_access ? { ...desktop.ai_access } : null,
    hosting: desktop.hosting,
    visibility: desktop.visibility,
    backupPreference: desktop.backup_preference,
    onboarding: desktop.onboarding ? {
      step: desktop.onboarding.step,
      completed: desktop.onboarding.completed,
      error: desktop.onboarding.error,
    } : null,
    replacedService: desktop.replaced_service ? {
      label: desktop.replaced_service.label,
      plistPath: desktop.replaced_service.plist_path,
      port: desktop.replaced_service.port,
    } : null,
    connectionType: remote ? 'service' : undefined,
    serviceUrl: remote ? normalizeServiceOrigin(entry.connection.endpoint) : undefined,
    connectionHandle: entry.connection.handle,
    createdAt: entry.created_at,
    lastOpenedAt: desktop.last_opened_at || entry.updated_at || entry.created_at,
  };
}

function mergeDesktopRegistryIntoCatalog(catalog, registry, nowFactory) {
  const next = {
    ...catalog,
    brains: [...catalog.brains],
  };
  const activeBrain = registry.brains.find((brain) => brain.id === registry.activeBrainId);
  let activeEntryId = catalog.active_entry_id;
  for (const desktopBrain of registry.brains) {
    const canonicalId = canonicalBrainIdForDesktopBrain(desktopBrain);
    const index = next.brains.findIndex((entry) => desktopBrainMatchesEntry(desktopBrain, canonicalId, entry));
    const existing = index >= 0 ? next.brains[index] : null;
    const entry = desktopBrainToCatalogEntry(desktopBrain, existing, nowFactory);
    if (index >= 0) next.brains[index] = entry;
    else next.brains.push(entry);
    if (activeBrain && desktopBrain.id === activeBrain.id) activeEntryId = entry.entry_id;
  }
  next.active_entry_id = activeEntryId;
  return next;
}

function desktopBrainToCatalogEntry(brain, existing, nowFactory) {
  const now = nowFactory().toISOString();
  const canonicalId = canonicalBrainIdForDesktopBrain(brain) || existing?.brain_id || null;
  const remote = brain.connectionType === 'service' || existing?.kind === 'remote';
  const serviceUrl = remote
    ? normalizeServiceOrigin(brain.serviceUrl || existing?.connection.endpoint)
    : null;
  if (remote && !serviceUrl) throw new Error(`Remote brain ${brain.name || brain.id} has no valid service URL.`);
  const entryId = existing?.entry_id || (canonicalId || String(brain.id));
  const handle = existing?.connection.handle
    || safeConnectionHandle(brain.connectionHandle || (remote ? `remote:${new URL(serviceUrl).hostname}` : brain.serviceLabel || `local:${entryId}`));
  const createdAt = existing?.created_at || optionalDate(brain.createdAt) || now;
  const existingVerification = existing?.verification;
  const verification = canonicalId
    ? (existingVerification?.state === 'verified'
      ? existingVerification
      : { state: 'verified', verified_at: createdAt })
    : { state: 'unverified', verified_at: null };
  const local = remote ? null : {
    ...(existing?.local || {}),
    home: brain.home ? path.resolve(brain.home) : existing?.local?.home || null,
    host: brain.host || existing?.local?.host || '127.0.0.1',
    port: brain.port || existing?.local?.port || null,
    service_label: brain.serviceLabel || existing?.local?.service_label || null,
    service_status: brain.status || existing?.local?.service_status || 'unknown',
  };
  return {
    entry_id: entryId,
    brain_id: canonicalId,
    brain_name: String(brain.name || existing?.brain_name || 'Unnamed brain').trim(),
    kind: remote ? 'remote' : 'local',
    connection: {
      type: remote ? 'codex_mcp' : 'local_runtime',
      handle,
      endpoint: remote ? `${serviceUrl}/mcp` : null,
    },
    verification,
    profile: existing?.profile || { state: 'unknown', schema_version: null, profile_version: null },
    access: existing?.access || {
      auth_state: remote ? 'unknown' : 'local_trusted',
      writability: remote ? 'unknown' : 'writable',
    },
    health: existing?.health || { status: 'unknown', checked_at: null },
    local,
    desktop: desktopMetadataFromBrain(brain, existing?.desktop),
    created_at: createdAt,
    updated_at: now,
  };
}

function desktopMetadataFromBrain(brain, existing = null) {
  const owner = brain.owner || existing?.owner;
  const aiAccess = brain.aiAccess || existing?.ai_access;
  const onboarding = brain.onboarding || existing?.onboarding;
  const replacedService = brain.replacedService || existing?.replaced_service;
  return {
    description: brain.description ?? existing?.description ?? '',
    service_label: brain.serviceLabel ?? existing?.service_label ?? null,
    service_ownership: brain.serviceOwnership || existing?.service_ownership || null,
    service_ownership_reason: brain.serviceOwnershipReason || existing?.service_ownership_reason || null,
    status: brain.status || existing?.status || null,
    owner: owner ? {
      name: owner.name || null,
      email: owner.email?.toLowerCase() || null,
      person_slug: owner.personSlug || owner.person_slug || null,
    } : null,
    ai_access: aiAccess ? { type: aiAccess.type || null, provider: aiAccess.provider || null } : null,
    hosting: brain.hosting ?? existing?.hosting ?? null,
    visibility: brain.visibility ?? existing?.visibility ?? null,
    backup_preference: brain.backupPreference ?? existing?.backup_preference ?? null,
    onboarding: onboarding ? {
      step: onboarding.step ?? null,
      completed: Boolean(onboarding.completed),
      error: onboarding.error || null,
    } : null,
    replaced_service: replacedService ? {
      label: replacedService.label || null,
      plist_path: replacedService.plistPath || replacedService.plist_path || null,
      port: replacedService.port || null,
    } : null,
    last_opened_at: optionalDate(brain.lastOpenedAt) || existing?.last_opened_at || null,
  };
}

function desktopBrainMatchesEntry(brain, canonicalId, entry) {
  if (canonicalId && entry.brain_id === canonicalId) return true;
  if (entry.entry_id === brain.id) return true;
  if (brain.connectionType === 'service' && entry.kind === 'remote') {
    return normalizeServiceOrigin(brain.serviceUrl) === normalizeServiceOrigin(entry.connection.endpoint);
  }
  return Boolean(brain.home && entry.kind === 'local' && path.resolve(brain.home) === path.resolve(entry.local?.home || ''));
}

function canonicalBrainIdForDesktopBrain(brain) {
  const candidate = brain.brainId || brain.brain_id || brain.id;
  return isCanonicalBrainId(candidate) ? candidate : null;
}

function isCanonicalBrainId(value) {
  return typeof value === 'string' && /^brn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeServiceOrigin(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    parsed.pathname = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function safeConnectionHandle(value) {
  const handle = String(value || '').trim().replace(/\s+/g, '-');
  return handle || `brain-${crypto.randomUUID()}`;
}

function optionalDate(value) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

async function fileExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function normalizeBrainServiceOwnership(brain) {
  if (brain.connectionType === 'service') {
    return {
      ...brain,
      serviceOwnership: SERVICE_OWNERSHIPS.REMOTE,
      serviceOwnershipReason: brain.serviceOwnershipReason || 'remote_connection',
    };
  }
  const allowed = new Set([
    SERVICE_OWNERSHIPS.DESKTOP_BUNDLE,
    SERVICE_OWNERSHIPS.SOURCE,
    SERVICE_OWNERSHIPS.UNKNOWN,
  ]);
  const serviceOwnership = allowed.has(brain.serviceOwnership)
    ? brain.serviceOwnership
    : SERVICE_OWNERSHIPS.UNKNOWN;
  return {
    ...brain,
    serviceOwnership,
    serviceOwnershipReason: brain.serviceOwnershipReason
      || (serviceOwnership === SERVICE_OWNERSHIPS.UNKNOWN ? 'legacy_unclassified' : 'registry'),
  };
}

export async function allocatePort(reserved = [], host = '127.0.0.1', start = DEFAULT_PORT_START) {
  const used = new Set(reserved.map(Number));
  for (let port = start; port < start + 1000; port += 1) {
    if (!used.has(port) && await canListen(port, host)) return port;
  }
  throw new Error('No free local BigBrain port is available.');
}

export function canListen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}
