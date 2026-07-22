#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runHeadlessUpdate({
  repoRoot,
  channel = 'stable',
  nodePath = process.execPath,
  launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents'),
  execFileImpl = execFileAsync,
  fetchImpl = fetch,
  uid = process.getuid?.(),
} = {}) {
  if (!repoRoot) throw new Error('A BigBrain repo root is required.');
  const resolvedRepo = path.resolve(repoRoot);
  const bigbrainBin = path.join(resolvedRepo, 'bin', 'bigbrain.js');
  await fs.access(bigbrainBin);

  const update = await runUpdateCommand({ nodePath, bigbrainBin, channel, execFileImpl });
  const services = update.status === 'updated'
    ? await restartMatchingServices({ resolvedRepo, launchAgentsDir, execFileImpl, fetchImpl, uid })
    : [];
  return { ...update, services };
}

async function runUpdateCommand({ nodePath, bigbrainBin, channel, execFileImpl }) {
  try {
    const { stdout } = await execFileImpl(nodePath, [bigbrainBin, 'update', '--apply', '--channel', channel, '--json']);
    return parseUpdateResult(stdout);
  } catch (error) {
    const result = parseUpdateResult(error?.stdout, { optional: true });
    if (result && ['blocked', 'unsupported'].includes(result.status)) return result;
    throw new Error(result?.reason || error?.stderr?.trim() || error?.message || 'BigBrain update failed.');
  }
}

export async function findRepoLaunchAgents(repoRoot, {
  launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents'),
  execFileImpl = execFileAsync,
} = {}) {
  const expectedBin = path.join(path.resolve(repoRoot), 'bin', 'bigbrain.js');
  const names = await fs.readdir(launchAgentsDir).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const matches = [];
  for (const name of names.filter((entry) => entry.endsWith('.plist'))) {
    const plistPath = path.join(launchAgentsDir, name);
    let parsed;
    try {
      const { stdout } = await execFileImpl('plutil', ['-convert', 'json', '-o', '-', plistPath]);
      parsed = JSON.parse(stdout);
    } catch {
      continue;
    }
    const args = Array.isArray(parsed.ProgramArguments) ? parsed.ProgramArguments : [];
    if (!args.includes(expectedBin) || !args.includes('mcp') || typeof parsed.Label !== 'string') continue;
    matches.push({
      label: parsed.Label,
      plistPath,
      host: argumentValue(args, '--host') || '127.0.0.1',
      port: Number(argumentValue(args, '--port') || 55560),
    });
  }
  return matches;
}

async function restartMatchingServices({ resolvedRepo, launchAgentsDir, execFileImpl, fetchImpl, uid }) {
  const services = await findRepoLaunchAgents(resolvedRepo, { launchAgentsDir, execFileImpl });
  const effectiveUid = uid ?? Number((await execFileImpl('id', ['-u'])).stdout.trim());
  const results = [];
  for (const service of services) {
    await execFileImpl('launchctl', ['kickstart', '-k', `gui/${effectiveUid}/${service.label}`]);
    await verifyService(service, { fetchImpl });
    results.push({ label: service.label, ok: true, host: service.host, port: service.port });
  }
  return results;
}

async function verifyService({ host, port }, { fetchImpl }) {
  const origin = `http://${host}:${port}`;
  await retry(async () => {
    let response = await fetchImpl(`${origin}/ready`);
    if (response.status === 404) response = await fetchImpl(`${origin}/health`);
    if (!response.ok) throw new Error(`readiness returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.ok !== true) throw new Error('readiness did not return ok');
  });
  const initialize = await postJson(fetchImpl, `${origin}/mcp`, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bigbrain-headless-updater', version: '1.0.0' } },
  });
  if (initialize?.error) throw new Error(initialize.error.message || 'MCP initialize failed.');
  const tools = await postJson(fetchImpl, `${origin}/mcp`, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  if (!Array.isArray(tools?.result?.tools) || tools.result.tools.length === 0) throw new Error('MCP tools/list returned no tools.');
}

async function postJson(fetchImpl, url, body) {
  const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return payload;
}

async function retry(callback, { timeoutMs = 15_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await callback(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`BigBrain service did not become ready: ${lastError?.message || 'unknown error'}`);
}

function parseUpdateResult(stdout, { optional = false } = {}) {
  try {
    const parsed = JSON.parse(String(stdout || '').trim());
    if (!parsed || typeof parsed.status !== 'string') throw new Error('missing status');
    return parsed;
  } catch (error) {
    if (optional) return null;
    throw new Error(`BigBrain update returned invalid JSON: ${error.message}`);
  }
}

function argumentValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo-root') options.repoRoot = args[++index];
    else if (arg === '--channel') options.channel = args[++index];
    else if (arg === '--launch-agents-dir') options.launchAgentsDir = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runHeadlessUpdate(parseArgs(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
