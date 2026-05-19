import path from 'node:path';

export function shouldSkipSystemPath(relativePath) {
  const normalized = toPosixPath(relativePath);
  if (normalized === '.git' || normalized.startsWith('.git/')) return true;
  if (normalized === '.bigbrain' || normalized.startsWith('.bigbrain/')) return true;
  if (normalized === '.bigbrain-state' || normalized.startsWith('.bigbrain-state/')) return true;
  if (normalized === 'archive' || normalized.startsWith('archive/')) return true;
  const segments = normalized.split('/');
  return segments.includes('.raw');
}

export function matchesIncludeGlobs(relativePath, includeGlobs) {
  return includeGlobs.some((pattern) => matchesGlob(relativePath, pattern));
}

export function isExcludedPath(fullPath, relativePath, excludeGlobs, tasksFile) {
  const normalizedFull = path.resolve(fullPath);
  if (tasksFile && normalizedFull === path.resolve(tasksFile)) return true;

  return excludeGlobs.some((pattern) => {
    if (path.isAbsolute(pattern)) return path.resolve(pattern) === normalizedFull;
    return matchesGlob(relativePath, pattern);
  });
}

function matchesGlob(relativePath, pattern) {
  const normalizedRelative = toPosixPath(relativePath);
  const normalizedPattern = toPosixPath(pattern);

  if (normalizedPattern === '**') return true;
  if (normalizedPattern === '**/*.md') return normalizedRelative.endsWith('.md');
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedRelative === prefix || normalizedRelative.startsWith(`${prefix}/`);
  }

  return normalizedRelative === normalizedPattern;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}
