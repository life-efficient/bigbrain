import { SERVICE_OWNERSHIPS } from './brain-registry.mjs';

const MANAGED_SERVICE_LABEL_PREFIX = 'ai.diffusing.bigbrain.';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class ManagedServiceReconciler {
  constructor({ appVersion, listBrains, probe, reinstall, report = () => {} }) {
    this.appVersion = appVersion;
    this.listBrains = listBrains;
    this.probe = probe;
    this.reinstall = reinstall;
    this.report = report;
  }

  async reconcile() {
    const brains = await this.listBrains();
    const results = [];

    for (const brain of brains) {
      const skipped = skippedResult(brain);
      if (skipped) {
        results.push(skipped);
        continue;
      }
      if (!isDesktopManagedLocalBrain(brain)) {
        results.push(resultFor(brain, {
          status: 'invalid_configuration',
          action: 'review_service_configuration',
          message: 'Desktop-managed service configuration is incomplete or is not loopback-only.',
        }));
        continue;
      }

      let repairReason = 'service_unavailable';
      try {
        const before = await this.probe(brain);
        const inspection = inspectService(brain, before, this.appVersion);
        if (inspection.reason === 'brain_identity_mismatch' || inspection.reason === 'brain_identity_missing') {
          results.push(resultFor(brain, {
            status: inspection.reason,
            action: 'resolve_service_identity',
            observedVersion: inspection.version,
            observedBrainId: inspection.brainId,
            message: inspection.message,
          }));
          continue;
        }
        if (inspection.ready && inspection.version === this.appVersion) {
          results.push(resultFor(brain, {
            status: 'current',
            action: 'none',
            version: this.appVersion,
            observedVersion: inspection.version,
            observedBrainId: inspection.brainId,
          }));
          continue;
        }
        if (inspection.versionOrder > 0) {
          results.push(resultFor(brain, {
            status: 'service_newer',
            action: 'update_desktop_app',
            observedVersion: inspection.version,
            observedBrainId: inspection.brainId,
            message: `Local MCP ${inspection.version} is newer than desktop ${this.appVersion}. Update the desktop app; the newer service was left untouched.`,
          }));
          continue;
        }
        repairReason = inspection.reason;
      } catch {
        // Explicitly desktop-owned unavailable services are repaired from the app bundle.
      }

      try {
        await this.reinstall(brain);
        const after = await this.probe(brain);
        const verified = assertRepairedService(brain, after, this.appVersion);
        results.push(resultFor(brain, {
          status: 'updated',
          action: 'none',
          version: this.appVersion,
          observedVersion: verified.version,
          observedBrainId: verified.brainId,
          reason: repairReason,
        }));
      } catch (error) {
        results.push(resultFor(brain, {
          status: 'failed',
          action: 'retry_service_repair',
          reason: 'repair_failed',
          message: safeFailureMessage(error),
        }));
      }
    }

    const summary = summarize(results);
    await this.report(summary);
    return summary;
  }
}

export function isDesktopManagedLocalBrain(brain) {
  return Boolean(
    brain
      && brain.serviceOwnership === SERVICE_OWNERSHIPS.DESKTOP_BUNDLE
      && brain.connectionType !== 'service'
      && typeof brain.serviceLabel === 'string'
      && brain.serviceLabel.startsWith(MANAGED_SERVICE_LABEL_PREFIX)
      && LOOPBACK_HOSTS.has(brain.host)
      && Number.isInteger(brain.port)
      && brain.port > 0
      && brain.port <= 65_535,
  );
}

