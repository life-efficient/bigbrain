import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findBrainLaunchAgent } from '../../electron/lib/launch-agent-discovery.mjs';

test('finds the launch agent serving an existing brain and preserves its port', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-launch-agent-'));
  const brainHome = path.join(root, 'brain & notes');
  const agents = path.join(root, 'LaunchAgents');
  await fs.mkdir(agents);
  await fs.writeFile(path.join(agents, 'local.bigbrain.mcp.plist'), `
<plist><dict><key>Label</key><string>local.bigbrain.mcp</string>
<key>ProgramArguments</key><array><string>/usr/bin/node</string><string>/repo/bin/bigbrain.js</string><string>--brain-home</string><string>${brainHome.replace('&', '&amp;')}</string><string>mcp</string><string>--host</string><string>127.0.0.1</string><string>--port</string><string>3333</string></array></dict></plist>`);
  assert.deepEqual(await findBrainLaunchAgent(brainHome, { launchAgentsDir: agents }), {
    label: 'local.bigbrain.mcp',
    plistPath: path.join(agents, 'local.bigbrain.mcp.plist'),
    port: 3333,
  });
  await fs.rm(root, { recursive: true, force: true });
});

test('ignores launch agents for another brain', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-launch-agent-other-'));
  await fs.writeFile(path.join(root, 'other.plist'), '<plist><dict><key>ProgramArguments</key><array><string>--brain-home</string><string>/another/brain</string></array></dict></plist>');
  assert.equal(await findBrainLaunchAgent('/wanted/brain', { launchAgentsDir: root }), null);
  await fs.rm(root, { recursive: true, force: true });
});
