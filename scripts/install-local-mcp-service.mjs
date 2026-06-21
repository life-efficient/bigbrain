#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_LABEL = 'local.bigbrain.mcp';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3333;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const brainHome = path.resolve(options.brainHome || await readDefaultBrainHome());
  const label = options.label || DEFAULT_LABEL;
  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port || DEFAULT_PORT);
  const plistPath = options.plistPath || path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const logDir = options.logDir || path.join(os.homedir(), '.config', 'bigbrain');
  const nodePath = options.nodePath || process.execPath;
  const bigbrainBin = options.bigbrainBin || path.join(repoRoot, 'bin', 'bigbrain.js');
  const serviceTarget = `gui/${process.getuid?.() ?? await userId()}/${label}`;

  const plist = renderLaunchAgentPlist({
    label,
    nodePath,
    bigbrainBin,
    brainHome,
    host,
    port,
    workingDirectory: repoRoot,
    stdoutPath: path.join(logDir, 'bigbrain-mcp.log'),
    stderrPath: path.join(logDir, 'bigbrain-mcp.err.log'),
    home: os.homedir(),
  });

  if (options.dryRun) {
    console.log(JSON.stringify({ label, plistPath, serviceTarget, brainHome, host, port, repoRoot }, null, 2));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('The local always-on MCP installer currently supports macOS launchd only.');
  }

  await fs.access(bigbrainBin);
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  await fs.writeFile(plistPath, plist, 'utf8');

  await execFileAsync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath]).catch(() => null);
  await execFileAsync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath]);
  await execFileAsync('launchctl', ['kickstart', '-k', serviceTarget]);

  await verifyHealth({ host, port });
  await verifyMcpTools({ host, port });

  console.log(JSON.stringify({
    ok: true,
    label,
    plistPath,
    serviceTarget,
    brainHome,
    mcpUrl: `http://${host}:${port}/mcp`,
    healthUrl: `http://${host}:${port}/health`,
  }, null, 2));
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

function renderLaunchAgentPlist({
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
}) {
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
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>BIGBRAIN_MCP_AUTH_MODE</key>
    <string>none</string>
    <key>BIGBRAIN_MCP_GIT_BACKUP</key>
    <string>1</string>
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

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function verifyHealth({ host, port }) {
  const url = `http://${host}:${port}/health`;
  const deadline = Date.now() + 15000;
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
  throw new Error(`BigBrain MCP service did not become healthy at ${url}: ${lastError?.message || 'unknown error'}`);
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

async function userId() {
  const { stdout } = await execFileAsync('id', ['-u']);
  return stdout.trim();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
