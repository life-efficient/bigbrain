import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function findBrainLaunchAgent(brainHome, { launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents') } = {}) {
  const wanted = path.resolve(brainHome);
  let names;
  try { names = await fs.readdir(launchAgentsDir); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  for (const name of names.filter((item) => item.endsWith('.plist'))) {
    const plistPath = path.join(launchAgentsDir, name);
    const xml = await fs.readFile(plistPath, 'utf8').catch(() => '');
    const args = plistArray(xml, 'ProgramArguments');
    const homeIndex = args.indexOf('--brain-home');
    if (homeIndex < 0 || !args[homeIndex + 1] || path.resolve(args[homeIndex + 1]) !== wanted) continue;
    const portIndex = args.indexOf('--port');
    const port = Number(args[portIndex + 1]);
    return { label: plistString(xml, 'Label') || path.basename(name, '.plist'), plistPath, port: Number.isInteger(port) ? port : null };
  }
  return null;
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
