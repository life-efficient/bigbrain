#!/usr/bin/env node

import path from 'node:path';

import { runTaskRefresh } from '../src/bigbrain/task-refresh.js';
import { defaultConfigPath, defaultStatePath } from '../src/bigbrain/config.js';

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const configPath = flags.configPath ?? defaultConfigPath();
  const statePath = flags.statePath ?? defaultStatePath(configPath);

  try {
    const result = await runTaskRefresh({
      configPath,
      statePath,
      dryRun: flags.dryRun,
    });

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(result.summary);
    if (!result.changed) {
      console.log('Tasks file unchanged.');
      return;
    }
    console.log(flags.dryRun ? 'Dry run produced task updates.' : 'Tasks file updated.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseFlags(args) {
  const flags = {
    configPath: null,
    statePath: null,
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--config':
        flags.configPath = path.resolve(args[++index] ?? '');
        break;
      case '--state':
        flags.statePath = path.resolve(args[++index] ?? '');
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--json':
        flags.json = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return flags;
}

await main();
