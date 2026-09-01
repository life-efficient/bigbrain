#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createEmptyEventInbox, createEmptyEventRegistry, defaultEventConfigDir, defaultEventInboxPath, defaultEventIngestorConfigPath, defaultEventRegistryPath, normalizeEventInbox, normalizeEventRegistry } from '../src/bigbrain/inbound-events.js';

const execFileAsync = promisify(execFile);
const DEFAULT_LABEL = 'local.bigbrain.event-ingestor';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const brainHome = path.resolve(options.brainHome || await readDefaultBrainHome());
  const configPath = path.resolve(options.config || defaultEventIngestorConfigPath());
  const registryPath = path.resolve(options.registry || defaultEventRegistryPath());
  const inboxPath = path.resolve(options.inbox || defaultEventInboxPath());
  const plistPath = path.resolve(options.plist || path.join(os.homedir(), 'Library', 'LaunchAgents', `${options.label || DEFAULT_LABEL}.plist`));
  const logDir = path.resolve(options.logDir || defaultEventConfigDir());
  const scriptPath = path.join(repoRoot, 'scripts', 'bigbrain-event-ingestor.mjs');
  const statePath = path.join(brainHome, '.bigbrain-state', 'event-ingestor-state.json');
  const brainIdentity = await readBrainIdentity(brainHome);
  const preparedConfig = await ensureConfig(configPath, {
    brainHome,
    statePath,
    registryPath,
    inboxPath,
    mcpUrl: options.mcpUrl || 'http://127.0.0.1:55560/mcp',
    port: options.port || 55561,
    brainIdentity,
    runtimeKind: options.runtimeKind || 'client',
    write: !options.dryRun,
  });
  const config = preparedConfig.config;
  await ensureRegistry(registryPath, { brainIdentity, legacySources: preparedConfig.legacySources, mcpUrl: preparedConfig.config.mcp_url || options.mcpUrl || 'http://127.0.0.1:55560/mcp', runtimeKind: options.runtimeKind || 'client', write: !options.dryRun });
  const migratedState = options.dryRun ? { migrated: false, sources: [] } : await migrateLegacyState({ statePath, inboxPath, legacySources: preparedConfig.legacySources });
  const codexCommand = await resolveCodexCommand(options.codexCommand);
  const plist = renderPlist({
    label: options.label || DEFAULT_LABEL,
    nodePath: process.execPath,
    scriptPath,
    configPath,
    repoRoot,
    logDir,
    codexCommand,
  });
  if (options.dryRun) {
    console.log(JSON.stringify({ configPath, registryPath, inboxPath, plistPath, brainHome, statePath, codex_command: codexCommand, migrated_state: migratedState, label: options.label || DEFAULT_LABEL }, null, 2));
    return;
  }
  if (process.platform !== 'darwin') throw new Error('The event ingestor installer currently supports macOS launchd only.');
  await fs.access(scriptPath);
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  const previous = await fs.readFile(plistPath).catch(() => null);
  const uid = String(process.getuid?.() || await userId());
  const target = `gui/${uid}/${options.label || DEFAULT_LABEL}`;
  try {
    await execFileAsync('launchctl', ['bootout', `gui/${uid}`, plistPath]).catch(() => null);
    await fs.writeFile(plistPath, plist, 'utf8');
    await execFileAsync('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
    await execFileAsync('launchctl', ['kickstart', '-k', target]);
  } catch (error) {
    await execFileAsync('launchctl', ['bootout', `gui/${uid}`, plistPath]).catch(() => null);
    if (previous) {
      await fs.writeFile(plistPath, previous, 'utf8');
      await execFileAsync('launchctl', ['bootstrap', `gui/${uid}`, plistPath]).catch(() => null);
    } else {
      await fs.rm(plistPath, { force: true });
    }
    throw error;
  }
  console.log(JSON.stringify({ ok: true, configPath, registryPath, inboxPath, plistPath, brainHome, statePath, codex_command: codexCommand, migrated_state: migratedState, service: target }, null, 2));
}

