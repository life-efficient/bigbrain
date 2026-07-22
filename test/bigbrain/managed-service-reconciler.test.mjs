import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ManagedServiceReconciler,
  isDesktopManagedLocalBrain,
  probeManagedService,
} from '../../electron/lib/managed-service-reconciler.mjs';

function managedBrain(overrides = {}) {
  return {
    id: 'local-one',
    name: 'Local Brain',
    host: '127.0.0.1',
    port: 55560,
    serviceLabel: 'ai.diffusing.bigbrain.local-one',
    ...overrides,
  };
}

function ready(version) {
  return { ok: true, status: 'ready', runtime: { application: { version } } };
}

test('reconciliation inspects only desktop-managed local services and leaves remote services untouched', async () => {
  const local = managedBrain();
  const remote = { id: 'remote', name: 'Remote Brain', connectionType: 'service', serviceUrl: 'https://brain.example.test' };
  const unmanaged = managedBrain({ id: 'legacy', serviceLabel: 'local.bigbrain.mcp' });
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
  assert.equal(isDesktopManagedLocalBrain(remote), false);
  assert.equal(isDesktopManagedLocalBrain(unmanaged), false);
  assert.equal(isDesktopManagedLocalBrain(managedBrain({ host: 'brain.example.test' })), false);
});

test('mismatched and unavailable managed services are safely reinstalled then verified', async () => {
  const mismatched = managedBrain();
  const unavailable = managedBrain({ id: 'local-two', name: 'Second Brain', port: 55561, serviceLabel: 'ai.diffusing.bigbrain.local-two' });
  const probes = new Map([
    ['local-one', [ready('0.15.0'), ready('0.16.0')]],
    ['local-two', [new Error('connection refused'), ready('0.16.0')]],
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
      return count === 1 ? ready('0.15.0') : ready('0.16.0');
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
