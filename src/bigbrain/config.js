import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
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
  DEFAULT_RAW_FILE_MAX_BYTES,
  DEFAULT_STATE_ROOT,
  LEGACY_META_DIRNAME,
  STATE_FILENAME,
  STATE_ROOT_DIRNAME,
} from './constants.js';

export function legacyMetaDirForBrainHome(brainHome) {
  return path.join(path.resolve(brainHome), LEGACY_META_DIRNAME);
}

export function stateRootPath(env = process.env, brainHome = null) {
  if (env.BIGBRAIN_STATE_ROOT) return path.resolve(env.BIGBRAIN_STATE_ROOT);
  if (brainHome) return path.join(path.resolve(brainHome), STATE_ROOT_DIRNAME);
  if (env.HOME) return path.join(path.resolve(env.HOME), STATE_ROOT_DIRNAME, 'brains');
  return DEFAULT_STATE_ROOT;
}

export function metaDirForBrainHome(brainHome, env = process.env) {
  if (!env.BIGBRAIN_STATE_ROOT) return stateRootPath(env, brainHome);
  return path.join(stateRootPath(env, brainHome), runtimeDirNameForBrainHome(brainHome));
}

export function configPathForBrainHome(brainHome, env = process.env) {
  return path.join(metaDirForBrainHome(brainHome, env), CONFIG_FILENAME);
}

export function statePathForBrainHome(brainHome, env = process.env) {
  return path.join(metaDirForBrainHome(brainHome, env), STATE_FILENAME);
}

export function dbPathForBrainHome(brainHome, env = process.env) {
  return path.join(metaDirForBrainHome(brainHome, env), DB_FILENAME);
}

export function pointerPath(env = process.env) {
  return env.BIGBRAIN_POINTER_PATH || DEFAULT_POINTER_PATH;
}

export function userEnvPath(env = process.env) {
  const home = env.HOME || os.homedir();
  return path.join(path.resolve(home), '.config', 'bigbrain', '.env');
}

export async function loadUserEnv(env = process.env, envPath = userEnvPath(env)) {
  let raw;
  try {
    raw = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return { path: envPath, loaded: [], missing: true };
    throw error;
  }

  const loaded = [];
  for (const [key, value] of parseEnvFile(raw)) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    loaded.push(key);
  }
  return { path: envPath, loaded, missing: false };
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
  if (explicitConfigPath) {
    const config = await readJsonFile(path.resolve(explicitConfigPath), 'config');
    return requireAbsoluteString(config.brain_dir, 'brain_dir');
  }
  if (explicitBrainHome) return path.resolve(explicitBrainHome);
  if (env.BIGBRAIN_HOME) return path.resolve(env.BIGBRAIN_HOME);
  const pointed = await loadDefaultBrainHomePointer(env);
  if (pointed) return pointed;
  throw new Error('No brain home selected. Pass --brain-home, set BIGBRAIN_HOME, or initialize a default brain home.');
}

export function buildDefaultConfig(brainHome, env = process.env) {
  const resolvedBrainHome = path.resolve(brainHome);
  return {
    brain_dir: resolvedBrainHome,
    tasks_file: path.join(resolvedBrainHome, 'ops', 'tasks.md'),
    schema_dirs: [...CANONICAL_SCHEMA_DIRS],
    storage_backend: 'sqlite',
    database_url_env: 'DATABASE_URL',
    sqlite_path: dbPathForBrainHome(resolvedBrainHome, env),
    openai_embedding_model: DEFAULT_EMBEDDING_MODEL,
    openai_query_model: DEFAULT_QUERY_MODEL,
    freshness_inputs: [...DEFAULT_FRESHNESS_INPUTS],
    dashboard_port: DEFAULT_DASHBOARD_PORT,
    lookback_fallback: '24h',
    include_globs: ['**/*.md'],
    exclude_globs: ['.git/**', 'archive/**', '.raw/**', '**/README.md', '**/FILING.md'],
    raw_file_max_bytes: normalizePositiveInteger(env.BIGBRAIN_RAW_FILE_MAX_BYTES, DEFAULT_RAW_FILE_MAX_BYTES, 'BIGBRAIN_RAW_FILE_MAX_BYTES'),
  };
}

export async function initializeBrainHome(brainHome, { env = process.env } = {}) {
  const resolvedBrainHome = path.resolve(brainHome);
  const config = buildDefaultConfig(resolvedBrainHome, env);
  const metaDir = metaDirForBrainHome(resolvedBrainHome, env);

  await maybeMigrateLegacyRuntime(resolvedBrainHome, metaDir);
  await fs.mkdir(metaDir, { recursive: true });
  for (const dir of config.schema_dirs) {
    await fs.mkdir(path.join(resolvedBrainHome, dir), { recursive: true });
  }
  await writeIfMissing(config.tasks_file, defaultTasksMarkdown());
  await writeIfMissing(configPathForBrainHome(resolvedBrainHome, env), `${JSON.stringify(configFileDefaults(config), null, 2)}\n`);
  await writeIfMissing(statePathForBrainHome(resolvedBrainHome, env), `${JSON.stringify(defaultState(), null, 2)}\n`);
  await reconcileConfigFile(configPathForBrainHome(resolvedBrainHome, env), config);
  await saveDefaultBrainHomePointer(resolvedBrainHome, env);

  return {
    brainHome: resolvedBrainHome,
    configPath: configPathForBrainHome(resolvedBrainHome, env),
    statePath: statePathForBrainHome(resolvedBrainHome, env),
    config,
  };
}

