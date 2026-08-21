import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dashboardReadyUrl, waitForDashboardReady } = require('../../electron/lib/dashboard-readiness.cjs');

test('desktop dashboard readiness targets the service ready endpoint', () => {
  assert.equal(
    dashboardReadyUrl('http://127.0.0.1:55560/dashboard?stale=1#old'),
    'http://127.0.0.1:55560/ready',
  );
});

test('desktop dashboard readiness absorbs transient startup failures', async () => {
  const responses = [
    new Error('ERR_CONNECTION_REFUSED'),
    new Response(JSON.stringify({ ok: false, status: 'not_ready' }), { status: 503 }),
    new Response(JSON.stringify({ ok: true, status: 'ready' }), { status: 200 }),
  ];
  const requests = [];
  const delays = [];
  const readiness = await waitForDashboardReady('http://127.0.0.1:55560/dashboard', {
    attempts: 3,
    fetchImpl: async (url) => {
      requests.push(url);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    sleep: async (delay) => delays.push(delay),
  });

  assert.equal(readiness.status, 'ready');
  assert.deepEqual(requests, Array(3).fill('http://127.0.0.1:55560/ready'));
  assert.deepEqual(delays, [500, 500]);
});

test('desktop dashboard readiness fails with calm user-facing copy', async () => {
  await assert.rejects(
    waitForDashboardReady('http://127.0.0.1:55560/dashboard', {
      attempts: 2,
      fetchImpl: async () => { throw new Error('ERR_CONNECTION_REFUSED (-102)'); },
      sleep: async () => {},
    }),
    (error) => {
      assert.match(error.message, /taking longer than expected to start/);
      assert.doesNotMatch(error.message, /ERR_CONNECTION_REFUSED|-102/);
      return true;
    },
  );
});
