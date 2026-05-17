#!/usr/bin/env node

import { runRecentCommand } from '../src/bigbrain/cli.js';

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command !== 'recent') {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(2);
  }

  try {
    await runRecentCommand(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function printHelp() {
  console.log(`Usage: bigbrain recent [options]

List markdown files changed within a time range for a gbrain-style notes directory.

Options:
  --config <path>   Path to bigbrain.config.json
  --state <path>    Path to bigbrain.state.json
  --since <time>    ISO timestamp or relative duration (e.g. 24h, 7d)
  --until <time>    ISO timestamp
  --json            JSON output
  --help, -h        Show this help
`);
}

await main();
