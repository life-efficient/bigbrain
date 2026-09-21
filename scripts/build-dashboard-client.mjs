import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const entryPoint = path.join(repoRoot, 'src', 'dashboard-client', 'main.jsx');
const outdir = path.join(repoRoot, '.bigbrain-dashboard');
const outfile = path.join(outdir, 'dashboard-client.js');

const threeForceGraphParticleTeardownGuard = {
  name: 'three-forcegraph-particle-teardown-guard',
  setup(buildContext) {
    buildContext.onLoad({ filter: /three-forcegraph[\\/]dist[\\/]three-forcegraph\.mjs$/ }, async ({ path: modulePath }) => {
      const source = await fs.readFile(modulePath, 'utf8');
      const unsafeTeardown = 'singlePhotonsObj.parent.remove(singlePhotonsObj);';
      if (!source.includes(unsafeTeardown)) {
        throw new Error(`Expected three-forcegraph particle teardown was not found in ${modulePath}`);
      }
      return {
        contents: source.replace(
          unsafeTeardown,
          'singlePhotonsObj.parent?.remove(singlePhotonsObj);',
        ),
        loader: 'js',
      };
    });
  },
};

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
  plugins: [threeForceGraphParticleTeardownGuard],
});

console.log(outfile);
