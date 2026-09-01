#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { formatServiceInstallError } from '../electron/lib/service-errors.mjs';

const execFileAsync = promisify(execFile);

const DEFAULT_LABEL = 'local.bigbrain.mcp';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 55560;
const SERVICE_START_TIMEOUT_MS = 60_000;
const PORT_RELEASE_TIMEOUT_MS = 10_000;
const SERVICE_MANAGER_DESKTOP = 'desktop';
const SERVICE_MANAGER_SOURCE = 'source';
const SERVICE_SOURCE_DESKTOP_BUNDLE = 'desktop-bundle';
const SERVICE_SOURCE_CHECKOUT = 'source-checkout';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const brainHome = path.resolve(options.brainHome || await readDefaultBrainHome());
  const label = options.label || DEFAULT_LABEL;
  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port || DEFAULT_PORT);
  const localPersonSlug = normalizeLocalPersonSlug(options.localPersonSlug || '');
  const localOwnerEmail = options.localOwnerEmail || '';
  const localOwnerName = options.localOwnerName || '';
  const keychainAccount = options.keychainAccount || '';
  const gitBackupEnabled = options.gitBackup !== false;
  const electronRunAsNode = Boolean(options.electronRunAsNode);
  const serviceManager = options.serviceManager || (electronRunAsNode ? SERVICE_MANAGER_DESKTOP : SERVICE_MANAGER_SOURCE);
  const serviceSource = options.serviceSource || (serviceManager === SERVICE_MANAGER_DESKTOP ? SERVICE_SOURCE_DESKTOP_BUNDLE : SERVICE_SOURCE_CHECKOUT);
  const dashboardDev = process.env.BIGBRAIN_DASHBOARD_DEV === '1';
  validateServiceOwnershipMarkers({ serviceManager, serviceSource });
  const installAutomaticUpdater = serviceManager === SERVICE_MANAGER_SOURCE && !options.noAutoUpdate;
  const plistPath = options.plistPath || path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const logDir = options.logDir || path.join(os.homedir(), '.config', 'bigbrain');
  const nodePath = options.nodePath || process.execPath;
  const bigbrainBin = options.bigbrainBin || path.join(repoRoot, 'bin', 'bigbrain.js');
  const serviceTarget = `gui/${process.getuid?.() ?? await userId()}/${label}`;
  const replacementPlist = options.replacePlist ? path.resolve(options.replacePlist) : null;
  const logStem = label === DEFAULT_LABEL ? 'bigbrain-mcp' : safeLogStem(label);
  const stdoutPath = path.join(logDir, `${logStem}.log`);
  const stderrPath = path.join(logDir, `${logStem}.err.log`);

  const plist = renderLaunchAgentPlist({
    label,
    nodePath,
    bigbrainBin,
    brainHome,
    host,
    port,
    workingDirectory: repoRoot,
    stdoutPath,
    stderrPath,
    home: os.homedir(),
    localPersonSlug,
    keychainAccount,
    electronRunAsNode,
    serviceManager,
    serviceSource,
    dashboardDev,
    gitBackupEnabled,
  });

  if (options.dryRun) {
    console.log(JSON.stringify({
      label,
      plistPath,
      serviceTarget,
      brainHome,
      host,
      port,
      repoRoot,
      localPersonSlug,
      localOwnerEmail,
      localOwnerName,
      keychainAccount,
      electronRunAsNode,
      serviceManager,
      serviceSource,
      dashboardDev,
      gitBackupEnabled,
      installAutomaticUpdater,
      stdoutPath,
      stderrPath,
      serviceStartTimeoutMs: SERVICE_START_TIMEOUT_MS,
      wouldEnsureLocalOwner: Boolean(localPersonSlug),
      replacementPlist,
    }, null, 2));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('The local always-on MCP installer currently supports macOS launchd only.');
  }

  await fs.access(bigbrainBin);
  if (localPersonSlug) {
    await ensureLocalOwner({
      nodePath,
      bigbrainBin,
      brainHome,
      personSlug: localPersonSlug,
      email: localOwnerEmail,
      name: localOwnerName,
    });
  }
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  const previousTarget = await fs.readFile(plistPath).catch(() => null);
  const previousReplacement = replacementPlist ? await fs.readFile(replacementPlist).catch(() => null) : null;
  try {
    if (replacementPlist) await execFileAsync('launchctl', ['bootout', `gui/${process.getuid()}`, replacementPlist]).catch(() => null);
    await execFileAsync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath]).catch(() => null);
    await waitForPortAvailable({ host, port });
    await fs.writeFile(plistPath, plist, 'utf8');
    await execFileAsync('launchctl', ['enable', serviceTarget]);
    await execFileAsync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath]);
    await execFileAsync('launchctl', ['kickstart', '-k', serviceTarget]);
    await verifyHealth({ host, port, stderrPath });
    await verifyMcpTools({ host, port });
    if (installAutomaticUpdater) {
      const { installHeadlessUpdater } = await import('./install-headless-updater.mjs');
      await installHeadlessUpdater({ repoRoot, channel: options.updateChannel || 'stable' });
    }
    if (replacementPlist) await fs.rename(replacementPlist, `${replacementPlist}.replaced-${Date.now()}.bak`).catch(() => null);
  } catch (error) {
    await execFileAsync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath]).catch(() => null);
    if (previousTarget) await fs.writeFile(plistPath, previousTarget); else await fs.rm(plistPath, { force: true });
    if (previousReplacement && replacementPlist) {
      await fs.writeFile(replacementPlist, previousReplacement);
      await execFileAsync('launchctl', ['bootstrap', `gui/${process.getuid()}`, replacementPlist]).catch(() => null);
    } else if (previousTarget) {
      await execFileAsync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath]).catch(() => null);
    }
    throw error;
  }

  console.log(JSON.stringify({
    ok: true,
    label,
    plistPath,
    serviceTarget,
    brainHome,
    mcpUrl: `http://${host}:${port}/mcp`,
    healthUrl: `http://${host}:${port}/health`,
    localPersonSlug,
    localOwnerEnsured: Boolean(localPersonSlug),
    automaticUpdaterInstalled: installAutomaticUpdater,
  }, null, 2));
}

