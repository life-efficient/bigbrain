import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { connectCodex, deriveServerName, normalizeMcpEndpoint, tokenEnvironmentName } from '../../src/bigbrain/codex-connect.js';

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

test('token fallback stores a secret privately and registers a stdio bridge without exposing it', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-connect-'));
  const calls = [];
  const execFile = async (command, args) => {
    calls.push([command, args]);
    if (command === 'codex' && args[1] === 'get') throw new Error('missing');
    return { stdout: '' };
  };
  try {
    const result = await connectCodex({ serviceUrl: 'https://brain.example', name: 'deals', auth: 'token', tokenStdin: true, token: 'very-secret-token\n' }, {
      execFile, home, platform: 'linux', nodePath: '/node', bridgePath: '/bridge.mjs',
    });
    const tokenPath = path.join(home, '.config', 'bigbrain', 'connections', 'deals', 'token');
    assert.equal((await fs.stat(tokenPath)).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(tokenPath, 'utf8'), 'very-secret-token\n');
    assert.doesNotMatch(JSON.stringify(result), /very-secret-token/);
    assert.doesNotMatch(JSON.stringify(calls), /very-secret-token/);
    assert.equal(result.restart_codex_required, false);
    assert.equal(result.new_task_required, true);
    assert.equal(result.transport, 'stdio_bridge');
    assert.ok(calls.some(([command, args]) => command === 'codex' && args.join(' ') === `mcp add deals -- /node /bridge.mjs https://brain.example/mcp ${tokenPath}`));
    assert.equal(calls.some(([command]) => command === 'launchctl'), false);
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

test('existing matching token bridge registration is reused', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-connect-existing-'));
  const tokenPath = path.join(home, '.config', 'bigbrain', 'connections', 'deals', 'token');
  const calls = [];
  const execFile = async (_command, args) => {
    calls.push(args);
    if (args[1] === 'get') return { stdout: JSON.stringify({ transport: {
      type: 'stdio', command: '/node', args: ['/bridge.mjs', 'https://brain.example/mcp', tokenPath],
    } }) };
    return { stdout: '' };
  };
  try {
    const result = await connectCodex({
      serviceUrl: 'https://brain.example', name: 'deals', auth: 'token', tokenStdin: true, token: 'secret',
    }, { execFile, home, platform: 'linux', nodePath: '/node', bridgePath: '/bridge.mjs' });
    assert.equal(result.migrated_legacy_registration, false);
    assert.equal(calls.some((args) => args[1] === 'add' || args[1] === 'remove'), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('matching legacy HTTP bearer registration migrates to the token bridge', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-connect-migrate-'));
  const calls = [];
  const execFile = async (_command, args) => {
    calls.push(args);
    if (args[1] === 'get') return { stdout: JSON.stringify({ transport: {
      type: 'streamable_http', url: 'https://brain.example/mcp', bearer_token_env_var: 'LEGACY_TOKEN',
    } }) };
    return { stdout: '' };
  };
  try {
    const result = await connectCodex({
      serviceUrl: 'https://brain.example', name: 'deals', auth: 'token', tokenStdin: true, token: 'secret',
    }, { execFile, home, platform: 'linux', nodePath: '/node', bridgePath: '/bridge.mjs' });
    assert.equal(result.migrated_legacy_registration, true);
    assert.ok(calls.some((args) => args.join(' ') === 'mcp remove deals'));
    assert.ok(calls.some((args) => args.slice(0, 5).join(' ') === 'mcp add deals -- /node'));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('failed bridge migration restores the legacy registration and previous token', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-connect-rollback-'));
  const connectionDir = path.join(home, '.config', 'bigbrain', 'connections', 'deals');
  const tokenPath = path.join(connectionDir, 'token');
  await fs.mkdir(connectionDir, { recursive: true });
  await fs.writeFile(tokenPath, 'previous-secret\n', { mode: 0o600 });
  const calls = [];
  const execFile = async (_command, args) => {
    calls.push(args);
    if (args[1] === 'get') return { stdout: JSON.stringify({ transport: {
      type: 'streamable_http', url: 'https://brain.example/mcp', bearer_token_env_var: 'LEGACY_TOKEN',
    } }) };
    if (args[1] === 'add' && args.includes('--')) throw new Error('bridge add failed');
    return { stdout: '' };
  };
  try {
    await assert.rejects(() => connectCodex({
      serviceUrl: 'https://brain.example', name: 'deals', auth: 'token', tokenStdin: true, token: 'new-secret',
    }, { execFile, home, platform: 'linux', nodePath: '/node', bridgePath: '/bridge.mjs' }), /bridge add failed/);
    assert.equal(await fs.readFile(tokenPath, 'utf8'), 'previous-secret\n');
    assert.ok(calls.some((args) => args.join(' ') === 'mcp add deals --url https://brain.example/mcp --bearer-token-env-var LEGACY_TOKEN'));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('successful migration removes only the BigBrain-owned legacy launch agent', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-connect-cleanup-'));
  const launchAgents = path.join(home, 'Library', 'LaunchAgents');
  const ownedPlist = path.join(launchAgents, 'local.bigbrain.codex-token.deals.plist');
  const customPlist = path.join(launchAgents, 'com.dealmaking.mcp-environment.plist');
  await fs.mkdir(launchAgents, { recursive: true });
  await fs.writeFile(ownedPlist, 'owned');
  await fs.writeFile(customPlist, 'custom');
  const calls = [];
  const execFile = async (command, args) => {
    calls.push([command, args]);
    if (command === 'codex' && args[1] === 'get') throw new Error('missing');
    return { stdout: '' };
  };
  try {
    await connectCodex({
      serviceUrl: 'https://brain.example', name: 'deals', auth: 'token', tokenStdin: true, token: 'secret',
    }, { execFile, home, platform: 'darwin', uid: 501, nodePath: '/node', bridgePath: '/bridge.mjs' });
    await assert.rejects(() => fs.access(ownedPlist));
    await fs.access(customPlist);
    assert.ok(calls.some(([command, args]) => command === 'launchctl' && args[0] === 'bootout'));
    assert.ok(calls.some(([command, args]) => command === 'launchctl' && args[0] === 'unsetenv'));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
