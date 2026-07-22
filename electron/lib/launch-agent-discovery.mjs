import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function findBrainLaunchAgent(brainHome, { launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents') } = {}) {
  const wanted = path.resolve(brainHome);
  const agents = await discoverBrainLaunchAgents({ launchAgentsDir });
  const agent = agents.find((item) => item.home === wanted);
  return agent ? { label: agent.label, plistPath: agent.plistPath, port: agent.port } : null;
}

export async function discoverBrainLaunchAgents({ launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents') } = {}) {
  let names;
  try { names = await fs.readdir(launchAgentsDir); } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const agents = [];
  for (const name of names.filter((item) => item.endsWith('.plist')).sort()) {
    const plistPath = path.join(launchAgentsDir, name);
    const xml = await fs.readFile(plistPath, 'utf8').catch(() => '');
    const args = plistArray(xml, 'ProgramArguments');
    const homeIndex = args.indexOf('--brain-home');
    if (homeIndex < 0 || !args[homeIndex + 1]) continue;
    const portIndex = args.indexOf('--port');
    const port = Number(args[portIndex + 1]);
    const hostIndex = args.indexOf('--host');
    const host = normalizeLoopbackHost(args[hostIndex + 1]);
    agents.push({
      label: plistString(xml, 'Label') || path.basename(name, '.plist'),
      plistPath,
      home: path.resolve(args[homeIndex + 1]),
      host,
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
    });
  }
  return agents;
}

function normalizeLoopbackHost(value) {
  if (value === '::1' || value === '::') return '[::1]';
  return '127.0.0.1';
}

function plistString(xml, key) {
  return decodeXml(xml.match(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`))?.[1] || '');
}
function plistArray(xml, key) {
  const body = xml.match(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1] || '';
  return [...body.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) => decodeXml(match[1]));
}
function decodeXml(value) {
  return value.replaceAll('&apos;', "'").replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
}