function safeLogStem(label) {
  return label.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'bigbrain-mcp';
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--brain-home':
        options.brainHome = args[++index];
        break;
      case '--repo-root':
        options.repoRoot = args[++index];
        break;
      case '--host':
        options.host = args[++index];
        break;
      case '--port':
        options.port = args[++index];
        break;
      case '--label':
        options.label = args[++index];
        break;
      case '--plist-path':
        options.plistPath = args[++index];
        break;
      case '--log-dir':
        options.logDir = args[++index];
        break;
      case '--node-path':
        options.nodePath = args[++index];
        break;
      case '--bigbrain-bin':
        options.bigbrainBin = args[++index];
        break;
      case '--local-person-slug':
        options.localPersonSlug = args[++index];
        break;
      case '--local-owner-email':
        options.localOwnerEmail = args[++index];
        break;
      case '--local-owner-name':
        options.localOwnerName = args[++index];
        break;
      case '--keychain-account':
        options.keychainAccount = args[++index];
        break;
      case '--electron-run-as-node':
        options.electronRunAsNode = true;
        break;
      case '--no-auto-update':
        options.noAutoUpdate = true;
        break;
      case '--git-backup':
        options.gitBackup = true;
        break;
      case '--no-git-backup':
        options.gitBackup = false;
        break;
      case '--update-channel':
        options.updateChannel = args[++index];
        break;
      case '--service-manager':
        options.serviceManager = args[++index];
        break;
      case '--service-source':
        options.serviceSource = args[++index];
        break;
      case '--replace-plist':
        options.replacePlist = args[++index];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function readDefaultBrainHome() {
  const pointerPath = path.join(os.homedir(), '.config', 'bigbrain', 'default-brain-home');
  const value = (await fs.readFile(pointerPath, 'utf8')).trim();
  if (!value) throw new Error(`${pointerPath} is empty.`);
  return value;
}

export function renderLaunchAgentPlist({
  label,
  nodePath,
  bigbrainBin,
  brainHome,
  host,
  port,
  workingDirectory,
  stdoutPath,
  stderrPath,
  home,
  localPersonSlug,
  keychainAccount,
  electronRunAsNode,
  serviceManager = electronRunAsNode ? SERVICE_MANAGER_DESKTOP : SERVICE_MANAGER_SOURCE,
  serviceSource = serviceManager === SERVICE_MANAGER_DESKTOP ? SERVICE_SOURCE_DESKTOP_BUNDLE : SERVICE_SOURCE_CHECKOUT,
  dashboardDev = false,
  gitBackupEnabled = true,
}) {
  validateServiceOwnershipMarkers({ serviceManager, serviceSource });
  const args = [
    nodePath,
    bigbrainBin,
    '--brain-home',
    brainHome,
    'mcp',
    '--host',
    host,
    '--port',
    String(port),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xmlEscape(home)}</string>
${electronRunAsNode ? `    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
` : ''}    <key>BIGBRAIN_SERVICE_MANAGER</key>
    <string>${xmlEscape(serviceManager)}</string>
    <key>BIGBRAIN_SERVICE_SOURCE</key>
    <string>${xmlEscape(serviceSource)}</string>
${dashboardDev ? `    <key>BIGBRAIN_DASHBOARD_DEV</key>
    <string>1</string>
` : ''}    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>BIGBRAIN_MCP_AUTH_MODE</key>
    <string>none</string>
${localPersonSlug ? `    <key>BIGBRAIN_MCP_LOCAL_PERSON_SLUG</key>
    <string>${xmlEscape(localPersonSlug)}</string>
` : ''}${keychainAccount ? `    <key>BIGBRAIN_OPENAI_KEYCHAIN_ACCOUNT</key>
    <string>${xmlEscape(keychainAccount)}</string>
` : ''}    <key>BIGBRAIN_MCP_GIT_BACKUP</key>
    <string>${gitBackupEnabled ? '1' : '0'}</string>
    <key>BIGBRAIN_MCP_SYNC_INTERVAL_MS</key>
    <string>300000</string>
    <key>BIGBRAIN_MCP_GIT_BACKUP_INTERVAL_MS</key>
    <string>300000</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function validateServiceOwnershipMarkers({ serviceManager, serviceSource }) {
  const validManager = serviceManager === SERVICE_MANAGER_DESKTOP || serviceManager === SERVICE_MANAGER_SOURCE;
  if (!validManager) throw new Error('--service-manager must be desktop or source.');
  const expectedSource = serviceManager === SERVICE_MANAGER_DESKTOP
    ? SERVICE_SOURCE_DESKTOP_BUNDLE
    : SERVICE_SOURCE_CHECKOUT;
  if (serviceSource !== expectedSource) {
    throw new Error(`--service-source must be ${expectedSource} when --service-manager is ${serviceManager}.`);
  }
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeLocalPersonSlug(value) {
  const normalized = String(value || '').trim().replace(/\.md$/i, '');
  if (normalized && !normalized.startsWith('people/')) {
    throw new Error('--local-person-slug must be a people/<slug> page slug.');
  }
  return normalized;
}

async function verifyHealth({ host, port, stderrPath = null }) {
  const url = `http://${host}:${port}/health`;
  const deadline = Date.now() + SERVICE_START_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Health check returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  const logHint = stderrPath ? ` Check the local service diagnostics at ${stderrPath}.` : '';
  throw new Error(`BigBrain MCP service did not become healthy at ${url} within ${SERVICE_START_TIMEOUT_MS / 1000} seconds.${logHint}`);
}

async function ensureLocalOwner({
  nodePath,
  bigbrainBin,
  brainHome,
  personSlug,
  email,
  name,
}) {
  const args = [
    bigbrainBin,
    '--brain-home',
    brainHome,
    'members',
    'ensure-local-owner',
    personSlug,
  ];
  if (email) args.push('--email', email);
  if (name) args.push('--name', name);
  await execFileAsync(nodePath, args);
}

async function verifyMcpTools({ host, port }) {
  const url = `http://${host}:${port}/mcp`;
  await postJsonRpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bigbrain-installer', version: '1.0.0' } } });
  const tools = await postJsonRpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  if (!Array.isArray(tools?.result?.tools) || tools.result.tools.length === 0) {
    throw new Error('MCP tools/list returned no tools.');
  }
}

async function postJsonRpc(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`JSON-RPC ${payload.method} failed: ${data.error?.message || response.status}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertPortAvailable({ host, port }) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Refusing to start BigBrain: fixed port ${port} is already in use. Stop the conflicting service; BigBrain never selects a fallback port.`));
      } else {
        reject(error);
      }
    });
    probe.listen({ host, port, exclusive: true }, () => probe.close(resolve));
  });
}

async function waitForPortAvailable({ host, port, timeoutMs = PORT_RELEASE_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await assertPortAvailable({ host, port });
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`Local port ${port} is still occupied after BigBrain stopped the registered service. The existing service was left in place.${lastError ? ` ${lastError.message}` : ''}`);
}

async function userId() {
  const { stdout } = await execFileAsync('id', ['-u']);
  return stdout.trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(formatServiceInstallError(error, {
      brainName: argumentValue('--brain-home') ? path.basename(argumentValue('--brain-home')) : 'this brain',
      port: argumentValue('--port') || DEFAULT_PORT,
    }));
    process.exitCode = 1;
  });
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}
