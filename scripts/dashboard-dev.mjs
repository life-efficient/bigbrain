#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const watcherPath = path.join(repoRoot, 'scripts', 'watch-dashboard-client.mjs');
const cliPath = path.join(repoRoot, 'bin', 'bigbrain.js');
const { globalArgs, dashboardArgs } = splitCliArgs(process.argv.slice(2));
const environment = { ...process.env, BIGBRAIN_DASHBOARD_DEV: '1' };

let dashboardProcess = null;
let stopping = false;
let stopCode = 0;
let watcherOutput = '';

const watcher = spawn(process.execPath, [watcherPath], {
  cwd: repoRoot,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
});

forwardOutput(watcher.stdout, process.stdout, (chunk) => {
  watcherOutput += chunk;
  if (!dashboardProcess && watcherOutput.includes('[dashboard-dev] watching')) {
    startDashboard();
  }
});
forwardOutput(watcher.stderr, process.stderr);

watcher.once('error', (error) => {
  console.error(`[dashboard-dev] watcher failed: ${error.message}`);
  stop(1);
});
watcher.once('exit', (code, signal) => {
  if (stopping) return;
  if (signal) {
    stopCode = 128 + signalNumber(signal);
  } else if (code) {
    stopCode = code;
  }
  stop(stopCode);
});

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));

function startDashboard() {
  dashboardProcess = spawn(process.execPath, [cliPath, ...globalArgs, 'dashboard', ...dashboardArgs], {
    cwd: repoRoot,
    env: environment,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  forwardOutput(dashboardProcess.stdout, process.stdout);
  forwardOutput(dashboardProcess.stderr, process.stderr);
  dashboardProcess.once('error', (error) => {
    console.error(`[dashboard-dev] dashboard failed: ${error.message}`);
    stop(1);
  });
  dashboardProcess.once('exit', (code, signal) => {
    if (stopping) return;
    stopCode = signal ? 128 + signalNumber(signal) : (code || 0);
    stop(stopCode);
  });
}

function forwardOutput(source, destination, onChunk = null) {
  source?.on('data', (chunk) => {
    destination.write(chunk);
    onChunk?.(chunk.toString());
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  stopCode = code;
  dashboardProcess?.kill('SIGTERM');
  watcher.kill('SIGTERM');
  setTimeout(() => {
    dashboardProcess?.kill('SIGKILL');
    watcher.kill('SIGKILL');
    process.exitCode = stopCode;
  }, 1500).unref();
}

function signalNumber(signal) {
  return signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1;
}

function splitCliArgs(args) {
  const globalArgs = [];
  const dashboardArgs = [];
  const globalOptionsWithValues = new Set(['--brain-home', '--config']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (globalOptionsWithValues.has(arg)) {
      globalArgs.push(arg, args[++index]);
    } else if (arg === '--json') {
      globalArgs.push(arg);
    } else {
      dashboardArgs.push(arg);
    }
  }
  return { globalArgs, dashboardArgs };
}
