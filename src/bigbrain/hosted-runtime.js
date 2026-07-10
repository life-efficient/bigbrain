import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CANONICAL_SCHEMA_DIRS } from './constants.js';
import { createBrainId } from './config.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, '..', '..');

export function hostedBrainOptionsFromEnv(env = process.env, defaults = {}) {
  const dataDir = env.DATA_DIR || defaults.dataDir || '/app/data';
  const brainName = env.BRAIN_NAME || env.BIGBRAIN_MCP_SERVICE_NAME || defaults.brainName || 'Hosted Brain';
  const appName = env.APP_NAME || env.BRAIN_APP_NAME || env.BIGBRAIN_MCP_APP_NAME || defaults.appName || brainName;
  const brainRepoUrl = env.BRAIN_REPO_URL || env.ICAIRE_REPO_URL || defaults.brainRepoUrl || '';
  const brainBranch = env.BRAIN_BRANCH || env.ICAIRE_BRANCH || defaults.brainBranch || 'main';
  const brainRepoDir = env.BRAIN_REPO_DIR || env.ICAIRE_DIR || defaults.brainRepoDir || path.join(dataDir, repoDirName(brainRepoUrl, brainName));
  const brainRoot = env.BRAIN_ROOT || env.BRAIN_SUBDIR || defaults.brainRoot || '';
  const brainDir = env.BIGBRAIN_HOME || (brainRoot ? path.join(brainRepoDir, brainRoot) : brainRepoDir);
  const runtimeId = env.BRAIN_RUNTIME_ID || defaults.runtimeId || slugName(brainName);
  const runtimeDir = env.BIGBRAIN_RUNTIME_DIR || defaults.runtimeDir || path.join(dataDir, 'bigbrain-runtime', runtimeId);

  return {
    dataDir,
    brainName,
    appName,
    brainRepoUrl,
    brainBranch,
    brainRepoDir,
    brainRoot,
    brainDir,
    runtimeId,
    runtimeDir,
    configPath: path.join(runtimeDir, 'config.json'),
    statePath: path.join(runtimeDir, 'state.json'),
    tasksPath: path.join(runtimeDir, 'tasks.md'),
    sqlitePath: path.join(runtimeDir, 'bigbrain.sqlite'),
    tokenStorePath: env.BIGBRAIN_MCP_TOKEN_STORE || path.join(runtimeDir, 'mcp-tokens.json'),
    storageBackend: env.BIGBRAIN_STORAGE_BACKEND || env.STORAGE_BACKEND || 'sqlite',
    databaseUrlEnv: env.BIGBRAIN_DATABASE_URL_ENV || 'DATABASE_URL',
    host: env.HOST || '0.0.0.0',
    port: env.PORT || '3000',
    publicUrl: env.BIGBRAIN_MCP_PUBLIC_URL || env.PUBLIC_URL || '',
  };
}

export async function startHostedBrainServer({ env = process.env, defaults = {} } = {}) {
  const options = hostedBrainOptionsFromEnv(env, defaults);
  if (!options.brainRepoUrl) throw new Error('BRAIN_REPO_URL is required for hosted BigBrain runtime.');

  await fs.mkdir(options.dataDir, { recursive: true });
  await logBigBrainVersion();
  await run('npm', ['install', '--omit=dev'], { cwd: packageRoot, env });
  await prepareBrainRepo(options, env);
  await prepareBigBrainRuntime(options, env);
  await seedMembers(options, env);
  await runBigBrainMcp(options, env);
}

async function logBigBrainVersion() {
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const commit = await capture('git', ['rev-parse', '--short', 'HEAD'], { cwd: packageRoot });
  console.log(`Using BigBrain ${packageJson.version} from ${commit.trim()}.`);
}

async function prepareBrainRepo(options, env) {
  await prepareGitRepo({
    repoUrl: options.brainRepoUrl,
    branch: options.brainBranch,
    targetDir: options.brainRepoDir,
    token: env.BRAIN_GITHUB_TOKEN || env.GITHUB_TOKEN || '',
    dataDir: options.dataDir,
    identityName: `${options.brainName} MCP`,
    identityEmail: 'bigbrain-mcp@users.noreply.github.com',
    env,
  });
}

