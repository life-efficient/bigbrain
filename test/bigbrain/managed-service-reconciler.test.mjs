import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ManagedServiceReconciler,
  compareServiceVersions,
  isDesktopManagedLocalBrain,
  probeManagedService,
} from '../../electron/lib/managed-service-reconciler.mjs';

function managedBrain(overrides = {}) {
  const brain = {
    id: 'local-one',
    brainId: 'local-one',
    name: 'Local Brain',
    host: '127.0.0.1',
    port: 55560,
    serviceLabel: 'ai.diffusing.bigbrain.local-one',
    serviceOwnership: 'desktop_bundle',
    ...overrides,
  };
  brain.brainId = overrides.brainId || overrides.id || brain.brainId;
  return brain;
}

function ready(version, brainId = 'local-one') {
  return { ok: true, status: 'ready', brain_id: brainId, runtime: { application: { version } } };
}

test('reconciliation inspects only desktop-managed local services and leaves remote services untouched', async () => {
  const local = managedBrain();
  const remote = { id: 'remote', name: 'Remote Brain', connectionType: 'service', serviceOwnership: 'remote', serviceUrl: 'https://brain.example.test' };
  const unmanaged = managedBrain({ id: 'legacy', serviceLabel: 'local.bigbrain.mcp', serviceOwnership: 'source' });
  const probes = [];
  const reinstalls = [];
  const reconciler = new ManagedServiceReconciler({
    appVersion: '0.16.0',
    listBrains: async () => [local, remote, unmanaged],
    probe: async (brain) => { probes.push(brain.id); return ready('0.16.0'); },
    reinstall: async (brain) => reinstalls.push(brain.id),
  });

  const result = await reconciler.reconcile();
  assert.deepEqual(probes, ['local-one']);
  assert.deepEqual(reinstalls, []);
  assert.equal(result.phase, 'current');
  assert.equal(result.managedCount, 1);
  assert.equal(result.remote, 1);
  assert.equal(result.sourceManaged, 1);
  assert.equal(isDesktopManagedLocalBrain(remote), false);
  assert.equal(isDesktopManagedLocalBrain(unmanaged), false);
  assert.equal(isDesktopManagedLocalBrain(managedBrain({ host: 'brain.example.test' })), false);
});

test('mismatched and unavailable managed services are safely reinstalled then verified', async () => {
  const mismatched = managedBrain();
  const unavailable = managedBrain({ id: 'local-two', name: 'Second Brain', port: 55561, serviceLabel: 'ai.diffusing.bigbrain.local-two' });
  const probes = new Map([
    ['local-one', [ready('0.15.0'), ready('0.16.0')]],
    ['local-two', [new Error('connection refused'), ready('0.16.0', 'local-two')]],
  ]);
  const reinstalls = [];
  let report;
  const reconciler = new ManagedServiceReconciler({
    appVersion: '0.16.0',
    listBrains: async () => [mismatched, unavailable],
    probe: async (brain) => {
      const value = probes.get(brain.id).shift();
      if (value instanceof Error) throw value;
      return value;
    },
    reinstall: async (brain) => reinstalls.push(brain.id),
    report: async (summary) => { report = summary; },
  });

  const result = await reconciler.reconcile();
  assert.deepEqual(reinstalls, ['local-one', 'local-two']);
  assert.equal(result.phase, 'updated');
  assert.equal(result.updated, 2);
  assert.deepEqual(report, result);
});

test('one local repair failure is reported without stopping other managed services', async () => {
  const one = managedBrain();
  const two = managedBrain({ id: 'local-two', name: 'Second Brain', port: 55561, serviceLabel: 'ai.diffusing.bigbrain.local-two' });
  const probeCounts = new Map();
  const reconciler = new ManagedServiceReconciler({
    appVersion: '0.16.0',
    listBrains: async () => [one, two],
    probe: async (brain) => {
      const count = (probeCounts.get(brain.id) || 0) + 1;
      probeCounts.set(brain.id, count);
      return count === 1 ? ready('0.15.0', brain.id) : ready('0.16.0', brain.id);
    },
    reinstall: async (brain) => {
      if (brain.id === 'local-one') throw new Error('installer rejected sk-secret123456789');
    },
  });

  const result = await reconciler.reconcile();
  assert.equal(result.phase, 'error');
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 1);
  assert.match(result.results[0].message, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(result), /sk-secret/);
});

