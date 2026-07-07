#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

export async function discoverCodexMcpTools({
  name,
  tool = null,
  configPaths = defaultCodexConfigPaths(),
  env = process.env,
  timeoutMs = 10000,
  useKeychain = true,
} = {}) {
  if (!name) throw new Error('Missing required MCP server name.');
  const loaded = await loadCodexMcpServers({ configPaths });
  const server = loaded.servers.find((entry) => entry.name === name);
  if (!server) {
    return {
      status: 'not_configured',
      name,
      config_paths_checked: loaded.config_paths_checked,
      tools: [],
      message: `No [mcp_servers.${name}] entry found in Codex config.`,
    };
  }
  if (server.enabled === false) {
    return {
      status: 'server_disabled',
      name,
      config_path: server.configPath,
      tools: [],
      message: `MCP server ${name} is disabled in Codex config.`,
    };
  }
  try {
    const result = server.url
      ? await discoverHttpTools({ server, env, timeoutMs, useKeychain })
      : await discoverStdioTools({ server, env, timeoutMs });
    return withExpectedTool({
      status: 'resolved',
      name,
      config_path: server.configPath,
      transport: server.url ? 'http' : 'stdio',
      tools: result.tools,
      tool_names: result.tools.map((tool) => tool.name).filter(Boolean),
      auth: result.auth || null,
    }, tool);
  } catch (error) {
    const status = isAuthError(error) ? 'not_logged_in' : 'tool_error';
    return {
      status,
      name,
      config_path: server.configPath,
      transport: server.url ? 'http' : 'stdio',
      tools: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function defaultCodexConfigPaths({ env = process.env, home = os.homedir() } = {}) {
  const paths = [
    env.CODEX_HOME ? path.join(env.CODEX_HOME, 'config.toml') : null,
    path.join(home, '.codex', 'config.toml'),
    path.join(home, '.config', 'codex', 'config.toml'),
  ].filter(Boolean);
  return [...new Set(paths)];
}

export async function loadCodexMcpServers({ configPaths = defaultCodexConfigPaths() } = {}) {
  const servers = [];
  const checked = [];
  for (const configPath of configPaths) {
    checked.push(configPath);
    let text;
    try {
      text = await fs.readFile(configPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    servers.push(...parseCodexMcpServers(text, configPath));
  }
  return { servers, config_paths_checked: checked };
}

export function parseCodexMcpServers(text, configPath = '<inline>') {
  const servers = new Map();
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const section = line.match(/^\[(.+)]$/);
    if (section) {
      const parts = splitTomlPath(section[1]);
      current = sectionContext(parts);
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignment || !current?.serverName) continue;
    const server = ensureServer(servers, current.serverName, configPath);
    const [, key, rawValue] = assignment;
    const value = parseTomlValue(rawValue);
    if (current.kind === 'root' && ['url', 'command', 'args', 'enabled', 'bearer_token_env_var'].includes(key)) {
      server[key] = value;
    } else if (current.kind === 'env') {
      server.env[key] = String(value);
    }
  }
  return [...servers.values()];
}

async function discoverHttpTools({ server, env, timeoutMs, useKeychain }) {
  const credential = await resolveHttpCredential({ server, env, useKeychain });
  const init = await postMcpJsonRpc({
    url: credential.url,
    accessToken: credential.accessToken,
    timeoutMs,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'bigbrain-mcp-tool-discovery', version: '1.0.0' },
      },
    },
  });
  if (init.error) throw new Error(`initialize failed: ${init.error.message || JSON.stringify(init.error)}`);
  const listed = await postMcpJsonRpc({
    url: credential.url,
    accessToken: credential.accessToken,
    timeoutMs,
    body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  });
  if (listed.error) throw new Error(`tools/list failed: ${listed.error.message || JSON.stringify(listed.error)}`);
  return { tools: listed.result?.tools || [], auth: credential.auth };
}

async function resolveHttpCredential({ server, env, useKeychain }) {
  if (server.bearer_token_env_var) {
    const token = env[server.bearer_token_env_var];
    if (!token) {
      const error = new Error(`Bearer token env var ${server.bearer_token_env_var} is not set.`);
      error.auth = true;
      throw error;
    }
    return { url: server.url, accessToken: token, auth: `bearer:${server.bearer_token_env_var}` };
  }
  if (useKeychain) {
    const credential = readCodexMcpCredential(server.name);
    if (credential) return { ...credential, auth: 'codex-keychain' };
  }
  return { url: server.url, accessToken: null, auth: 'none' };
}

async function postMcpJsonRpc({ url, accessToken, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`MCP HTTP ${response.status}: ${text.slice(0, 500)}`);
      if (response.status === 401 || response.status === 403) error.auth = true;
      throw error;
    }
    return parseMcpResponse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function discoverStdioTools({ server, env, timeoutMs }) {
  if (!server.command) throw new Error(`MCP server ${server.name} has neither url nor command.`);
  const child = spawn(server.command, server.args || [], {
    env: { ...env, ...server.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = createStdioJsonRpcClient(child, timeoutMs);
  try {
    const init = await client.request('initialize', {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'bigbrain-mcp-tool-discovery', version: '1.0.0' },
    });
    if (init.error) throw new Error(`initialize failed: ${init.error.message || JSON.stringify(init.error)}`);
    client.notify('notifications/initialized', {});
    const listed = await client.request('tools/list', {});
    if (listed.error) throw new Error(`tools/list failed: ${listed.error.message || JSON.stringify(listed.error)}`);
    return { tools: listed.result?.tools || [], auth: 'stdio' };
  } finally {
    child.kill();
  }
}

function createStdioJsonRpcClient(child, timeoutMs) {
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map();
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    let index;
    while ((index = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (!line || !line.startsWith('{')) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        resolve(message);
      }
    }
  });
  child.on('error', (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  });
  child.on('exit', (code, signal) => {
    if (pending.size === 0) return;
    const error = new Error(`MCP stdio process exited before responding: code=${code} signal=${signal} stderr=${stderr.slice(0, 500)}`);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  });
  return {
    request(method, params) {
      const id = nextId++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method} from stdio MCP. stderr=${stderr.slice(0, 500)}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
  };
}

function readCodexMcpCredential(mcpName) {
  if (process.platform !== 'darwin') return null;
  let dump;
  try {
    dump = execFileSync('security', ['dump-keychain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const escapedName = escapeRegExp(`${mcpName}|`);
  const match = dump.match(new RegExp(`"acct"<blob>="(${escapedName}[^"]+)"[\\s\\S]{0,800}?"svce"<blob>="Codex MCP Credentials"`))
    || dump.match(new RegExp(`"svce"<blob>="Codex MCP Credentials"[\\s\\S]{0,800}?"acct"<blob>="(${escapedName}[^"]+)"`));
  if (!match) return null;
  let raw;
  try {
    raw = execFileSync('security', ['find-generic-password', '-a', match[1], '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
  try {
    const credential = JSON.parse(raw);
    const accessToken = credential?.token_response?.access_token;
    if (!credential.url || !accessToken) return null;
    return { url: credential.url, accessToken };
  } catch {
    return null;
  }
}

function parseMcpResponse(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (!dataLines.length) throw new Error(`Unexpected MCP response: ${text.slice(0, 200)}`);
  return JSON.parse(dataLines.join('\n'));
}

function withExpectedTool(result, expectedTool) {
  if (!expectedTool || result.status !== 'resolved') return result;
  const candidates = toolNameCandidates(expectedTool);
  result.expected_tool = expectedTool;
  result.expected_tool_found = result.tool_names.some((name) => candidates.has(name));
  result.expected_tool_candidates = [...candidates];
  return result;
}

function toolNameCandidates(tool) {
  const candidates = new Set([tool]);
  if (tool.includes('/')) candidates.add(tool.replaceAll('/', '_'));
  if (tool.includes('_')) candidates.add(tool.replaceAll('_', '/'));
  const dotIndex = tool.lastIndexOf('.');
  if (tool.startsWith('mcp__') && dotIndex > 0) {
    candidates.add(tool.slice(dotIndex + 1));
  }
  const doubleUnderscore = tool.match(/^mcp__[^_]+__(.+)$/);
  if (doubleUnderscore) candidates.add(doubleUnderscore[1]);
  return candidates;
}

function ensureServer(servers, name, configPath) {
  if (!servers.has(name)) {
    servers.set(name, { name, configPath, enabled: true, env: {} });
  }
  return servers.get(name);
}

function sectionContext(parts) {
  if (parts[0] !== 'mcp_servers' || !parts[1]) return null;
  if (parts.length === 2) return { kind: 'root', serverName: parts[1] };
  if (parts.length === 3 && parts[2] === 'env') return { kind: 'env', serverName: parts[1] };
  return { kind: 'nested', serverName: parts[1] };
}

function splitTomlPath(value) {
  const parts = [];
  let part = '';
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && value[i - 1] !== '\\') quote = null;
      else part += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '.') {
      parts.push(part);
      part = '';
    } else {
      part += char;
    }
  }
  parts.push(part);
  return parts.map((item) => item.trim()).filter(Boolean);
}

function stripTomlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote && line[i - 1] !== '\\') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlValue(rawValue) {
  const value = rawValue.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitTomlArray(inner).map(parseTomlValue);
  }
  return value;
}

function splitTomlArray(value) {
  const items = [];
  let item = '';
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      item += char;
      if (char === quote && value[i - 1] !== '\\') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      item += char;
    } else if (char === ',') {
      items.push(item.trim());
      item = '';
    } else {
      item += char;
    }
  }
  if (item.trim()) items.push(item.trim());
  return items;
}

