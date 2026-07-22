import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverBrainLaunchAgents } from './launch-agent-discovery.mjs';

const CURRENT_CONFIG = path.join('.bigbrain-state', 'config.json');
const LEGACY_CONFIG = path.join('.bigbrain', 'config.json');
const KNOWN_LOOPBACK_PORTS = [55560, 3333];

export async function discoverLocalBrains({
  home = null,
  env = process.env,
  appSupport = null,
  launchAgentsDir = null,
  registeredBrains = [],
  fetchImpl = fetch,
  probeTimeoutMs = 750,
} = {}) {
  const homeDir = path.resolve(home || env.HOME || os.homedir());
  const supportDir = appSupport || path.join(homeDir, 'Library', 'Application Support', 'BigBrain');
  const agentsDir = launchAgentsDir || path.join(homeDir, 'Library', 'LaunchAgents');
  const candidates = new Map();
  const addHome = (value, source) => {
    if (!value || typeof value !== 'string') return;
    const resolved = path.resolve(value);
    const existing = candidates.get(resolved) || { home: resolved, sources: new Set() };
    existing.sources.add(source);
    candidates.set(resolved, existing);
  };

  addHome(env.BIGBRAIN_HOME, 'BIGBRAIN_HOME');
  addHome(await readText(pointerPath(homeDir, env)), 'Saved default');
  for (const brain of registeredBrains) {
    if (brain?.connectionType !== 'service') addHome(brain?.home, 'Desktop registry');
  }

  for (const child of await directoryNames(path.join(supportDir, 'brains'))) {
    addHome(path.join(supportDir, 'brains', child), 'BigBrain desktop');
  }

  const agents = await discoverBrainLaunchAgents({ launchAgentsDir: agentsDir });
  for (const agent of agents) addHome(agent.home, 'BigBrain service');

  for (const conventional of conventionalHomes(homeDir)) addHome(conventional, 'Common BigBrain location');
  for (const configPath of await indexedConfigPaths(homeDir)) {
    const raw = await readJson(configPath);
    addHome(raw?.brain_dir, 'Previous BigBrain runtime');
  }

  const discovered = [];
  for (const candidate of candidates.values()) {
    const configPath = await findBrainConfigPath(candidate.home, { home: homeDir });
    if (!configPath) continue;
    const raw = await readJson(configPath);
    if (!raw?.brain_dir) continue;
    const resolvedHome = path.resolve(raw.brain_dir);
    const agent = agents.find((item) => item.home === resolvedHome && item.port);
    discovered.push({
      id: typeof raw.brain_id === 'string' ? raw.brain_id : null,
      name: typeof raw.brain_name === 'string' && raw.brain_name.trim() ? raw.brain_name.trim() : path.basename(resolvedHome),
      home: resolvedHome,
      serviceUrl: agent ? `http://${agent.host}:${agent.port}` : null,
      status: 'stopped',
      sources: [...candidate.sources],
    });
  }

  const serviceUrls = new Set(agents.filter((agent) => agent.port).map((agent) => `http://${agent.host}:${agent.port}`));
  for (const port of KNOWN_LOOPBACK_PORTS) serviceUrls.add(`http://127.0.0.1:${port}`);
  for (const serviceUrl of serviceUrls) {
    const health = await probeBigBrain(serviceUrl, { fetchImpl, timeoutMs: probeTimeoutMs });
    if (!health) continue;
    let brain = discovered.find((item) => item.id && item.id === health.brainId);
    if (!brain) brain = discovered.find((item) => item.serviceUrl === serviceUrl);
    if (brain) {
      brain.id ||= health.brainId;
      brain.name = health.name || brain.name;
      brain.serviceUrl = serviceUrl;
      brain.status = 'running';
      if (!brain.sources.includes('Running service')) brain.sources.push('Running service');
    } else {
      discovered.push({ id: health.brainId, name: health.name, home: null, serviceUrl, status: 'running', sources: ['Running service'] });
    }
  }

  const registeredIds = new Set(registeredBrains.flatMap((brain) => [brain?.id, brain?.brainId]).filter(Boolean));
  const registeredHomes = new Set(registeredBrains.map((brain) => brain?.home && path.resolve(brain.home)).filter(Boolean));
  const registeredUrls = new Set(registeredBrains.map((brain) => normalizeUrl(brain?.serviceUrl)).filter(Boolean));
  const seen = new Set();
  return discovered.filter((brain) => {
    if (registeredIds.has(brain.id) || (brain.home && registeredHomes.has(path.resolve(brain.home))) || registeredUrls.has(normalizeUrl(brain.serviceUrl))) return false;
    const key = brain.id || brain.home || normalizeUrl(brain.serviceUrl);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findBrainConfigPath(brainHome, { home = os.homedir() } = {}) {
  const resolvedHome = path.resolve(brainHome);
  for (const relative of [CURRENT_CONFIG, LEGACY_CONFIG]) {
    const candidate = path.join(resolvedHome, relative);
    if (await isFile(candidate)) return candidate;
  }
  for (const child of await directoryNames(path.join(resolvedHome, '.bigbrain-state', 'brains'))) {
    const candidate = path.join(resolvedHome, '.bigbrain-state', 'brains', child, 'config.json');
    if (await configPointsTo(candidate, resolvedHome)) return candidate;
  }
  for (const candidate of await indexedConfigPaths(path.resolve(home))) {
    if (await configPointsTo(candidate, resolvedHome)) return candidate;
  }
  return null;
}

async function probeBigBrain(serviceUrl, { fetchImpl, timeoutMs }) {
  try {
    const response = await fetchImpl(`${serviceUrl}/health`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const health = await response.json();
    if (health?.ok !== true || typeof health.brain_id !== 'string' || typeof health.brain_name !== 'string') return null;
    return { brainId: health.brain_id, name: health.brain_name };
  } catch {
    return null;
  }
}

function pointerPath(home, env) {
  return env.BIGBRAIN_POINTER_PATH || path.join(home, '.config', 'bigbrain', 'default-brain-home');
}

function conventionalHomes(home) {
  return [
    path.join(home, 'brain'), path.join(home, 'brain-home'), path.join(home, 'bigbrain-home'),
    path.join(home, 'projects', 'brain'), path.join(home, 'projects', 'bigbrain-home'),
    path.join(home, 'Documents', 'brain'), path.join(home, 'Documents', 'bigbrain-home'),
  ];
}

async function indexedConfigPaths(home) {
  const root = path.join(home, '.bigbrain-state', 'brains');
  return (await directoryNames(root)).map((child) => path.join(root, child, 'config.json'));
}

async function directoryNames(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function readText(filePath) {
  try { return (await fs.readFile(filePath, 'utf8')).trim() || null; } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; }
}

async function isFile(filePath) {
  return fs.stat(filePath).then((value) => value.isFile()).catch(() => false);
}

async function configPointsTo(configPath, brainHome) {
  const raw = await readJson(configPath);
  return typeof raw?.brain_dir === 'string' && path.resolve(raw.brain_dir) === brainHome;
}

function normalizeUrl(value) {
  return typeof value === 'string' ? value.replace(/\/$/, '') : null;
}
