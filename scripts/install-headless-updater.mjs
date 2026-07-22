#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_LABEL = 'local.bigbrain.updater';
const DEFAULT_INTERVAL_SECONDS = 21_600;

export function renderUpdaterLaunchAgent({
  label = DEFAULT_LABEL,
  nodePath,
  runnerPath,
  repoRoot,
  channel = 'stable',
  intervalSeconds = DEFAULT_INTERVAL_SECONDS,
  stdoutPath,
  stderrPath,
  home = os.homedir(),
}) {
  const args = [nodePath, runnerPath, '--repo-root', repoRoot, '--channel', channel];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key><array>${args.map((arg) => `<string>${xmlEscape(arg)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>${xmlEscape(home)}</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>${Number(intervalSeconds)}</integer>
  <key>StandardOutPath</key><string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(stderrPath)}</string>
</dict></plist>
`;
}

export async function installHeadlessUpdater({
  repoRoot,
  channel = 'stable',
  intervalSeconds = DEFAULT_INTERVAL_SECONDS,
  label = DEFAULT_LABEL,
  nodePath = process.execPath,
  plistPath,
  logDir = path.join(os.homedir(), '.config', 'bigbrain'),
  dryRun = false,
  execFileImpl = execFileAsync,
} = {}) {
  if (!repoRoot) throw new Error('--repo-root is required.');
  if (!['stable', 'beta'].includes(channel)) throw new Error('--channel must be stable or beta.');
  if (!Number.isInteger(Number(intervalSeconds)) || Number(intervalSeconds) < 3600) throw new Error('--interval-seconds must be at least 3600.');
  const resolvedRepo = path.resolve(repoRoot);
  const runnerPath = path.join(resolvedRepo, 'scripts', 'run-headless-update.mjs');
  await fs.access(runnerPath);
  const targetPlist = plistPath || path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const stdoutPath = path.join(logDir, 'bigbrain-updater.log');
  const stderrPath = path.join(logDir, 'bigbrain-updater.err.log');
  const plist = renderUpdaterLaunchAgent({ label, nodePath, runnerPath, repoRoot: resolvedRepo, channel, intervalSeconds, stdoutPath, stderrPath });
  const result = { ok: true, label, plistPath: targetPlist, repoRoot: resolvedRepo, channel, intervalSeconds: Number(intervalSeconds), runnerPath };
  if (dryRun) return { ...result, plist };
  if (process.platform !== 'darwin') throw new Error('The scheduled headless updater currently supports macOS launchd only.');
  await fs.mkdir(path.dirname(targetPlist), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  await execFileImpl('launchctl', ['bootout', `gui/${process.getuid()}`, targetPlist]).catch(() => null);
  await fs.writeFile(targetPlist, plist, 'utf8');
  await execFileImpl('launchctl', ['bootstrap', `gui/${process.getuid()}`, targetPlist]);
  return result;
}

function xmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo-root') options.repoRoot = args[++index];
    else if (arg === '--channel') options.channel = args[++index];
    else if (arg === '--interval-seconds') options.intervalSeconds = Number(args[++index]);
    else if (arg === '--label') options.label = args[++index];
    else if (arg === '--node-path') options.nodePath = args[++index];
    else if (arg === '--plist-path') options.plistPath = args[++index];
    else if (arg === '--log-dir') options.logDir = args[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  installHeadlessUpdater(parseArgs(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
