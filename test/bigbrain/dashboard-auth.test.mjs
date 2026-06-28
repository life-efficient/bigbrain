import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { upsertMember } from '../../src/bigbrain/members.js';

test('hosted dashboard uses OAuth allowlist sessions', async () => {
  const fixture = await createFixture('bigbrain-dashboard-oauth-');
  const sessionToken = 'bbdash_test-session';
  const tokenStorePath = path.join(fixture.rootDir, 'tokens.json');
  await fs.writeFile(tokenStorePath, `${JSON.stringify({
    tokens: [{
      token_hash: hashToken(sessionToken),
      email: 'teammate@example.com',
      name: 'Team Mate',
      provider: 'google',
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      scope: 'dashboard:read',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }],
    states: [],
    clients: [],
    codes: [],
  }, null, 2)}\n`);

  let server;
  try {
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'public.md'), [
      '---',
      'title: Public Page',
      'public: true',
      '---',
      '# Public Page',
      '',
      'Safe public body.',
      '',
      '---',
      '',
      '## Timeline',
      '',
      '- 2026-06-28 | Private timeline.',
    ].join('\n'), 'utf8');
    const config = await loadConfig({ configPath: fixture.configPath });
    server = await startDashboard(config, {
      host: '127.0.0.1',
      port: 0,
      authConfig: {
        mode: 'oauth_allowlist',
        authToken: null,
        publicUrl: 'https://brain.example.test',
        provider: 'google',
        googleClientId: 'client-id',
        googleClientSecret: 'client-secret',
        allowedEmails: ['teammate@example.com'],
        allowedDomains: [],
        tokenStorePath,
        allowSharedToken: false,
        serviceName: 'Example Brain Cortex',
        appName: 'Example Brain',
      },
    });
    const url = serverUrl(server);

    const unauthenticated = await fetch(url, { redirect: 'manual' });
    assert.equal(unauthenticated.status, 302);
    assert.match(unauthenticated.headers.get('location'), /^\/auth\/start\?redirect=%2F/);

    const publicPage = await fetch(`${url}/public/people/public`, { redirect: 'manual' });
    assert.equal(publicPage.status, 200);
    assert.match(await publicPage.text(), /dashboard-client\.js/);

    const publicApi = await fetch(`${url}/api/public/page?slug=people/public`);
    assert.equal(publicApi.status, 200);
    const publicJson = await publicApi.json();
    assert.equal(publicJson.title, 'Public Page');
    assert.match(publicJson.markdown, /Safe public body/);
    assert.doesNotMatch(publicJson.markdown, /Private timeline/);

    const privateApi = await fetch(`${url}/api/page?slug=people/public`, { redirect: 'manual' });
    assert.equal(privateApi.status, 302);
    assert.match(privateApi.headers.get('location'), /^\/auth\/start\?redirect=%2Fapi%2Fpage/);

    const authenticated = await fetch(url, {
      headers: { cookie: `bigbrain_dashboard_session=${sessionToken}` },
    });
    assert.equal(authenticated.status, 200);
    assert.match(await authenticated.text(), /<title>Dashboard<\/title>/);

    const health = await fetch(`${url}/api/health`, {
      headers: { cookie: `bigbrain_dashboard_session=${sessionToken}` },
    });
    assert.equal(health.status, 200);
    assert.equal(Array.isArray((await health.json()).findings), true);

    const start = await fetch(`${url}/auth/start?redirect=/api/health`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    assert.match(start.headers.get('location'), /^https:\/\/accounts\.google\.com\//);

    const store = JSON.parse(await fs.readFile(tokenStorePath, 'utf8'));
    assert.equal(store.states.some((entry) =>
      entry.flow === 'dashboard_oauth' && entry.redirect_path === '/api/health'
    ), true);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('hosted dashboard can use active members as the OAuth allowlist', async () => {
  const fixture = await createFixture('bigbrain-dashboard-member-oauth-');
  let db;
  let server;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    db = await openDatabase(config);
    await upsertMember(db, {
      email: 'teammate@example.com',
      name: 'Team Mate',
      person_slug: 'people/team-mate',
    });
    server = await startDashboard(config, {
      host: '127.0.0.1',
      port: 0,
      authConfig: {
        mode: 'oauth_allowlist',
        authToken: null,
        publicUrl: 'https://brain.example.test',
        provider: 'google',
        googleClientId: 'client-id',
        googleClientSecret: 'client-secret',
        allowedEmails: [],
        allowedDomains: [],
        tokenStorePath: path.join(fixture.rootDir, 'tokens.json'),
        allowSharedToken: false,
        serviceName: 'Example Brain Cortex',
        appName: 'Example Brain',
      },
    });

    const start = await fetch(`${serverUrl(server)}/auth/start`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    assert.match(start.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db?.close?.();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const brainHome = path.join(rootDir, 'brain');
  const env = {
    ...process.env,
    BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
    BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
  };
  const init = await initializeBrainHome(brainHome, { env });
  await fs.mkdir(path.join(brainHome, 'people'), { recursive: true });
  return { rootDir, brainHome, configPath: init.configPath };
}

function serverUrl(server) {
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.ok(address);
  return `http://127.0.0.1:${address.port}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
