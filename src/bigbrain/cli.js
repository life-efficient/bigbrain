import { loadConfig, loadState, defaultConfigPath, defaultStatePath } from './config.js';
import { resolveWindow } from './time.js';
import { listRecentFiles } from './recent.js';

export async function runRecentCommand(args) {
  const flags = parseFlags(args);
  const configPath = flags.configPath ?? defaultConfigPath();
  const statePath = flags.statePath ?? defaultStatePath(configPath);
  const config = await loadConfig(configPath);
  const state = await loadState(statePath, { allowMissing: true });
  const window = resolveWindow({
    since: flags.since,
    until: flags.until,
    stateLastCheckedAt: state.lastCheckedAt,
    fallbackDuration: config.lookbackFallback,
  });
  const report = await listRecentFiles(config, window);

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.files.length === 0) {
    console.log(`No markdown files changed between ${report.window_start} and ${report.window_end}.`);
    return;
  }

  console.log(`Recent markdown files between ${report.window_start} and ${report.window_end}:`);
  for (const file of report.files) {
    console.log(`${file.mtime}  ${file.category.padEnd(10)}  ${file.relative_path}`);
  }
}

function parseFlags(args) {
  const flags = {
    configPath: null,
    statePath: null,
    since: null,
    until: null,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--config':
        flags.configPath = args[++index] ?? null;
        break;
      case '--state':
        flags.statePath = args[++index] ?? null;
        break;
      case '--since':
        flags.since = args[++index] ?? null;
        break;
      case '--until':
        flags.until = args[++index] ?? null;
        break;
      case '--json':
        flags.json = true;
        break;
      case '--help':
      case '-h':
        throw new Error('Use `bigbrain --help` for command help.');
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return flags;
}