async function ensureConfig(configPath, { brainHome, statePath, registryPath, inboxPath, mcpUrl, port, brainIdentity, runtimeKind, write = true }) {
  const existing = await fs.readFile(configPath, 'utf8').then((value) => JSON.parse(value)).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  });
  const legacySources = existing?.version < 2 && Array.isArray(existing.sources) ? existing.sources : [];
  const config = existing?.version < 2 ? {
    version: 2,
    managed_by: 'launchd',
    runtime_kind: runtimeKind,
    registry_path: registryPath,
    inbox_path: inboxPath,
    webhook: { host: existing.server?.host || '127.0.0.1', port: Number(existing.server?.port || port), enabled: true },
    mcp_url: existing.brain?.mcp_url || mcpUrl,
    migrated_from: 'event-ingestor-v1',
  } : existing || {
    version: 2,
    runtime_kind: runtimeKind,
    registry_path: registryPath,
    inbox_path: inboxPath,
    webhook: { host: '127.0.0.1', port: Number(port), enabled: true },
  };
  config.version = 2;
  config.managed_by = 'launchd';
  config.registry_path ||= registryPath;
  config.inbox_path ||= inboxPath;
  config.webhook ||= { host: '127.0.0.1', port: Number(port), enabled: true };
  config.webhook.host ||= '127.0.0.1';
  config.webhook.port ||= Number(port);
  config.webhook.enabled ??= true;
  config.brain_identity ||= brainIdentity;
  config.mcp_url ||= mcpUrl;
  if (write) {
    if (legacySources.length) await fs.copyFile(configPath, `${configPath}.v1-backup`).catch(() => {});
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
  return { config, legacySources };
}