export async function probeManagedService(brain, { fetchImpl = fetch, timeoutMs = 4_000 } = {}) {
  const host = brain.host === '::1' ? '[::1]' : brain.host;
  const response = await fetchImpl(`http://${host}:${brain.port}/ready`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let health;
  try {
    health = await response.json();
  } catch {
    if (!response.ok) throw new Error(`readiness returned HTTP ${response.status}`);
    throw new Error('readiness returned invalid JSON');
  }
  if (!response.ok && !serviceVersion(health) && !serviceBrainId(health)) {
    throw new Error(`readiness returned HTTP ${response.status}`);
  }
  return health;
}

export function compareServiceVersions(serviceVersion, appVersion) {
  const service = parseSemver(serviceVersion);
  const app = parseSemver(appVersion);
  if (!service || !app) return null;
  return compareSemver(service, app);
}

function skippedResult(brain) {
  if (brain?.connectionType === 'service' || brain?.serviceOwnership === SERVICE_OWNERSHIPS.REMOTE) {
    return resultFor(brain, { status: 'remote', action: 'manage_remote_service_separately' });
  }
  if (brain?.serviceOwnership === SERVICE_OWNERSHIPS.SOURCE) {
    return resultFor(brain, { status: 'source_managed', action: 'update_source_checkout' });
  }
  if (brain?.serviceOwnership !== SERVICE_OWNERSHIPS.DESKTOP_BUNDLE) {
    return resultFor(brain, {
      status: 'ownership_unknown',
      action: 'review_service_ownership',
      message: 'Service ownership could not be proven, so it was left untouched.',
    });
  }
  return null;
}

function inspectService(brain, health, appVersion) {
  const version = serviceVersion(health);
  const brainId = serviceBrainId(health);
  const expectedBrainId = expectedServiceBrainId(brain);
  if (!brainId) {
    return {
      ready: false,
      version,
      brainId,
      versionOrder: compareServiceVersions(version, appVersion),
      reason: 'brain_identity_missing',
      message: 'The local MCP readiness response did not include brain_id, so BigBrain left it untouched.',
    };
  }
  if (expectedBrainId && brainId !== expectedBrainId) {
    return {
      ready: false,
      version,
      brainId,
      versionOrder: compareServiceVersions(version, appVersion),
      reason: 'brain_identity_mismatch',
      message: `Port ${brain.port} serves brain ${brainId}, not registered brain ${expectedBrainId}. Resolve the port or registry mismatch before updating.`,
    };
  }
  const ready = health?.ok === true && health?.status === 'ready';
  const versionOrder = compareServiceVersions(version, appVersion);
  let reason = 'service_not_ready';
  if (ready && !version) reason = 'service_version_missing';
  else if (ready && versionOrder === null) reason = 'service_version_invalid';
  else if (ready && versionOrder < 0) reason = 'service_older';
  else if (ready && versionOrder === 0 && version !== appVersion) reason = 'service_version_not_exact';
  return { ready, version, brainId, versionOrder, reason };
}

function assertRepairedService(brain, health, expectedVersion) {
  const inspection = inspectService(brain, health, expectedVersion);
  if (inspection.reason === 'brain_identity_missing' || inspection.reason === 'brain_identity_mismatch') {
    throw new Error(`service reported brain_id ${inspection.brainId || 'unknown'} after repair; expected ${expectedServiceBrainId(brain) || 'a registered brain id'}`);
  }
  if (!inspection.ready) {
    throw new Error(inspection.message || `service was not ready after repair (${inspection.reason})`);
  }
  if (inspection.version !== expectedVersion) {
    throw new Error(`service reported version ${inspection.version || 'unknown'} after repair; expected ${expectedVersion}`);
  }
  return inspection;
}

function resultFor(brain, fields) {
  return {
    id: brain?.id ?? null,
    name: brain?.name || 'BigBrain',
    ownership: brain?.serviceOwnership || SERVICE_OWNERSHIPS.UNKNOWN,
    ...fields,
  };
}

function expectedServiceBrainId(brain) {
  return brain?.brainId || brain?.id || null;
}

function serviceBrainId(health) {
  return typeof health?.brain_id === 'string' && health.brain_id.trim() ? health.brain_id.trim() : null;
}

function serviceVersion(health) {
  const version = health?.runtime?.application?.version;
  return typeof version === 'string' && version.trim() ? version.trim() : null;
}

function summarize(results) {
  const managed = results.filter((result) => result.ownership === SERVICE_OWNERSHIPS.DESKTOP_BUNDLE);
  const count = (status) => results.filter((result) => result.status === status).length;
  const failed = count('failed');
  const updated = count('updated');
  const current = count('current');
  const newer = count('service_newer');
  const unknown = count('ownership_unknown');
  const blocked = results.filter((result) => [
    'brain_identity_missing',
    'brain_identity_mismatch',
    'invalid_configuration',
  ].includes(result.status)).length;
  return {
    phase: failed ? 'error'
      : newer || unknown || blocked ? 'attention'
        : updated ? 'updated'
          : managed.length ? 'current'
            : 'none',
    managedCount: managed.length,
    current,
    updated,
    newer,
    blocked,
    sourceManaged: count('source_managed'),
    ownershipUnknown: unknown,
    remote: count('remote'),
    failed,
    results,
  };
}

function parseSemver(value) {
  const match = String(value || '').trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareSemver(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumber = /^\d+$/.test(a) ? Number(a) : null;
    const bNumber = /^\d+$/.test(b) ? Number(b) : null;
    if (aNumber !== null && bNumber !== null) return aNumber > bNumber ? 1 : -1;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

function safeFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
}