export async function loadConfig(input = null) {
  const configPath = await resolveConfigPath(input);
  const raw = await readJsonFile(configPath, 'config');
  const brainHome = requireAbsoluteString(raw.brain_dir, 'brain_dir');
  const derivedDefault = buildDefaultConfig(brainHome);

  const config = {
    brainHome,
    configPath,
    statePath: path.join(path.dirname(configPath), STATE_FILENAME),
    metaDir: path.dirname(configPath),
    brainDir: requireAbsoluteString(raw.brain_dir, 'brain_dir'),
    tasksFile: resolveConfigPathValue(raw.tasks_file ?? derivedDefault.tasks_file, brainHome, 'tasks_file'),
    schemaDirs: normalizeStringArray(raw.schema_dirs, derivedDefault.schema_dirs, 'schema_dirs'),
    storageBackend: normalizeStorageBackend(raw.storage_backend ?? derivedDefault.storage_backend),
    databaseUrlEnv: requireNonEmptyString(raw.database_url_env ?? derivedDefault.database_url_env, 'database_url_env'),
    sqlitePath: resolveConfigPathValue(raw.sqlite_path ?? derivedDefault.sqlite_path, brainHome, 'sqlite_path'),
    openaiEmbeddingModel: requireNonEmptyString(raw.openai_embedding_model ?? derivedDefault.openai_embedding_model, 'openai_embedding_model'),
    openaiQueryModel: requireNonEmptyString(raw.openai_query_model ?? derivedDefault.openai_query_model, 'openai_query_model'),
    freshnessInputs: normalizeStringArray(raw.freshness_inputs, derivedDefault.freshness_inputs, 'freshness_inputs'),
    dashboardPort: normalizePositiveInteger(raw.dashboard_port ?? derivedDefault.dashboard_port, DEFAULT_DASHBOARD_PORT, 'dashboard_port'),
    lookbackFallback: typeof raw.lookback_fallback === 'string' && raw.lookback_fallback.trim() ? raw.lookback_fallback.trim() : '24h',
    includeGlobs: normalizeStringArray(raw.include_globs, derivedDefault.include_globs, 'include_globs'),
    excludeGlobs: normalizeStringArray(raw.exclude_globs, derivedDefault.exclude_globs, 'exclude_globs'),
    rawFileMaxBytes: normalizePositiveInteger(raw.raw_file_max_bytes ?? derivedDefault.raw_file_max_bytes, derivedDefault.raw_file_max_bytes, 'raw_file_max_bytes'),
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
        ? path.join(path.dirname(path.resolve(input.configPath)), STATE_FILENAME)
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

async function maybeMigrateLegacyRuntime(brainHome, targetMetaDir) {
  const legacyMetaDir = legacyMetaDirForBrainHome(brainHome);
  if (path.resolve(legacyMetaDir) === path.resolve(targetMetaDir)) return;
  const legacyExists = await fs.stat(legacyMetaDir).then((stats) => stats.isDirectory()).catch(() => false);
  if (!legacyExists) return;

  await fs.mkdir(targetMetaDir, { recursive: true });
  for (const filename of [CONFIG_FILENAME, STATE_FILENAME, DB_FILENAME, `${DB_FILENAME}-shm`, `${DB_FILENAME}-wal`]) {
    const sourcePath = path.join(legacyMetaDir, filename);
    const targetPath = path.join(targetMetaDir, filename);
    const exists = await fs.stat(sourcePath).then((stats) => stats.isFile()).catch(() => false);
    if (!exists) continue;
    const alreadyThere = await fs.stat(targetPath).then((stats) => stats.isFile()).catch(() => false);
    if (alreadyThere) continue;
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function reconcileConfigFile(configPath, desiredConfig) {
  const current = await readJsonFile(configPath, 'config');
  const next = {
    ...current,
    brain_dir: desiredConfig.brain_dir,
  };
  if (current.tasks_file && path.resolve(current.tasks_file) === desiredConfig.tasks_file) delete next.tasks_file;
  if (current.sqlite_path && path.resolve(current.sqlite_path) === desiredConfig.sqlite_path) delete next.sqlite_path;
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function configFileDefaults(config) {
  const { tasks_file: _tasksFile, sqlite_path: _sqlitePath, ...stored } = config;
  return stored;
}

function normalizeStorageBackend(value) {
  const normalized = requireNonEmptyString(value, 'storage_backend').toLowerCase();
  if (normalized !== 'sqlite' && normalized !== 'postgres') {
    throw new Error('Invalid config: "storage_backend" must be "sqlite" or "postgres".');
  }
  return normalized;
}

function runtimeDirNameForBrainHome(brainHome) {
  const resolvedBrainHome = path.resolve(brainHome);
  const base = path.basename(resolvedBrainHome).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brain';
  const hash = crypto.createHash('sha1').update(resolvedBrainHome).digest('hex').slice(0, 10);
  return `${base}-${hash}`;
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

function resolveConfigPathValue(value, brainHome, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid config: "${fieldName}" must be a non-empty path.`);
  }
  const trimmed = value.trim();
  return path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(brainHome, trimmed));
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

function parseEnvFile(raw) {
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    entries.push([key, unquoteEnvValue(normalized.slice(separator + 1).trim())]);
  }
  return entries;
}

function unquoteEnvValue(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
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
