const MANAGED_SERVICE_LABEL_PREFIX = 'ai.diffusing.bigbrain.';

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
    const managed = brains.filter(isDesktopManagedLocalBrain);
    const results = [];

    for (const brain of managed) {
      let before = null;
      try {
        before = await this.probe(brain);
      } catch {
        // An unavailable managed service is repaired through the same safe installer path.
      }

      if (isReadyAtVersion(before, this.appVersion)) {
        results.push({ id: brain.id, name: brain.name, status: 'current', version: this.appVersion });
        continue;
      }

      try {
        await this.reinstall(brain);
        const after = await this.probe(brain);
        if (!isReadyAtVersion(after, this.appVersion)) {
          const actual = serviceVersion(after) || 'unknown';
          throw new Error(`service reported version ${actual} after reinstall`);
        }
        results.push({ id: brain.id, name: brain.name, status: 'updated', version: this.appVersion });
      } catch (error) {
        results.push({
          id: brain.id,
          name: brain.name,
          status: 'failed',
          message: safeFailureMessage(error),
        });
      }
    }

    const summary = summarize(results);
    await this.report(summary);
    return summary;
  }
}

export function isDesktopManagedLocalBrain(brain) {
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  return Boolean(
    brain
      && brain.connectionType !== 'service'
      && typeof brain.serviceLabel === 'string'
      && brain.serviceLabel.startsWith(MANAGED_SERVICE_LABEL_PREFIX)
      && loopbackHosts.has(brain.host)
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
  if (!response.ok) throw new Error(`readiness returned HTTP ${response.status}`);
  return response.json();
}

function isReadyAtVersion(health, expectedVersion) {
  return health?.ok === true
    && health?.status === 'ready'
    && serviceVersion(health) === expectedVersion;
}

function serviceVersion(health) {
  return health?.runtime?.application?.version || null;
}

function summarize(results) {
  const updated = results.filter((result) => result.status === 'updated').length;
  const failed = results.filter((result) => result.status === 'failed');
  const current = results.filter((result) => result.status === 'current').length;
  return {
    phase: failed.length ? 'error' : updated ? 'updated' : results.length ? 'current' : 'none',
    managedCount: results.length,
    current,
    updated,
    failed: failed.length,
    results,
  };
}

function safeFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
}
