import test from 'node:test';
import assert from 'node:assert/strict';

import { startLocalPageLinkServer } from '../../electron/lib/local-page-link-server.mjs';
import { localPageUrl } from '../../src/bigbrain/page-links.js';

test('desktop page-link resolver binds to loopback and opens the matching protected dashboard route', async () => {
  const brainId = 'brn_01234567-89ab-4cde-8fab-0123456789ab';
  const opened = [];
  const server = await startLocalPageLinkServer({
    port: 0,
    resolveBrain: async (requestedBrainId) => requestedBrainId === brainId
      ? { id: 'desktop-entry', brainId, dashboardUrl: 'https://brain.example.test/dashboard' }
      : Promise.reject(new Error('Unknown brain')),
    openPage: async (value) => opened.push(value),
  });
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);
    assert.equal(address.address, '127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;

    const known = await fetch(localPageUrl(brainId, 'organizations/acme-intralog', { origin }));
    assert.equal(known.status, 200);
    assert.match(await known.text(), /Opened in BigBrain/);
    assert.equal(opened.length, 1);
    assert.equal(
      opened[0].targetUrl,
      `https://brain.example.test/dashboard/page/${brainId}/organizations/acme-intralog`,
    );

    const unknown = await fetch(localPageUrl('brn_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'organizations/acme-intralog', { origin }));
    assert.equal(unknown.status, 404);
    const traversal = await fetch(`${origin}/page/${brainId}/organizations/%252e%252e`);
    assert.equal(traversal.status, 404);
    const mutation = await fetch(localPageUrl(brainId, 'organizations/acme-intralog', { origin }), { method: 'POST' });
    assert.equal(mutation.status, 405);
    assert.equal(opened.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
