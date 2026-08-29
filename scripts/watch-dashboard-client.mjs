import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { context } from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const entryPoint = path.join(repoRoot, 'src', 'dashboard-client', 'main.jsx');
const outfile = path.join(repoRoot, '.bigbrain-dashboard', 'dashboard-client.js');

const buildContext = await context({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile,
  sourcemap: 'inline',
  jsx: 'automatic',
  target: ['es2022'],
  plugins: [{
    name: 'bigbrain-dashboard-dev-log',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length) {
          console.error(`[dashboard-dev] build failed with ${result.errors.length} error(s)`);
          return;
        }
        console.log(`[dashboard-dev] rebuilt ${outfile}`);
      });
    },
  }],
});

await buildContext.watch();
console.log(`[dashboard-dev] watching ${entryPoint}`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await buildContext.dispose();
  process.exit(0);
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
await new Promise(() => {});
