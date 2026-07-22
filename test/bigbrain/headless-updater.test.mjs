import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderUpdaterLaunchAgent } from '../../scripts/install-headless-updater.mjs';
import { findRepoLaunchAgents, runHeadlessUpdate } from '../../scripts/run-headless-update.mjs';

test('headless updater launch agent checks stable releases every six hours', () => {
  const plist = renderUpdaterLaunchAgent({
    nodePath: '/usr/local/bin/node', runnerPath: '/repo/scripts/run-headless-update.mjs', repoRoot: '/repo',
    stdoutPath: '/logs/out', stderrPath: '/logs/err',
  });
  assert.match(plist, /local\.bigbrain\.updater/);
  assert.match(plist, /<integer>21600<\/integer>/);
  assert.match(plist, /<string>--channel<\/string><string>stable<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
});

test('headless updater restarts and verifies MCP services only after an applied update', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-headless-update-'));
  const repoRoot = path.join(root, 'repo');
  const agents = path.join(root, 'agents');
  await fs.mkdir(path.join(repoRoot, 'bin'), { recursive: true });
  await fs.mkdir(agents);
  await fs.writeFile(path.join(repoRoot, 'bin', 'bigbrain.js'), '');
  await fs.writeFile(path.join(agents, 'local.bigbrain.example.plist'), 'fixture');
  const calls = [];
  const execFileImpl = async (command, args) => {
    calls.push([command, ...args]);
    if (command === '/node') return { stdout: JSON.stringify({ ok: true, status: 'updated', current_version: '0.15.0', available_version: '0.16.0' }) };
    if (command === 'plutil') return { stdout: JSON.stringify({ Label: 'local.bigbrain.example', ProgramArguments: ['/node', path.join(repoRoot, 'bin', 'bigbrain.js'), 'mcp', '--host', '127.0.0.1', '--port', '55560'] }) };
    return { stdout: '' };
  };
  const fetchImpl = async (_url, options = {}) => ({
    ok: true, status: 200,
    json: async () => options.method === 'POST'
      ? (JSON.parse(options.body).method === 'tools/list' ? { result: { tools: [{ name: 'search' }] } } : { result: { serverInfo: {} } })
      : { ok: true },
  });
  const result = await runHeadlessUpdate({ repoRoot, nodePath: '/node', launchAgentsDir: agents, execFileImpl, fetchImpl, uid: 501 });
  assert.equal(result.services[0].label, 'local.bigbrain.example');
  assert.equal(calls.some((call) => call[0] === 'launchctl' && call.includes('gui/501/local.bigbrain.example')), true);
  await fs.rm(root, { recursive: true, force: true });
});

test('repo launch-agent discovery ignores unrelated services', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-headless-agents-'));
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'other.plist'), 'fixture');
  const matches = await findRepoLaunchAgents(repoRoot, {
    launchAgentsDir: root,
    execFileImpl: async () => ({ stdout: JSON.stringify({ Label: 'other', ProgramArguments: ['/node', '/other/bin/bigbrain.js', 'mcp'] }) }),
  });
  assert.deepEqual(matches, []);
  await fs.rm(root, { recursive: true, force: true });
});