function isAuthError(error) {
  return Boolean(error?.auth)
    || /401|403|unauthori[sz]ed|not logged in|bearer token env var/i.test(error?.message || '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const parsed = { configPaths: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--name') parsed.name = argv[++i];
    else if (arg === '--tool') parsed.tool = argv[++i];
    else if (arg === '--config') parsed.configPaths.push(argv[++i]);
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(argv[++i]);
    else if (arg === '--no-keychain') parsed.useKeychain = false;
    else if (arg === '--names-only') parsed.namesOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.name) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }
  const result = await discoverCodexMcpTools({
    name: args.name,
    tool: args.tool,
    configPaths: args.configPaths.length ? args.configPaths : defaultCodexConfigPaths(),
    timeoutMs: args.timeoutMs || 10000,
    useKeychain: args.useKeychain !== false,
  });
  if (args.namesOnly) delete result.tools;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!['resolved', 'server_disabled', 'not_configured', 'not_logged_in'].includes(result.status)) {
    process.exitCode = 2;
  }
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/discover-codex-mcp-tools.mjs --name <mcp-server-name>

Options:
  --tool <name>        Expected tool to check in the resolved tools/list output.
  --config <path>       Codex config.toml path. Repeat to check multiple files.
  --timeout-ms <n>      Probe timeout in milliseconds. Default: 10000.
  --no-keychain         Do not read Codex OAuth credentials from macOS keychain.
  --names-only          Print tool names without full tool schemas.
\n`);
}
