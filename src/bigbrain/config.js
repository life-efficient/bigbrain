import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INCLUDE_GLOBS = ['**/*.md'];
const DEFAULT_EXCLUDE_GLOBS = ['.git/**', 'archive/**', '.raw/**'];
const DEFAULT_LOOKBACK_FALLBACK = '24h';

export function defaultConfigPath() {
  return path.resolve(process.cwd(), 'bigbrain.config.json');
}

export function defaultStatePath(configPath = defaultConfigPath()) {
  return path.resolve(path.dirname(configPath), 'bigbrain.state.json');
}

export async function loadConfig(configPath = defaultConfigPath()) {
  const parsed = await readJsonFile(configPath, 'config');
  const brainDir = requireAbsoluteString(parsed.brain_dir, 'brain_dir');
  const tasksFile = requireAbsoluteString(parsed.tasks_file, 'tasks_file');

  const includeGlobs = normalizeStringArray(
    parsed.include_globs,
    DEFAULT_INCLUDE_GLOBS,
    'include_globs',
  );
  const excludeGlobs = normalizeStringArray(
    parsed.exclude_globs,
    DEFAULT_EXCLUDE_GLOBS,
    'exclude_globs',
  );

  if (!excludeGlobs.includes(tasksFile)) {
    excludeGlobs.push(tasksFile);
  }

  const lookbackFallback = typeof parsed.lookback_fallback === 'string' && parsed.lookback_fallback.trim().length > 0
    ? parsed.lookback_fallback.trim()
    : DEFAULT_LOOKBACK_FALLBACK;

  return {
    configPath,
    brainDir: path.normalize(brainDir),
    tasksFile: path.normalize(tasksFile),
    includeGlobs,
    excludeGlobs,
    lookbackFallback,
  };
}

export async function loadState(statePath = defaultStatePath(), { allowMissing = true } = {}) {
  try {
    const parsed = await readJsonFile(statePath, 'state');
    if (parsed.last_checked_at !== null && parsed.last_checked_at !== undefined) {
      requireIsoString(parsed.last_checked_at, 'last_checked_at');
    }
    if (parsed.last_run_status !== null && parsed.last_run_status !== undefined && typeof parsed.last_run_status !== 'string') {
      throw new Error(`Invalid state at ${statePath}: "last_run_status" must be a string or null.`);
    }
    if (parsed.last_run_summary !== null && parsed.last_run_summary !== undefined && typeof parsed.last_run_summary !== 'string') {
      throw new Error(`Invalid state at ${statePath}: "last_run_summary" must be a string or null.`);
    }
    if (parsed.last_seen_files !== null && parsed.last_seen_files !== undefined && !Array.isArray(parsed.last_seen_files)) {
      throw new Error(`Invalid state at ${statePath}: "last_seen_files" must be an array or null.`);
    }
    return {
      statePath,
      lastCheckedAt: parsed.last_checked_at ?? null,
      lastRunStatus: parsed.last_run_status ?? null,
      lastRunSummary: parsed.last_run_summary ?? null,
      lastSeenFiles: parsed.last_seen_files ?? null,
    };
  } catch (error) {
    if (allowMissing && isMissingFileError(error)) {
      return {
        statePath,
        lastCheckedAt: null,
        lastRunStatus: null,
        lastRunSummary: null,
        lastSeenFiles: null,
      };
    }
    throw error;
  }
}

async function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      throw error;
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeStringArray(value, fallback, fieldName) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(`Invalid config: "${fieldName}" must be an array of non-empty strings.`);
  }
  return value.map((entry) => entry.trim());
}

function requireAbsoluteString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid config: "${fieldName}" must be a non-empty absolute path.`);
  }
  if (!path.isAbsolute(value)) {
    throw new Error(`Invalid config: "${fieldName}" must be an absolute path.`);
  }
  return value.trim();
}

function requireIsoString(value, fieldName) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid state: "${fieldName}" must be a valid ISO timestamp.`);
  }
}

function isMissingFileError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
