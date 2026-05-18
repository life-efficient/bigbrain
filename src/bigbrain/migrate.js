import fs from 'node:fs/promises';
import path from 'node:path';

import { CANONICAL_SCHEMA_DIRS } from './constants.js';
import { rewriteSlugLinksToRelative, slugFromPath } from './markdown.js';
import { syncBrain } from './sync.js';

export async function migrateBrain({ sourceDir, config }) {
  const sourceRoot = path.resolve(sourceDir);
  const report = {
    copied_files: [],
    rewritten_links: [],
    skipped_files: [],
  };

  for (const dir of CANONICAL_SCHEMA_DIRS) {
    if (dir === 'dreams') continue;
    const sourcePath = path.join(sourceRoot, dir);
    const exists = await fs.stat(sourcePath).then((stats) => stats.isDirectory()).catch(() => false);
    if (!exists) continue;
    await copyDirectory(sourceRoot, sourcePath, config.brainDir, report);
  }

  return {
    ...report,
    sync: await syncBrain({ config }),
  };
}

async function copyDirectory(sourceRoot, sourceDir, targetRoot, report) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourceRoot, sourcePath, targetRoot, report);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(sourceRoot, sourcePath);
    const targetPath = path.join(targetRoot, relative);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (!relative.endsWith('.md')) {
      await fs.copyFile(sourcePath, targetPath);
      report.copied_files.push(relative);
      continue;
    }
    const slug = slugFromPath(sourceRoot, sourcePath);
    const raw = await fs.readFile(sourcePath, 'utf8');
    const rewritten = rewriteSlugLinksToRelative(raw, slug);
    if (rewritten !== raw) report.rewritten_links.push(relative);
    await fs.writeFile(targetPath, rewritten, 'utf8');
    report.copied_files.push(relative);
  }
}
