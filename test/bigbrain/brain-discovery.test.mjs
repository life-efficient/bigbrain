import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverLocalBrains, findBrainConfigPath } from '../../electron/lib/brain-discovery.mjs';
import { discoverBrainLaunchAgents } from '../../electron/lib/launch-agent-discovery.mjs';

test('discovers current, historical, pointed, and running local brains without duplicates', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-discovery-'));
  const support = path.join(home, 'Library', 'Application Support', 'BigBrain');
  const agents = path.join(home, 'Library', 'LaunchAgents');
  const pointed = path.join(home, 'projects', 'brain');
  const managed = path.join(support, 'brains', 'managed-id');
  const legacy = path.join(home, 'bigbrain-home');
  const intermediate = path.join(home, 'Documents', 'brain');
  const externallyIndexed = path.join(home, 'elsewhere', 'notes');

  await writeConfig(path.join(pointed, '.bigbrain-state', 'config.json'), pointed, 'brn_pointed', 'Personal Brain');
  await writeConfig(path.join(managed, '.bigbrain-state', 'config.json'), managed, 'brn_managed', 'Managed Brain');
  await writeConfig(path.join(legacy, '.bigbrain', 'config.json'), legacy, 'brn_legacy', 'Legacy Brain');
  await writeConfig(path.join(intermediate, '.bigbrain-state', 'brains', 'old-id', 'config.json'), intermediate, 'brn_intermediate', 'Intermediate Brain');
  await writeConfig(path.join(home, '.bigbrain-state', 'brains', 'external-id', 'config.json'), externallyIndexed, 'brn_external', 'Indexed Brain');
  await fs.mkdir(path.join(home, '.config', 'bigbrain'), { recursive: true });
  await fs.writeFile(path.join(home, '.config', 'bigbrain', 'default-brain-home'), `${pointed}\n`);
  await fs.mkdir(agents, { recursive: true });
  await fs.writeFile(path.join(agents, 'local.bigbrain.mcp.plist'), launchAgent(pointed, 55560));

  const requests = [];
  const brains = await discoverLocalBrains({
    home,
    env: { HOME: home },
    appSupport: support,
    launchAgentsDir: agents,
    registeredBrains: [{ id: 'brn_managed', home: managed }],
    fetchImpl: async (url) => {
      requests.push(url);
      if (url === 'http://127.0.0.1:55560/health') return jsonResponse({ ok: true, brain_id: 'brn_pointed', brain_name: 'Personal Brain' });
      return new Response('', { status: 503 });
    },
  });

  assert.deepEqual(brains.map((brain) => brain.id).sort(), ['brn_external', 'brn_intermediate', 'brn_legacy', 'brn_pointed']);
  const personal = brains.find((brain) => brain.id === 'brn_pointed');
  assert.equal(personal.status, 'running');
  assert.equal(personal.serviceUrl, 'http://127.0.0.1:55560');
  assert.equal(brains.some((brain) => brain.id === 'brn_managed'), false);
  assert.deepEqual(requests.sort(), ['http://127.0.0.1:3333/health', 'http://127.0.0.1:55560/health']);
  assert.equal(await findBrainConfigPath(intermediate, { home }), path.join(intermediate, '.bigbrain-state', 'brains', 'old-id', 'config.json'));
  assert.equal(await findBrainConfigPath(externallyIndexed, { home }), path.join(home, '.bigbrain-state', 'brains', 'external-id', 'config.json'));
  await fs.rm(home, { recursive: true, force: true });
});

test('discovers a running loopback service even when no brain folder is known', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-service-discovery-'));
  const brains = await discoverLocalBrains({
    home,
    env: { HOME: home },
    fetchImpl: async (url) => url.includes(':3333/')
      ? jsonResponse({ ok: true, brain_id: 'brn_service', brain_name: 'Running Brain' })
      : new Response('', { status: 404 }),
  });
  assert.deepEqual(brains, [{
    id: 'brn_service', name: 'Running Brain', home: null, serviceUrl: 'http://127.0.0.1:3333', status: 'running', sources: ['Running service'],
  }]);
  await fs.rm(home, { recursive: true, force: true });
});

test('launch-agent discovery extracts all BigBrain homes and normalizes service hosts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-agent-discovery-'));
  await fs.writeFile(path.join(root, 'one.plist'), launchAgent('/tmp/brain & notes', 3333));
  await fs.writeFile(path.join(root, 'two.plist'), launchAgent('/tmp/second', 55560, '0.0.0.0'));
  const agents = await discoverBrainLaunchAgents({ launchAgentsDir: root });
  assert.deepEqual(agents.map((agent) => ({ home: agent.home, host: agent.host, port: agent.port })), [
    { home: '/tmp/brain & notes', host: '127.0.0.1', port: 3333 },
    { home: '/tmp/second', host: '127.0.0.1', port: 55560 },
  ]);
  await fs.rm(root, { recursive: true, force: true });
});

async function writeConfig(configPath, brainHome, brainId, brainName) {
  await fs.mkdir(brainHome, { recursive: true });
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ brain_id: brainId, brain_name: brainName, brain_dir: brainHome }));
}

function launchAgent(brainHome, port, host = '127.0.0.1') {
  const escaped = brainHome.replaceAll('&', '&amp;');
  return `<plist><dict><key>Label</key><string>local.bigbrain.mcp</string><key>ProgramArguments</key><array><string>/usr/bin/node</string><string>--brain-home</string><string>${escaped}</string><string>mcp</string><string>--host</string><string>${host}</string><string>--port</string><string>${port}</string></array></dict></plist>`;
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
