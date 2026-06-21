import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export async function listRecentFiles(config, window, { now = new Date() } = {}) {
  const files = [];
  const brainDir = path.resolve(config.brainDir);
  const legacyTasksFile = config.tasksFile ? path.resolve(config.tasksFile) : null;

  await walkDirectory(brainDir, '', async (fullPath, relativePath) => {
    const normalizedRelative = toPosixPath(relativePath);
    if (!normalizedRelative.endsWith('.md')) return;
    if (!matchesIncludeGlobs(normalizedRelative, config.includeGlobs)) return;
    if (isExcluded(fullPath, normalizedRelative, config.excludeGlobs, legacyTasksFile)) return;

    const fileStat = await stat(fullPath);
    const mtimeMs = fileStat.mtime.getTime();
    if (mtimeMs < window.windowStart.getTime() || mtimeMs > window.windowEnd.getTime()) return;

    files.push({
      path: fullPath,
      relative_path: normalizedRelative,
      mtime: new Date(mtimeMs).toISOString(),
      category: inferCategory(normalizedRelative),
    });
  });

  files.sort((left, right) => {
    if (left.mtime !== right.mtime) return right.mtime.localeCompare(left.mtime);
    return left.relative_path.localeCompare(right.relative_path);
  });

  return {
    generated_at: now.toISOString(),
    window_start: window.windowStart.toISOString(),
    window_end: window.windowEnd.toISOString(),
    files,
  };
}

async function walkDirectory(rootDir, relativeDir, onFile) {
  const currentDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(relativePath)) continue;
      await walkDirectory(rootDir, relativePath, onFile);
      continue;
    }
    if (entry.isFile()) {
      await onFile(path.join(rootDir, relativePath), relativePath);
    }
  }
}

function shouldSkipDirectory(relativePath) {
  const normalized = toPosixPath(relativePath);
  if (normalized === '.git' || normalized.startsWith('.git/')) return true;
  if (normalized === '.bigbrain' || normalized.startsWith('.bigbrain/')) return true;
  if (normalized === '.bigbrain-state' || normalized.startsWith('.bigbrain-state/')) return true;
  if (normalized === 'archive' || normalized.startsWith('archive/')) return true;
  const segments = normalized.split('/');
  return segments.includes('.raw');
}

function matchesIncludeGlobs(relativePath, includeGlobs) {
  return includeGlobs.some((pattern) => {
    if (pattern === '**/*.md') return relativePath.endsWith('.md');
    return false;
  });
}

function isExcluded(fullPath, relativePath, excludeGlobs, legacyTasksFile) {
  const normalizedFull = path.resolve(fullPath);
  if (legacyTasksFile && normalizedFull === legacyTasksFile) return true;

  for (const pattern of excludeGlobs) {
    if (path.isAbsolute(pattern) && path.resolve(pattern) === normalizedFull) return true;
    if (pattern === '.git/**' && (relativePath === '.git' || relativePath.startsWith('.git/'))) return true;
    if (pattern === 'archive/**' && (relativePath === 'archive' || relativePath.startsWith('archive/'))) return true;
    if (pattern === '.raw/**' && relativePath.split('/').includes('.raw')) return true;
  }

  return false;
}

function inferCategory(relativePath) {
  const firstSegment = relativePath.split('/')[0];
  return firstSegment || 'root';
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}
