import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileDefault = promisify(execFileCallback);

export function normalizeMcpEndpoint(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('connect codex requires a valid service URL.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The service URL must use http or https.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Remote MCP connections must use https.');
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(connect|mcp)$/, '') + '/mcp';
  return url.toString();
}

export function deriveServerName(endpoint, explicitName = '') {
  const source = explicitName.trim() || new URL(endpoint).hostname.split('.')[0] || 'bigbrain';
  const name = source.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) throw new Error('Unable to derive a Codex server name; pass --name NAME.');
  return name;
}

export function tokenEnvironmentName(serverName) {
  const stem = serverName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'REMOTE';
  const suffix = crypto.createHash('sha256').update(serverName).digest('hex').slice(0, 8).toUpperCase();
  return `BIGBRAIN_${stem}_${suffix}_MCP_TOKEN`;
}

export async function connectCodex(options, dependencies = {}) {
  const execFile = dependencies.execFile || execFileDefault;
  const fileSystem = dependencies.fs || fs;
  const home = dependencies.home || os.homedir();
  const platform = dependencies.platform || process.platform;
  const nodePath = dependencies.nodePath || process.execPath;
  const bridgePath = dependencies.bridgePath || fileURLToPath(new URL('../../bin/bigbrain-mcp-http-stdio-bridge.js', import.meta.url));
  const endpoint = normalizeMcpEndpoint(options.serviceUrl);
  const name = deriveServerName(endpoint, options.name || '');
  const auth = options.auth || 'oauth';
  if (!['oauth', 'token'].includes(auth)) throw new Error('--auth must be oauth or token.');

  let token = '';
  if (auth === 'token') {
    if (!options.tokenStdin) throw new Error('Token authentication requires --token-stdin.');
    token = String(options.token || '').trim();
    if (!token) throw new Error('No token was provided on stdin.');
  }

  if (auth === 'oauth') {
    await ensureOAuthRegistration({ execFile, name, endpoint });
    await execFile('codex', ['mcp', 'login', name]);
    return { ok: true, name, endpoint, auth, restart_codex_required: false };
  }

  const connectionDir = path.join(home, '.config', 'bigbrain', 'connections', name);
  const tokenPath = path.join(connectionDir, 'token');
  const previousToken = await readOptionalFile(fileSystem, tokenPath);
  await writePrivateTokenFile({ fileSystem, connectionDir, tokenPath, token });
  let registration;
  try {
    registration = await ensureTokenBridgeRegistration({ execFile, name, endpoint, nodePath, bridgePath, tokenPath });
  } catch (error) {
    await restoreTokenFile({ fileSystem, connectionDir, tokenPath, previousToken });
    throw error;
  }
  await cleanupLegacyTokenLaunchAgent({
    execFile,
    fileSystem,
    home,
    name,
    platform,
    uid: dependencies.uid ?? (typeof process.getuid === 'function' ? process.getuid() : null),
  });
  return {
    ok: true,
    name,
    endpoint,
    auth,
    transport: 'stdio_bridge',
    migrated_legacy_registration: registration.migrated,
    restart_codex_required: false,
    new_task_required: true,
  };
}

async function ensureOAuthRegistration({ execFile, name, endpoint }) {
  const existing = await getCodexRegistration(execFile, name);
  if (existing) {
    const existingUrl = httpRegistration(existing).url;
    if (existingUrl === endpoint && !httpRegistration(existing).bearerTokenEnv) return;
    throw new Error(`Codex MCP server "${name}" already exists with different connection settings.`);
  }
  await execFile('codex', ['mcp', 'add', name, '--url', endpoint]);
}

async function ensureTokenBridgeRegistration({ execFile, name, endpoint, nodePath, bridgePath, tokenPath }) {
  const desiredArgs = [bridgePath, endpoint, tokenPath];
  const existing = await getCodexRegistration(execFile, name);
  if (!existing) {
    await addTokenBridgeRegistration({ execFile, name, nodePath, desiredArgs });
    return { migrated: false };
  }
  const stdio = stdioRegistration(existing);
  if (stdio.command === nodePath && arraysEqual(stdio.args, desiredArgs)) return { migrated: false };
  const legacy = httpRegistration(existing);
  if (legacy.url !== endpoint || !legacy.bearerTokenEnv) {
    throw new Error(`Codex MCP server "${name}" already exists with different connection settings.`);
  }
  await execFile('codex', ['mcp', 'remove', name]);
  try {
    await addTokenBridgeRegistration({ execFile, name, nodePath, desiredArgs });
  } catch (error) {
    await execFile('codex', [
      'mcp', 'add', name, '--url', legacy.url, '--bearer-token-env-var', legacy.bearerTokenEnv,
    ]).catch(() => null);
    throw error;
  }
  return { migrated: true };
}

async function getCodexRegistration(execFile, name) {
  try {
    const result = await execFile('codex', ['mcp', 'get', name, '--json']);
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function addTokenBridgeRegistration({ execFile, name, nodePath, desiredArgs }) {
  return execFile('codex', ['mcp', 'add', name, '--', nodePath, ...desiredArgs]);
}

function httpRegistration(existing) {
  const transport = existing.transport?.streamable_http || existing.transport || existing;
  return {
    url: existing.url || transport?.url || null,
    bearerTokenEnv: existing.bearer_token_env_var || transport?.bearer_token_env_var || null,
  };
}

function stdioRegistration(existing) {
  const transport = existing.transport?.stdio || existing.transport || existing;
  if (transport?.type && transport.type !== 'stdio') return { command: null, args: [] };
  return { command: transport?.command || null, args: transport?.args || [] };
}

async function writePrivateTokenFile({ fileSystem, connectionDir, tokenPath, token }) {
  await fileSystem.mkdir(connectionDir, { recursive: true, mode: 0o700 });
  await fileSystem.chmod(connectionDir, 0o700);
  const tempPath = `${tokenPath}.${crypto.randomUUID()}.tmp`;
  try {
    await fileSystem.writeFile(tempPath, `${token}\n`, { mode: 0o600, flag: 'wx' });
    await fileSystem.chmod(tempPath, 0o600);
    await fileSystem.rename(tempPath, tokenPath);
  } finally {
    await fileSystem.rm(tempPath, { force: true }).catch(() => null);
  }
}

async function restoreTokenFile({ fileSystem, connectionDir, tokenPath, previousToken }) {
  if (previousToken === null) {
    await fileSystem.rm(tokenPath, { force: true }).catch(() => null);
    return;
  }
  await writePrivateTokenFile({ fileSystem, connectionDir, tokenPath, token: previousToken.trim() });
}

async function readOptionalFile(fileSystem, filePath) {
  try {
    return await fileSystem.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function cleanupLegacyTokenLaunchAgent({ execFile, fileSystem, home, name, platform, uid }) {
  if (platform !== 'darwin' || uid === null) return;
  const label = `local.bigbrain.codex-token.${name.replace(/[^a-z0-9.-]+/g, '-')}`;
  const plistPath = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
  try {
    await fileSystem.access(plistPath);
  } catch {
    return;
  }
  await execFile('launchctl', ['bootout', `gui/${uid}`, plistPath]).catch(() => null);
  await fileSystem.rm(plistPath, { force: true });
  await execFile('launchctl', ['unsetenv', tokenEnvironmentName(name)]).catch(() => null);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
