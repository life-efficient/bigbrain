#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_LABEL = 'local.bigbrain.event-ingestor';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const brainHome = path.resolve(options.brainHome || await readDefaultBrainHome());
  const configPath = path.resolve(options.config || path.join(os.homedir(), '.config', 'bigbrain', 'event-ingestor.json'));
  const plistPath = path.resolve(options.plist || path.join(os.homedir(), 'Library', 'LaunchAgents', `${options.label || DEFAULT_LABEL}.plist`));
  const logDir = path.resolve(options.logDir || path.join(os.homedir(), '.config', 'bigbrain'));
  const scriptPath = path.join(repoRoot, 'scripts', 'bigbrain-event-ingestor.mjs');
  const statePath = path.join(brainHome, '.bigbrain-state', 'event-ingestor-state.json');
  const config = await ensureConfig(configPath, {
    brainHome,
    statePath,
    mcpUrl: options.mcpUrl || 'http://127.0.0.1:55560/mcp',
    port: options.port || 55561,
  });
  const plist = renderPlist({
    label: options.label || DEFAULT_LABEL,
    nodePath: process.execPath,
    scriptPath,
    configPath,
    repoRoot,
    logDir,
  });
  if (options.dryRun) {
    console.log(JSON.stringify({ configPath, plistPath, brainHome, statePath, label: options.label || DEFAULT_LABEL }, null, 2));
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
  console.log(JSON.stringify({ ok: true, configPath, plistPath, statePath, service: target }, null, 2));
}

async function ensureConfig(configPath, { brainHome, statePath, mcpUrl, port }) {
  const existing = await fs.readFile(configPath, 'utf8').then((value) => JSON.parse(value)).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  });
  const config = existing || {
    version: 1,
    brain: { mcp_url: mcpUrl },
    server: { host: '127.0.0.1', port: Number(port) },
    state_path: statePath,
    bootstrap: 'latest',
    poll_interval_ms: 300_000,
    initial_delay_ms: 5_000,
    sources: [{
      id: 'openai-news',
      type: 'rss',
      url: 'https://openai.com/news/rss.xml',
      publisher: 'OpenAI',
      target_page: 'organizations/openai',
      raw_collection: 'organizations',
      raw_prefix: 'openai-news',
      bootstrap: 'latest',
    }],
  };
  config.brain ||= {};
  config.brain.mcp_url ||= mcpUrl;
  config.server ||= {};
  config.server.host ||= '127.0.0.1';
  config.server.port ||= Number(port);
  config.state_path ||= statePath;
  config.sources ||= [];
  if (!config.sources.some((source) => source.id === 'openai-news')) {
    config.sources.push({
      id: 'openai-news',
      type: 'rss',
      url: 'https://openai.com/news/rss.xml',
      publisher: 'OpenAI',
      target_page: 'organizations/openai',
      raw_collection: 'organizations',
      raw_prefix: 'openai-news',
      bootstrap: 'latest',
    });
  }
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

function renderPlist({ label, nodePath, scriptPath, configPath, repoRoot, logDir }) {
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
    else if (arg === '--plist') options.plist = args[++index];
    else if (arg === '--log-dir') options.logDir = args[++index];
    else if (arg === '--mcp-url') options.mcpUrl = args[++index];
    else if (arg === '--port') options.port = args[++index];
    else if (arg === '--label') options.label = args[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
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
