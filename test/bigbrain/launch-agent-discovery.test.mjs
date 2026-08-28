import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classifyLaunchAgentOwnership,
  discoverBrainLaunchAgents,
  findBrainLaunchAgent,
} from '../../electron/lib/launch-agent-discovery.mjs';

test('finds the launch agent serving an existing brain and preserves its port', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-launch-agent-'));
  const brainHome = path.join(root, 'brain & notes');
  const agents = path.join(root, 'LaunchAgents');
  await fs.mkdir(agents);
  await fs.writeFile(path.join(agents, 'local.bigbrain.mcp.plist'), `
<plist><dict><key>Label</key><string>local.bigbrain.mcp</string>
<key>ProgramArguments</key><array><string>/usr/bin/node</string><string>/repo/bin/bigbrain.js</string><string>--brain-home</string><string>${brainHome.replace('&', '&amp;')}</string><string>mcp</string><string>--host</string><string>127.0.0.1</string><string>--port</string><string>3333</string></array></dict></plist>`);
  const agent = await findBrainLaunchAgent(brainHome, { launchAgentsDir: agents });
  assert.equal(agent.label, 'local.bigbrain.mcp');
  assert.equal(agent.plistPath, path.join(agents, 'local.bigbrain.mcp.plist'));
  assert.equal(agent.port, 3333);
  assert.equal(agent.bigbrainBin, '/repo/bin/bigbrain.js');
  assert.equal(agent.ownership, 'unknown');
  await fs.rm(root, { recursive: true, force: true });
});

test('classifies explicit desktop and source markers and rejects conflicts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-launch-agent-owner-'));
  await fs.writeFile(path.join(root, 'desktop.plist'), launchAgent({
    label: 'ai.diffusing.bigbrain.desktop',
    brainHome: '/brains/desktop',
    workingDirectory: '/Applications/BigBrain.app/Contents/Resources/app',
    bigbrainBin: '/Applications/BigBrain.app/Contents/Resources/app/bin/bigbrain.js',
    manager: 'desktop',
    source: 'desktop-bundle',
  }));
  await fs.writeFile(path.join(root, 'source.plist'), launchAgent({
    label: 'ai.diffusing.bigbrain.source',
    brainHome: '/brains/source',
    workingDirectory: '/Users/example/projects/bigbrain',
    bigbrainBin: '/Users/example/projects/bigbrain/bin/bigbrain.js',
    manager: 'source',
    source: 'source-checkout',
  }));
  const agents = await discoverBrainLaunchAgents({ launchAgentsDir: root });
  assert.deepEqual(agents.map(({ ownership, ownershipReason }) => ({ ownership, ownershipReason })), [
    { ownership: 'desktop_bundle', ownershipReason: 'launch_agent_marker' },
    { ownership: 'source', ownershipReason: 'launch_agent_marker' },
  ]);
  assert.deepEqual(classifyLaunchAgentOwnership({ serviceManager: 'desktop', serviceSource: 'source-checkout' }), {
    ownership: 'unknown', reason: 'conflicting_launch_agent_markers',
  });
  await fs.rm(root, { recursive: true, force: true });
});

test('legacy path classification distinguishes app bundles from source checkouts', () => {
  assert.equal(classifyLaunchAgentOwnership({
    bigbrainBin: '/Applications/BigBrain.app/Contents/Resources/app/bin/bigbrain.js',
    workingDirectory: '/Applications/BigBrain.app/Contents/Resources/app',
  }).ownership, 'desktop_bundle');
  assert.equal(classifyLaunchAgentOwnership({
    bigbrainBin: '/Users/example/projects/bigbrain/bin/bigbrain.js',
    workingDirectory: '/Users/example/projects/bigbrain',
  }).ownership, 'source');
  assert.equal(classifyLaunchAgentOwnership({ bigbrainBin: '/opt/tools/bigbrain.js' }).ownership, 'unknown');
});

function launchAgent({ label, brainHome, workingDirectory, bigbrainBin, manager, source }) {
  return `<plist><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>/usr/bin/node</string><string>${bigbrainBin}</string><string>--brain-home</string><string>${brainHome}</string><string>mcp</string><string>--host</string><string>127.0.0.1</string><string>--port</string><string>55560</string></array>
<key>WorkingDirectory</key><string>${workingDirectory}</string>
<key>EnvironmentVariables</key><dict><key>BIGBRAIN_SERVICE_MANAGER</key><string>${manager}</string><key>BIGBRAIN_SERVICE_SOURCE</key><string>${source}</string></dict>
</dict></plist>`;
}

test('ignores launch agents for another brain', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-launch-agent-other-'));
  await fs.writeFile(path.join(root, 'other.plist'), '<plist><dict><key>ProgramArguments</key><array><string>--brain-home</string><string>/another/brain</string></array></dict></plist>');
  assert.equal(await findBrainLaunchAgent('/wanted/brain', { launchAgentsDir: root }), null);
  await fs.rm(root, { recursive: true, force: true });
});
