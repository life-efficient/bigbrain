import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const entryPoint = path.join(repoRoot, 'src', 'dashboard-client', 'main.jsx');
const outdir = path.join(repoRoot, '.bigbrain-dashboard');
const outfile = path.join(outdir, 'dashboard-client.js');

await fs.mkdir(outdir, { recursive: true });

await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile,
  sourcemap: 'inline',
  jsx: 'automatic',
  target: ['es2022'],
});

console.log(outfile);
