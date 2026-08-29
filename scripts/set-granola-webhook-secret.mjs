#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const envPath = path.join(os.homedir(), '.config', 'bigbrain', '.env');

async function main() {
  const secret = await readHidden('Granola signing secret: ');
  if (!secret.startsWith('whsec_')) throw new Error('The Granola signing secret should start with whsec_.');
  await fs.mkdir(path.dirname(envPath), { recursive: true, mode: 0o700 });
  let existing = '';
  try {
    existing = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const lines = existing.split(/\r?\n/).filter((line) => !/^\s*GRANOLA_WEBHOOK_SECRET\s*=/.test(line));
  while (lines.at(-1) === '') lines.pop();
  lines.push(`GRANOLA_WEBHOOK_SECRET=${secret}`);
  await fs.writeFile(envPath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(envPath, 0o600);
  console.log('Granola signing secret saved to ~/.config/bigbrain/.env.');
}

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Secret entry requires an interactive terminal.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Secret entry cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (character === '\u007f') value = value.slice(0, -1);
        else value += character;
      }
    };
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
    };
    process.stdin.on('data', onData);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
