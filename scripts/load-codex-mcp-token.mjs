#!/usr/bin/env node
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';

const [envPath, envName] = process.argv.slice(2);
if (!envPath || !envName) throw new Error('Usage: load-codex-mcp-token <token-file> <environment-name>');
const token = (await fs.readFile(envPath, 'utf8')).trim();
if (!token) throw new Error('Token file is empty.');
execFile('/bin/launchctl', ['setenv', envName, token], (error) => {
  if (error) throw error;
});
