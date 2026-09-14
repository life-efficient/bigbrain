#!/usr/bin/env node
import { runSubstackLedgerCommand, substackLedgerUsage } from '../src/bigbrain/substack-ledger.js';

if (process.argv.includes('--help') || process.argv.length < 3) {
  console.log(substackLedgerUsage());
} else {
  try {
    console.log(JSON.stringify(await runSubstackLedgerCommand(process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