test('managed-service probes require readiness metadata from the local ready endpoint', async () => {
  const requests = [];
  const health = await probeManagedService(managedBrain(), {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify(ready('0.16.0')), { status: 200 });
    },
  });
  assert.equal(requests[0].url, 'http://127.0.0.1:55560/ready');
  assert.equal(requests[0].options.headers.accept, 'application/json');
  assert.equal(health.runtime.application.version, '0.16.0');
});

test('newer, source-managed, unknown, and remote services are never reinstalled', async () => {
  const newer = managedBrain();
  const source = managedBrain({ id: 'source', serviceOwnership: 'source' });
  const unknown = managedBrain({ id: 'unknown', serviceOwnership: 'unknown' });
  const remote = { id: 'remote', name: 'Remote', connectionType: 'service', serviceOwnership: 'remote' };
  const probes = [];
  const reinstalls = [];
  const reconciler = new ManagedServiceReconciler({
    appVersion: '1.9.0',
    listBrains: async () => [newer, source, unknown, remote],
    probe: async (brain) => { probes.push(brain.id); return ready('1.10.0', brain.brainId); },
    reinstall: async (brain) => reinstalls.push(brain.id),
  });

  const result = await reconciler.reconcile();
  assert.deepEqual(probes, ['local-one']);
  assert.deepEqual(reinstalls, []);
  assert.equal(result.phase, 'attention');
  assert.equal(result.newer, 1);
  assert.equal(result.sourceManaged, 1);
  assert.equal(result.ownershipUnknown, 1);
  assert.equal(result.remote, 1);
  assert.equal(result.results.find((item) => item.id === 'local-one').action, 'update_desktop_app');
});

test('a newer service is preserved even when its ready endpoint is temporarily unhealthy', async () => {
  const brain = managedBrain();
  const health = await probeManagedService(brain, {
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      status: 'starting',
      brain_id: brain.brainId,
      runtime: { application: { version: '1.10.0' } },
    }), { status: 503 }),
  });
  const reinstalls = [];
  const reconciler = new ManagedServiceReconciler({
    appVersion: '1.9.0',
    listBrains: async () => [brain],
    probe: async () => health,
    reinstall: async (candidate) => reinstalls.push(candidate.id),
  });

  const result = await reconciler.reconcile();
  assert.deepEqual(reinstalls, []);
  assert.equal(result.newer, 1);
  assert.equal(result.results[0].status, 'service_newer');
});

test('brain identity mismatch blocks repair instead of replacing the service on that port', async () => {
  const reinstalls = [];
  const reconciler = new ManagedServiceReconciler({
    appVersion: '0.16.0',
    listBrains: async () => [managedBrain()],
    probe: async () => ready('0.15.0', 'another-brain'),
    reinstall: async (brain) => reinstalls.push(brain.id),
  });
  const result = await reconciler.reconcile();
  assert.deepEqual(reinstalls, []);
  assert.equal(result.phase, 'attention');
  assert.equal(result.blocked, 1);
  assert.equal(result.results[0].status, 'brain_identity_mismatch');
  assert.equal(result.results[0].action, 'resolve_service_identity');
});

test('repair must return the registered brain and the exact desktop version', async () => {
  const responses = [ready('0.15.0'), ready('0.16.0', 'another-brain')];
  const reconciler = new ManagedServiceReconciler({
    appVersion: '0.16.0',
    listBrains: async () => [managedBrain()],
    probe: async () => responses.shift(),
    reinstall: async () => {},
  });
  const result = await reconciler.reconcile();
  assert.equal(result.phase, 'error');
  assert.equal(result.failed, 1);
  assert.match(result.results[0].message, /brain_id another-brain/);
});

test('service version ordering follows SemVer including prereleases', () => {
  assert.equal(compareServiceVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareServiceVersions('2.0.0-beta.2', '2.0.0-beta.10'), -1);
  assert.equal(compareServiceVersions('2.0.0', '2.0.0-rc.1'), 1);
  assert.equal(compareServiceVersions('not-a-version', '2.0.0'), null);
});
