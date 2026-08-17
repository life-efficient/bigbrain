#!/usr/bin/env node

import { granolaLedgerUsage, runGranolaLedgerCommand } from '../src/bigbrain/granola-ledger-runner.js';

async function main() {
  if (process.argv.includes('--help') || process.argv.length < 3) {
    console.log(granolaLedgerUsage());
    return;
  }
  try {
    const result = await runGranolaLedgerCommand(process.argv.slice(2));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