async function ensureRegistry(registryPath, { brainIdentity, legacySources = [], mcpUrl, runtimeKind, write = true }) {
  const existing = await fs.readFile(registryPath, 'utf8').then((value) => JSON.parse(value)).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  });
  const registry = normalizeEventRegistry(existing || createEmptyEventRegistry({ runtimeKind }));
  registry.brains ||= [];
  if (brainIdentity?.id && !registry.brains.some((brain) => brain.id === brainIdentity.id)) registry.brains.push({ id: brainIdentity.id, name: brainIdentity.name || brainIdentity.id, mcp_url: mcpUrl, kind: 'local_runtime' });
  for (const source of legacySources) {
    if (!source?.id || registry.listeners.some((listener) => listener.id === source.id)) continue;
    registry.listeners.push({ ...source, scope: source.scope || 'personal', listener_location: runtimeKind, codex_execution_location: 'client', codex_execution_mode: 'app_thread', brain_ids: source.brain_ids || (brainIdentity?.id ? [brainIdentity.id] : []), capture_policy: source.capture_policy || { default_mode: 'full', retain_raw: false } });
  }
  if (!registry.listeners.some((listener) => listener.id === 'openai-news')) registry.listeners.push({
    id: 'openai-news',
    type: 'rss',
    scope: 'organization',
    url: 'https://openai.com/news/rss.xml',
    publisher: 'OpenAI',
    display_name: 'OpenAI News',
    description: 'Capture useful OpenAI announcements and model release notes. Ignore security updates unless they materially affect current work.',
    icon: 'Rss',
    section_heading: 'OpenAI News Feed',
    target_page: 'organizations/openai',
    raw_collection: 'organizations',
    raw_prefix: 'openai-news',
    bootstrap: 'latest',
    listener_location: runtimeKind,
    codex_execution_location: 'client',
    codex_execution_mode: 'app_thread',
    brain_ids: brainIdentity?.id ? [brainIdentity.id] : [],
    capture_policy: { default_mode: 'full', retain_raw: false },
  });
  const canonical = normalizeEventRegistry(registry);
  if (write) {
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(canonical, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

async function migrateLegacyState({ statePath, inboxPath, legacySources }) {
  if (!legacySources.length) return { migrated: false, sources: [] };
  const legacy = await fs.readFile(statePath, 'utf8').then((value) => JSON.parse(value)).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!legacy?.sources || typeof legacy.sources !== 'object') return { migrated: false, sources: [] };
  const inbox = normalizeEventInbox(await fs.readFile(inboxPath, 'utf8').then((value) => JSON.parse(value)).catch((error) => {
    if (error?.code === 'ENOENT') return createEmptyEventInbox();
    throw error;
  }));
  const migrated = [];
  for (const source of legacySources) {
    const sourceState = legacy.sources[source.id];
    if (!sourceState || inbox.collectors[source.id]?.migrated_from) continue;
    inbox.collectors[source.id] = {
      initialized_at: sourceState.initialized_at || null,
      last_poll_at: sourceState.last_poll_at || null,
      last_success_at: sourceState.last_success_at || null,
      last_error: sourceState.last_error || null,
      item_count: Number(sourceState.item_count || 0),
      last_item_status: sourceState.last_item_status || null,
      last_item_key: sourceState.last_item_key || null,
      last_ingested_at: sourceState.last_ingested_at || null,
      etag: sourceState.etag || null,
      last_modified: sourceState.last_modified || null,
      seen: {},
      legacy_seen: trimSeen(sourceState.seen),
      migrated_from: 'event-ingestor-v1',
    };
    migrated.push({ id: source.id, seen_count: Object.keys(inbox.collectors[source.id].legacy_seen).length });
  }
  if (!migrated.length) return { migrated: false, sources: [] };
  inbox.updated_at = new Date().toISOString();
  await fs.mkdir(path.dirname(inboxPath), { recursive: true });
  const temporary = `${inboxPath}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(inbox, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, inboxPath);
  await fs.chmod(inboxPath, 0o600).catch(() => {});
  await fs.copyFile(statePath, `${statePath}.v1-backup`).catch(() => {});
  return { migrated: true, sources: migrated };
}

function trimSeen(value) {
  const entries = Object.entries(value && typeof value === 'object' ? value : {}).slice(-2000);
  return Object.fromEntries(entries);
}

async function readBrainIdentity(brainHome) {
  const candidates = [
    path.join(brainHome, '.bigbrain-state', 'config.json'),
    path.join(brainHome, '.bigbrain', 'config.json'),
  ];
  for (const candidate of candidates) {
    const value = await fs.readFile(candidate, 'utf8').then((raw) => JSON.parse(raw)).catch(() => null);
    if (value?.brain_id) return { id: value.brain_id, name: value.brain_name || value.brain_id };
  }
  return null;
}

function renderPlist({ label, nodePath, scriptPath, configPath, repoRoot, logDir, codexCommand }) {
  const stdout = path.join(logDir, 'bigbrain-event-ingestor.log');
  const stderr = path.join(logDir, 'bigbrain-event-ingestor.err.log');
  const args = [nodePath, scriptPath, '--config', configPath];
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
  <string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xmlEscape(os.homedir())}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
${codexCommand && codexCommand !== 'codex' ? `    <key>BIGBRAIN_CODEX_COMMAND</key>\n    <string>${xmlEscape(codexCommand)}</string>` : ''}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderr)}</string>
</dict>
</plist>
`;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo-root') options.repoRoot = args[++index];
    else if (arg === '--brain-home') options.brainHome = args[++index];
    else if (arg === '--config') options.config = args[++index];
    else if (arg === '--registry') options.registry = args[++index];
    else if (arg === '--inbox') options.inbox = args[++index];
    else if (arg === '--runtime-kind') options.runtimeKind = args[++index];
    else if (arg === '--plist') options.plist = args[++index];
    else if (arg === '--log-dir') options.logDir = args[++index];
    else if (arg === '--mcp-url') options.mcpUrl = args[++index];
    else if (arg === '--port') options.port = args[++index];
    else if (arg === '--label') options.label = args[++index];
    else if (arg === '--codex-command') options.codexCommand = args[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function resolveCodexCommand(explicit) {
  if (explicit) return explicit;
  if (process.env.BIGBRAIN_CODEX_COMMAND) return process.env.BIGBRAIN_CODEX_COMMAND;
  const candidates = [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ];
  for (const candidate of candidates) if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
  return execFileAsync('which', ['codex']).then(({ stdout }) => stdout.trim() || 'codex').catch(() => 'codex');
}

async function readDefaultBrainHome() {
  return (await fs.readFile(path.join(os.homedir(), '.config', 'bigbrain', 'default-brain-home'), 'utf8')).trim();
}

async function userId() {
  const { stdout } = await execFileAsync('id', ['-u']);
  return stdout.trim();
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
