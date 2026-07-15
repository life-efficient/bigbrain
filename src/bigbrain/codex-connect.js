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
  const home = dependencies.home || os.homedir();
  const platform = dependencies.platform || process.platform;
  const nodePath = dependencies.nodePath || process.execPath;
  const loaderPath = dependencies.loaderPath || fileURLToPath(new URL('../../scripts/load-codex-mcp-token.mjs', import.meta.url));
  const endpoint = normalizeMcpEndpoint(options.serviceUrl);
  const name = deriveServerName(endpoint, options.name || '');
  const auth = options.auth || 'oauth';
  if (!['oauth', 'token'].includes(auth)) throw new Error('--auth must be oauth or token.');

  let token = '';
  if (auth === 'token') {
    if (!options.tokenStdin) throw new Error('Token authentication requires --token-stdin.');
    token = String(options.token || '').trim();
    if (!token) throw new Error('No token was provided on stdin.');
    if (platform !== 'darwin') throw new Error('Persistent token authentication currently supports macOS only.');
  }

  await ensureCodexRegistration({ execFile, name, endpoint, auth, envName: auth === 'token' ? tokenEnvironmentName(name) : null });
  if (auth === 'oauth') {
    await execFile('codex', ['mcp', 'login', name]);
    return { ok: true, name, endpoint, auth, restart_codex_required: false };
  }

  const envName = tokenEnvironmentName(name);
  const connectionDir = path.join(home, '.config', 'bigbrain', 'connections', name);
  const envPath = path.join(connectionDir, 'token');
  const label = `local.bigbrain.codex-token.${name.replace(/[^a-z0-9.-]+/g, '-')}`;
  const plistPath = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
  const serviceTarget = `gui/${dependencies.uid ?? process.getuid()}/${label}`;
  await fs.mkdir(connectionDir, { recursive: true, mode: 0o700 });
  await fs.chmod(connectionDir, 0o700);
  await fs.writeFile(envPath, `${token}\n`, { mode: 0o600 });
  await fs.chmod(envPath, 0o600);
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.writeFile(plistPath, renderTokenLaunchAgent({ label, nodePath, loaderPath, envPath, envName }), 'utf8');
  await execFile('launchctl', ['bootout', `gui/${dependencies.uid ?? process.getuid()}`, plistPath]).catch(() => null);
  await execFile('launchctl', ['bootstrap', `gui/${dependencies.uid ?? process.getuid()}`, plistPath]);
  await execFile('launchctl', ['kickstart', '-k', serviceTarget]);
  const loaded = await execFile('launchctl', ['getenv', envName]);
  if (!String(loaded.stdout || '').trim()) throw new Error('The token loader started, but the Codex environment variable was not published.');
  return { ok: true, name, endpoint, auth, env_var: envName, restart_codex_required: true };
}

async function ensureCodexRegistration({ execFile, name, endpoint, auth, envName }) {
  let existing = null;
  try {
    const result = await execFile('codex', ['mcp', 'get', name, '--json']);
    existing = JSON.parse(result.stdout);
  } catch {
    // A missing registration is the normal first-run path.
  }
  if (existing) {
    const existingUrl = existing.url || existing.transport?.url || existing.transport?.streamable_http?.url;
    const existingEnv = existing.bearer_token_env_var || existing.transport?.bearer_token_env_var || existing.transport?.streamable_http?.bearer_token_env_var || null;
    if (existingUrl === endpoint && existingEnv === (auth === 'token' ? envName : null)) return;
    throw new Error(`Codex MCP server "${name}" already exists with different connection settings.`);
  }
  const args = ['mcp', 'add', name, '--url', endpoint];
  if (auth === 'token') args.push('--bearer-token-env-var', envName);
  await execFile('codex', args);
}

export function renderTokenLaunchAgent({ label, nodePath, loaderPath, envPath, envName }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(loaderPath)}</string><string>${xml(envPath)}</string><string>${xml(envName)}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`;
}

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