export async function prepareBigBrainRuntime(options, env = process.env) {
  await fs.mkdir(options.runtimeDir, { recursive: true });
  const existingConfig = await readJsonIfExists(options.configPath);
  await writeIfMissing(options.tasksPath, `# ${options.brainName} Tasks\n\n---\n\n## Timeline\n\n- **${today()}** | Runtime tasks file created for hosted BigBrain.\n`);
  await writeJson(options.configPath, {
    brain_id: existingConfig?.brain_id || createBrainId(),
    brain_name: options.brainName,
    brain_dir: options.brainDir,
    tasks_file: options.tasksPath,
    schema_dirs: [...CANONICAL_SCHEMA_DIRS],
    storage_backend: options.storageBackend,
    database_url_env: options.databaseUrlEnv,
    sqlite_path: options.sqlitePath,
    openai_embedding_model: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    openai_query_model: env.OPENAI_QUERY_MODEL || 'gpt-4.1-mini',
    freshness_inputs: [],
    dashboard_port: 4783,
    lookback_fallback: '24h',
    include_globs: ['**/*.md'],
    exclude_globs: ['.git/**', '.bigbrain-state/**', '.raw/**', '**/README.md', '**/FILING.md'],
  });
  await writeIfMissing(options.statePath, `${JSON.stringify({
    last_checked_at: null,
    last_run_status: null,
    last_run_summary: null,
    last_seen_files: [],
  }, null, 2)}\n`);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function seedMembers(options, env) {
  const members = parseMembersConfig(env);
  if (!members.length) return;

  const bigbrainBin = path.join(packageRoot, 'bin', 'bigbrain.js');
  let seeded = 0;
  for (const member of members) {
    if (!member.email || !member.person_slug) {
      throw new Error('BRAIN_MEMBERS_JSON entries require email and person_slug.');
    }
    await run(process.execPath, [
      bigbrainBin,
      '--config',
      options.configPath,
      'members',
      'add',
      member.email,
      member.person_slug,
      '--name',
      member.name || member.email,
      '--role',
      member.role || 'member',
      '--status',
      member.status || 'active',
    ], { cwd: packageRoot, env });
    seeded += 1;
  }
  console.log(`Seeded ${seeded} active brain member${seeded === 1 ? '' : 's'}.`);
}

async function runBigBrainMcp(options, env) {
  const bigbrainBin = path.join(packageRoot, 'bin', 'bigbrain.js');
  await run(process.execPath, [
    bigbrainBin,
    '--config',
    options.configPath,
    'mcp',
    '--host',
    options.host,
    '--port',
    options.port,
  ], {
    cwd: packageRoot,
    env: {
      ...env,
      BIGBRAIN_MCP_GIT_BACKUP: env.BIGBRAIN_MCP_GIT_BACKUP || '1',
      BIGBRAIN_MCP_SYNC_INTERVAL_MS: env.BIGBRAIN_MCP_SYNC_INTERVAL_MS || '300000',
      BIGBRAIN_MCP_GIT_BACKUP_INTERVAL_MS: env.BIGBRAIN_MCP_GIT_BACKUP_INTERVAL_MS || '300000',
      BIGBRAIN_MCP_SERVICE_NAME: options.brainName,
      BIGBRAIN_MCP_APP_NAME: options.appName,
      BIGBRAIN_MCP_PUBLIC_URL: options.publicUrl,
      BIGBRAIN_MCP_TOKEN_STORE: options.tokenStorePath,
      BIGBRAIN_MCP_LOCAL_PERSON_SLUG: configuredLocalPersonSlug(env),
      GIT_AUTHOR_NAME: env.GIT_AUTHOR_NAME || `${options.brainName} MCP`,
      GIT_AUTHOR_EMAIL: env.GIT_AUTHOR_EMAIL || 'bigbrain-mcp@users.noreply.github.com',
      GIT_COMMITTER_NAME: env.GIT_COMMITTER_NAME || `${options.brainName} MCP`,
      GIT_COMMITTER_EMAIL: env.GIT_COMMITTER_EMAIL || 'bigbrain-mcp@users.noreply.github.com',
    },
  });
}

async function prepareGitRepo({
  repoUrl,
  branch,
  targetDir,
  token = '',
  dataDir,
  resetToRemote = false,
  identityName,
  identityEmail,
  env,
}) {
  const gitDir = path.join(targetDir, '.git');
  if (!await exists(gitDir)) {
    await run('git', ['clone', '--branch', branch, repoUrlWithToken(repoUrl, token), targetDir], { cwd: dataDir, env });
    return;
  }

  await removeStaleGitLock(targetDir);
  await configureGitIdentity(targetDir, identityName, identityEmail, env);
  await run('git', ['rebase', '--abort'], { cwd: targetDir, env, allowFailure: true });
  await run('git', ['remote', 'set-url', 'origin', repoUrlWithToken(repoUrl, token)], { cwd: targetDir, env });
  await run('git', ['fetch', 'origin', branch], { cwd: targetDir, env });
  await run('git', ['checkout', branch], { cwd: targetDir, env });
  if (resetToRemote) {
    await run('git', ['reset', '--hard', `origin/${branch}`], { cwd: targetDir, env });
    return;
  }
  try {
    await run('git', ['pull', '--ff-only', 'origin', branch], { cwd: targetDir, env });
  } catch {
    console.error(`Fast-forward pull failed for ${repoDirName(repoUrl, targetDir)}; trying rebase before startup.`);
    await run('git', ['pull', '--rebase', 'origin', branch], { cwd: targetDir, env });
    await run('git', ['push', 'origin', branch], { cwd: targetDir, env });
  }
}

function parseMembersConfig(env) {
  const raw = env.BRAIN_MEMBERS_JSON || env.ICAIRE_MEMBERS_JSON || '';
  if (!raw.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`BRAIN_MEMBERS_JSON must be a JSON array: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('BRAIN_MEMBERS_JSON must be a JSON array.');
  return parsed.map((member) => ({
    email: String(member?.email || '').trim().toLowerCase(),
    person_slug: String(member?.person_slug || member?.personSlug || '').trim(),
    name: String(member?.name || '').trim(),
    role: String(member?.role || 'member').trim(),
    status: String(member?.status || 'active').trim(),
  }));
}

function configuredLocalPersonSlug(env) {
  if (env.BIGBRAIN_MCP_LOCAL_PERSON_SLUG) return env.BIGBRAIN_MCP_LOCAL_PERSON_SLUG;
  const activeMembers = parseMembersConfig(env).filter((member) => member.status === 'active');
  return activeMembers.length === 1 ? activeMembers[0].person_slug : '';
}

function repoUrlWithToken(url, token) {
  if (!token || !url.startsWith('https://github.com/')) return url;
  return url.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeIfMissing(filePath, value) {
  if (await exists(filePath)) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

async function exists(filePath) {
  return fs.stat(filePath).then(() => true).catch(() => false);
}

async function removeStaleGitLock(repoDir) {
  await fs.rm(path.join(repoDir, '.git', 'index.lock'), { force: true });
}

async function configureGitIdentity(repoDir, fallbackName, fallbackEmail, env) {
  const name = env.GIT_COMMITTER_NAME || env.GIT_AUTHOR_NAME || fallbackName;
  const email = env.GIT_COMMITTER_EMAIL || env.GIT_AUTHOR_EMAIL || fallbackEmail;
  await run('git', ['config', 'user.name', name], { cwd: repoDir, env });
  await run('git', ['config', 'user.email', email], { cwd: repoDir, env });
}

async function run(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...options.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else if (options.allowFailure) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.once('error', reject);
  });
}

async function capture(command, args, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        ...options.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.once('error', reject);
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function slugName(value) {
  return String(value || 'brain')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'brain';
}

function repoDirName(repoUrl, fallback) {
  const clean = String(repoUrl || '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const tail = clean.split('/').filter(Boolean).at(-1);
  return tail || slugName(fallback);
}
