import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { connectCodex, deriveServerName, normalizeMcpEndpoint, renderTokenLaunchAgent, tokenEnvironmentName } from '../../src/bigbrain/codex-connect.js';

test('normalizes service URLs and derives stable collision-safe names', () => {
  assert.equal(normalizeMcpEndpoint('https://brain.example/connect'), 'https://brain.example/mcp');
  assert.equal(normalizeMcpEndpoint('http://localhost:3333/'), 'http://localhost:3333/mcp');
  assert.throws(() => normalizeMcpEndpoint('http://brain.example'), /https/);
  assert.equal(deriveServerName('https://deals.example/mcp', 'My Brain'), 'my-brain');
  assert.notEqual(tokenEnvironmentName('my-brain'), tokenEnvironmentName('my_brain'));
});

test('OAuth registers and logs in without resolving a local brain', async () => {
  const calls = [];
  const execFile = async (command, args) => {
    calls.push([command, args]);
    if (args[1] === 'get') throw new Error('missing');
    return { stdout: '' };
  };
  const result = await connectCodex({ serviceUrl: 'https://brain.example/connect', name: 'example' }, { execFile });
  assert.equal(result.auth, 'oauth');
  assert.deepEqual(calls.map((call) => call[1]), [
    ['mcp', 'get', 'example', '--json'],
    ['mcp', 'add', 'example', '--url', 'https://brain.example/mcp'],
    ['mcp', 'login', 'example'],
  ]);
});

test('token fallback stores a secret privately and never includes it in plist or result', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-connect-'));
  const calls = [];
  const execFile = async (command, args) => {
    calls.push([command, args]);
    if (command === 'codex' && args[1] === 'get') throw new Error('missing');
    if (command === 'launchctl' && args[0] === 'getenv') return { stdout: 'present\n' };
    return { stdout: '' };
  };
  try {
    const result = await connectCodex({ serviceUrl: 'https://brain.example', name: 'deals', auth: 'token', tokenStdin: true, token: 'very-secret-token\n' }, {
      execFile, home, platform: 'darwin', uid: 501, nodePath: '/node', loaderPath: '/loader.mjs',
    });
    const envPath = path.join(home, '.config', 'bigbrain', 'connections', 'deals', 'token');
    const plist = await fs.readFile(path.join(home, 'Library', 'LaunchAgents', 'local.bigbrain.codex-token.deals.plist'), 'utf8');
    assert.equal((await fs.stat(envPath)).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(envPath, 'utf8'), 'very-secret-token\n');
    assert.doesNotMatch(plist, /very-secret-token/);
    assert.doesNotMatch(JSON.stringify(result), /very-secret-token/);
    assert.equal(result.restart_codex_required, true);
    assert.ok(calls.some(([, args]) => args.includes('--bearer-token-env-var')));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('invalid token setup fails before changing Codex registration', async () => {
  const calls = [];
  const execFile = async (command, args) => {
    calls.push([command, args]);
    return { stdout: '' };
  };
  await assert.rejects(() => connectCodex({
    serviceUrl: 'https://brain.example', name: 'brain', auth: 'token', tokenStdin: false,
  }, { execFile, platform: 'darwin' }), /--token-stdin/);
  assert.equal(calls.length, 0);
});

test('existing mismatched Codex registration is refused', async () => {
  const execFile = async (_command, args) => args[1] === 'get'
    ? { stdout: JSON.stringify({ url: 'https://other.example/mcp' }) }
    : { stdout: '' };
  await assert.rejects(() => connectCodex({ serviceUrl: 'https://brain.example', name: 'brain' }, { execFile }), /different connection settings/);
});

test('existing matching Codex registration is reused', async () => {
  const calls = [];
  const execFile = async (_command, args) => {
    calls.push(args);
    if (args[1] === 'get') return { stdout: JSON.stringify({ transport: { type: 'streamable_http', url: 'https://brain.example/mcp', bearer_token_env_var: null } }) };
    return { stdout: '' };
  };
  await connectCodex({ serviceUrl: 'https://brain.example', name: 'brain' }, { execFile });
  assert.equal(calls.some((args) => args[1] === 'add'), false);
  assert.equal(calls.some((args) => args[1] === 'login'), true);
});

test('launch agent XML escapes paths and contains no token value', () => {
  const plist = renderTokenLaunchAgent({ label: 'a&b', nodePath: '/n', loaderPath: '/a<b', envPath: '/secret', envName: 'TOKEN' });
  assert.match(plist, /a&amp;b/);
  assert.match(plist, /\/a&lt;b/);
});
