#!/usr/bin/env node

import { runCli } from '../src/bigbrain/cli.js';

async function main() {
  try {
    const exitCode = await runCli(process.argv.slice(2));
    if (Number.isInteger(exitCode)) process.exitCode = exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
