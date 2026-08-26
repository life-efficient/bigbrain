#!/usr/bin/env node

import fs from 'node:fs/promises';
import { EventIngestor } from '../src/bigbrain/event-ingestor.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.config) throw new Error('Usage: bigbrain-event-ingestor --config <json> [--once]');
  const config = JSON.parse(await fs.readFile(options.config, 'utf8'));
  const ingestor = new EventIngestor({ config });
  const result = await ingestor.start({ once: options.once });
  console.log(JSON.stringify(result.firstReport, null, 2));
  if (options.once) return;
  console.log(`BigBrain event ingestor listening on http://${config.server?.host || '127.0.0.1'}:${config.server?.port || 55561}`);
}

function parseArgs(args) {
  const options = { once: false, config: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config') options.config = args[++index];
    else if (arg === '--once') options.once = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
