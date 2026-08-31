import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SERVICE_OWNERSHIPS } from './brain-registry.mjs';

const SERVICE_MANAGER_ENV = 'BIGBRAIN_SERVICE_MANAGER';
const SERVICE_SOURCE_ENV = 'BIGBRAIN_SERVICE_SOURCE';

export async function findBrainLaunchAgent(brainHome, { launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents') } = {}) {
  const wanted = path.resolve(brainHome);
  const agents = await discoverBrainLaunchAgents({ launchAgentsDir });
  const agent = agents.find((item) => item.home === wanted);
  return agent || null;
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
    const environment = plistDictionaryStrings(xml, 'EnvironmentVariables');
    const workingDirectory = plistString(xml, 'WorkingDirectory') || null;
    const bigbrainBin = findBigBrainBin(args);
    const serviceManager = environment[SERVICE_MANAGER_ENV] || null;
    const serviceSource = environment[SERVICE_SOURCE_ENV] || null;
    const ownership = classifyLaunchAgentOwnership({
      bigbrainBin,
      workingDirectory,
      serviceManager,
      serviceSource,
    });
    agents.push({
      label: plistString(xml, 'Label') || path.basename(name, '.plist'),
      plistPath,
      home: path.resolve(args[homeIndex + 1]),
      host,
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
      programPath: args[0] || null,
      bigbrainBin,
      workingDirectory,
      serviceManager,
      serviceSource,
      ownership: ownership.ownership,
      ownershipReason: ownership.reason,
    });
  }
  return agents;
}

export function classifyLaunchAgentOwnership(agent, { appPath = null } = {}) {
  const manager = optionalMarker(agent?.serviceManager);
  const source = optionalMarker(agent?.serviceSource);
  const hasMarker = Boolean(manager || source);

  if (hasMarker) {
    const desktopMarker = (!manager || manager === 'desktop')
      && (!source || source === 'desktop-bundle');
    const sourceMarker = (!manager || manager === 'source')
      && (!source || source === 'source-checkout');
    if (desktopMarker) {
      if (resolvedPath(appPath) && !isCurrentAppBundleAgent(agent, resolvedPath(appPath))) {
        return { ownership: SERVICE_OWNERSHIPS.DESKTOP_BUNDLE, reason: 'desktop_bundle_path_mismatch' };
      }
      return { ownership: SERVICE_OWNERSHIPS.DESKTOP_BUNDLE, reason: 'launch_agent_marker' };
    }
    if (sourceMarker) return { ownership: SERVICE_OWNERSHIPS.SOURCE, reason: 'launch_agent_marker' };
    return { ownership: SERVICE_OWNERSHIPS.UNKNOWN, reason: 'conflicting_launch_agent_markers' };
  }

  const bigbrainBin = resolvedPath(agent?.bigbrainBin);
  const workingDirectory = resolvedPath(agent?.workingDirectory);
  const resolvedAppPath = resolvedPath(appPath);
  if (resolvedAppPath
    && bigbrainBin
    && isPathInside(bigbrainBin, resolvedAppPath)
    && (!workingDirectory || isPathInside(workingDirectory, resolvedAppPath))) {
    return { ownership: SERVICE_OWNERSHIPS.DESKTOP_BUNDLE, reason: 'current_app_bundle_path' };
  }
  if (isMacAppBundlePath(bigbrainBin) || isMacAppBundlePath(workingDirectory)) {
    return { ownership: SERVICE_OWNERSHIPS.DESKTOP_BUNDLE, reason: 'legacy_app_bundle_path' };
  }
  if (bigbrainBin && workingDirectory && bigbrainBin === path.join(workingDirectory, 'bin', 'bigbrain.js')) {
    return { ownership: SERVICE_OWNERSHIPS.SOURCE, reason: 'source_checkout_path' };
  }
  return { ownership: SERVICE_OWNERSHIPS.UNKNOWN, reason: 'insufficient_launch_agent_evidence' };
}

function isCurrentAppBundleAgent(agent, appPath) {
  const bigbrainBin = resolvedPath(agent?.bigbrainBin);
  const workingDirectory = resolvedPath(agent?.workingDirectory);
  return Boolean(
    bigbrainBin
      && isPathInside(bigbrainBin, appPath)
      && (!workingDirectory || isPathInside(workingDirectory, appPath)),
  );
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
function plistDictionaryStrings(xml, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = xml.match(new RegExp(`<key>\\s*${escapedKey}\\s*</key>\\s*<dict>([\\s\\S]*?)</dict>`))?.[1] || '';
  const values = {};
  for (const match of body.matchAll(/<key>\s*([\s\S]*?)\s*<\/key>\s*<string>([\s\S]*?)<\/string>/g)) {
    values[decodeXml(match[1])] = decodeXml(match[2]);
  }
  return values;
}
function decodeXml(value) {
  return value.replaceAll('&apos;', "'").replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
}

function findBigBrainBin(args) {
  return args.find((value) => /(?:^|\/)bin\/bigbrain\.js$/.test(value)) || null;
}

function optionalMarker(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function resolvedPath(value) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) return null;
  return path.resolve(value);
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isMacAppBundlePath(value) {
  return typeof value === 'string' && /\.app\/Contents\/Resources\/(?:app|app\.asar)(?:\/|$)/i.test(value);
}
