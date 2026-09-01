import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  dashboardBasicAuthorization,
  findRemoteDashboardTokenPath,
  readProtectedDashboardToken,
} = require('../../electron/lib/remote-dashboard-auth.cjs');

test('finds the secure Codex token for a matching remote dashboard', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-dashboard-auth-'));
  const configDir = path.join(root, '.config', 'bigbrain');
  const tokenPath = path.join(configDir, 'connections', 'deals', 'token');
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, 'secret-token\n', { mode: 0o600 });
  await fs.writeFile(path.join(configDir, 'brains.json'), JSON.stringify({ brains: [{
    connection: {
      type: 'codex_mcp',
      endpoint: 'https://brain.example.test/mcp/',
      handle: 'deals',
    },
  }] }), { mode: 0o600 });

  const found = await findRemoteDashboardTokenPath('https://brain.example.test', { env: { HOME: root } });
  assert.equal(found, tokenPath);
  assert.equal(await readProtectedDashboardToken(found), 'secret-token');
  const authorization = dashboardBasicAuthorization(await readProtectedDashboardToken(found));
  assert.equal(Buffer.from(authorization.slice('Basic '.length), 'base64').toString(), 'bigbrain:secret-token');
  await fs.rm(root, { recursive: true, force: true });
});

test('does not use a nonmatching or insecure remote dashboard token', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-dashboard-auth-insecure-'));
  const configDir = path.join(root, '.config', 'bigbrain');
  const tokenPath = path.join(configDir, 'connections', 'deals', 'token');
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, 'secret-token', { mode: 0o600 });
  await fs.chmod(tokenPath, 0o644);
  await fs.writeFile(path.join(configDir, 'brains.json'), JSON.stringify({ brains: [{
    connection: {
      type: 'codex_mcp',
      endpoint: 'https://brain.example.test/mcp',
      handle: 'deals',
    },
  }] }), { mode: 0o600 });

  assert.equal(await findRemoteDashboardTokenPath('https://other.example.test', { env: { HOME: root } }), null);
  assert.equal(await findRemoteDashboardTokenPath('https://brain.example.test', { env: { HOME: root } }), null);
  await assert.rejects(() => readProtectedDashboardToken(tokenPath), /must not be accessible/);
  await fs.rm(root, { recursive: true, force: true });
});
