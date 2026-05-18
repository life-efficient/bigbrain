import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CANONICAL_SCHEMA_DIRS,
  CONFIG_FILENAME,
  DB_FILENAME,
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_FRESHNESS_INPUTS,
  DEFAULT_POINTER_PATH,
  DEFAULT_QUERY_MODEL,
  META_DIRNAME,
  STATE_FILENAME,
} from './constants.js';

export function metaDirForBrainHome(brainHome) {
  return path.join(path.resolve(brainHome), META_DIRNAME);
}

export function configPathForBrainHome(brainHome) {
  return path.join(metaDirForBrainHome(brainHome), CONFIG_FILENAME);
}

export function statePathForBrainHome(brainHome) {
  return path.join(metaDirForBrainHome(brainHome), STATE_FILENAME);
}

export function dbPathForBrainHome(brainHome) {
  return path.join(metaDirForBrainHome(brainHome), DB_FILENAME);
}

export function pointerPath(env = process.env) {
  return env.BIGBRAIN_POINTER_PATH || DEFAULT_POINTER_PATH;
}

export async function loadDefaultBrainHomePointer(env = process.env) {
  try {
    const raw = await fs.readFile(pointerPath(env), 'utf8');
    const trimmed = raw.trim();
    return trimmed ? path.resolve(trimmed) : null;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export async function saveDefaultBrainHomePointer(brainHome, env = process.env) {
  const pointer = pointerPath(env);
  await fs.mkdir(path.dirname(pointer), { recursive: true });
  await fs.writeFile(pointer, `${path.resolve(brainHome)}\n`, 'utf8');
}

export async function resolveBrainHome({
  explicitBrainHome = null,
  explicitConfigPath = null,
  env = process.env,
} = {}) {
  if (explicitConfigPath) return path.dirname(path.dirname(path.resolve(explicitConfigPath)));
  if (explicitBrainHome) return path.resolve(explicitBrainHome);
  if (env.BIGBRAIN_HOME) return path.resolve(env.BIGBRAIN_HOME);
  const pointed = await loadDefaultBrainHomePointer(env);
  if (pointed) return pointed;
  throw new Error('No brain home selected. Pass --brain-home, set BIGBRAIN_HOME, or initialize a default brain home.');
}

export function buildDefaultConfig(brainHome) {
  const resolvedBrainHome = path.resolve(brainHome);
  return {
    brain_dir: resolvedBrainHome,
    tasks_file: path.join(resolvedBrainHome, 'ops', 'tasks.md'),
    schema_dirs: [...CANONICAL_SCHEMA_DIRS],
    sqlite_path: dbPathForBrainHome(resolvedBrainHome),
    openai_embedding_model: DEFAULT_EMBEDDING_MODEL,
    openai_query_model: DEFAULT_QUERY_MODEL,
    freshness_inputs: [...DEFAULT_FRESHNESS_INPUTS],
    dashboard_port: DEFAULT_DASHBOARD_PORT,
    lookback_fallback: '24h',
    include_globs: ['**/*.md'],
    exclude_globs: ['.git/**', 'archive/**', '.raw/**'],
  };
}

export async function initializeBrainHome(brainHome, { env = process.env } = {}) {
  const resolvedBrainHome = path.resolve(brainHome);
  const config = buildDefaultConfig(resolvedBrainHome);
  await fs.mkdir(metaDirForBrainHome(resolvedBrainHome), { recursive: true });
  for (const dir of config.schema_dirs) {
    await fs.mkdir(path.join(resolvedBrainHome, dir), { recursive: true });
  }
  await writeIfMissing(config.tasks_file, defaultTasksMarkdown());
  await writeIfMissing(path.join(resolvedBrainHome, 'README.md'), defaultBrainReadme());
  await writeIfMissing(configPathForBrainHome(resolvedBrainHome), `${JSON.stringify(config, null, 2)}\n`);
  await writeIfMissing(statePathForBrainHome(resolvedBrainHome), `${JSON.stringify(defaultState(), null, 2)}\n`);
  await saveDefaultBrainHomePointer(resolvedBrainHome, env);

  return {
    brainHome: resolvedBrainHome,
    configPath: configPathForBrainHome(resolvedBrainHome),
    statePath: statePathForBrainHome(resolvedBrainHome),
    config,
  };
}

export async function loadConfig(input = null) {
  const configPath = await resolveConfigPath(input);
  const raw = await readJsonFile(configPath, 'config');
  const brainHome = path.isAbsolute(raw.brain_dir)
    ? path.resolve(raw.brain_dir)
    : path.dirname(path.dirname(configPath));
  const derivedDefault = buildDefaultConfig(brainHome);

  const config = {
    brainHome,
    configPath,
    statePath: statePathForBrainHome(brainHome),
    metaDir: metaDirForBrainHome(brainHome),
    brainDir: requireAbsoluteString(raw.brain_dir, 'brain_dir'),
    tasksFile: requireAbsoluteString(raw.tasks_file, 'tasks_file'),
    schemaDirs: normalizeStringArray(raw.schema_dirs, derivedDefault.schema_dirs, 'schema_dirs'),
    sqlitePath: requireAbsoluteString(raw.sqlite_path ?? derivedDefault.sqlite_path, 'sqlite_path'),
    openaiEmbeddingModel: requireNonEmptyString(raw.openai_embedding_model ?? derivedDefault.openai_embedding_model, 'openai_embedding_model'),
    openaiQueryModel: requireNonEmptyString(raw.openai_query_model ?? derivedDefault.openai_query_model, 'openai_query_model'),
    freshnessInputs: normalizeStringArray(raw.freshness_inputs, derivedDefault.freshness_inputs, 'freshness_inputs'),
    dashboardPort: normalizePositiveInteger(raw.dashboard_port ?? derivedDefault.dashboard_port, DEFAULT_DASHBOARD_PORT, 'dashboard_port'),
    lookbackFallback: typeof raw.lookback_fallback === 'string' && raw.lookback_fallback.trim() ? raw.lookback_fallback.trim() : '24h',
    includeGlobs: normalizeStringArray(raw.include_globs, derivedDefault.include_globs, 'include_globs'),
    excludeGlobs: normalizeStringArray(raw.exclude_globs, derivedDefault.exclude_globs, 'exclude_globs'),
  };

  await requireExistingDirectory(config.brainDir, `Configured brain directory not found: ${config.brainDir}`);
  await requireExistingFile(config.tasksFile, `Configured tasks file not found: ${config.tasksFile}`);
  return config;
}

export async function loadState(input = null, { allowMissing = true } = {}) {
  const statePath = input?.statePath
    ? path.resolve(input.statePath)
    : input?.brainHome
      ? statePathForBrainHome(input.brainHome)
      : input?.configPath
        ? statePathForBrainHome(path.dirname(path.dirname(path.resolve(input.configPath))))
        : await resolveStatePath();

  try {
    const parsed = await readJsonFile(statePath, 'state');
    if (parsed.last_checked_at !== null && parsed.last_checked_at !== undefined) {
      requireIsoString(parsed.last_checked_at, 'last_checked_at');
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

export async function persistState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function resolveConfigPath(input) {
  if (typeof input === 'string') return path.resolve(input);
  if (input?.configPath) return path.resolve(input.configPath);
  if (input?.brainHome) return configPathForBrainHome(input.brainHome);
  return configPathForBrainHome(await resolveBrainHome({}));
}

async function resolveStatePath() {
  return statePathForBrainHome(await resolveBrainHome({}));
}

async function writeIfMissing(filePath, content) {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }
}

function defaultState() {
  return {
    last_checked_at: null,
    last_run_status: null,
    last_run_summary: null,
    last_seen_files: [],
  };
}

function defaultTasksMarkdown() {
  return `# Tasks

## P1 — Today

## P2 — This Week

## P3 — Backlog
`;
}

function defaultBrainReadme() {
  return `# Bigbrain Home

This directory is the external brain home for a bigbrain instance.

- Markdown pages are the authored source of truth.
- Runtime state lives in \`.bigbrain/\`.
- Tasks live in \`ops/tasks.md\`.
`;
}

async function readJsonFile(filePath, label) {
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireAbsoluteString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0 || !path.isAbsolute(value)) {
    throw new Error(`Invalid config: "${fieldName}" must be a non-empty absolute path.`);
  }
  return path.resolve(value);
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid config: "${fieldName}" must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeStringArray(value, fallback, fieldName) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`Invalid config: "${fieldName}" must be an array of non-empty strings.`);
  }
  return value.map((entry) => entry.trim());
}

function normalizePositiveInteger(value, fallback, fieldName) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid config: "${fieldName}" must be a positive integer.`);
  }
  return value;
}

function requireIsoString(value, fieldName) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid state: "${fieldName}" must be a valid ISO timestamp.`);
  }
}

function isMissingFileError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

async function requireExistingDirectory(dirPath, message) {
  const stats = await fs.stat(dirPath).catch((error) => {
    if (isMissingFileError(error)) throw new Error(message);
    throw error;
  });
  if (!stats.isDirectory()) throw new Error(message);
}

async function requireExistingFile(filePath, message) {
  const stats = await fs.stat(filePath).catch((error) => {
    if (isMissingFileError(error)) throw new Error(message);
    throw error;
  });
  if (!stats.isFile()) throw new Error(message);
}
