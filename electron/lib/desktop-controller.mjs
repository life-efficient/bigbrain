import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrainRegistry, SERVICE_OWNERSHIPS } from './brain-registry.mjs';
import { MacKeychain, redactSecrets } from './keychain.mjs';
import { connectionInstructions } from './connection-instructions.mjs';
import { classifyLaunchAgentOwnership, findBrainLaunchAgent } from './launch-agent-discovery.mjs';
import { discoverLocalBrains, findBrainConfigPath } from './brain-discovery.mjs';
import { LocalMcpRunner } from './local-mcp-runner.mjs';
import { assessMcpCompatibility, desktopMcpSupportMetadata } from '../../src/bigbrain/mcp-compatibility.js';

export const REMOTE_PROVISIONING_WIP_MESSAGE = 'Remote Brain provisioning through Railway is not available yet. No remote service was created.';

export class DesktopController {
  constructor({
    registry = new BrainRegistry(),
    keychain = new MacKeychain(),
    appPath,
    nodePath = process.execPath,
    fetchImpl = fetch,
    env = process.env,
    userEnvFile = null,
    home = null,
    launchAgentsDir = null,
    clientVersion = null,
    now = () => new Date(),
    localMcpRunner = null,
  } = {}) {
    this.registry = registry;
    this.keychain = keychain;
    this.appPath = appPath;
    this.nodePath = nodePath;
    this.fetchImpl = fetchImpl;
    this.env = env;
    this.home = path.resolve(home || env.HOME || os.homedir());
    this.launchAgentsDir = launchAgentsDir || path.join(this.home, 'Library', 'LaunchAgents');
    this.userEnvFile = userEnvFile || path.join(this.home, '.config', 'bigbrain', '.env');
    this.clientVersion = clientVersion;
    this.now = now;
    this.localMcpRunner = localMcpRunner || new LocalMcpRunner({ appPath, nodePath, env });
  }

  async state() {
    const registry = await this.loadClassifiedRegistry();
    return {
      ...registry,
      desktop: {
        version: this.clientVersion,
        supported_mcp: desktopMcpSupportMetadata(),
        remote_provisioning: {
          provider: 'railway',
          state: 'wip',
          message: REMOTE_PROVISIONING_WIP_MESSAGE,
        },
      },
      brains: registry.brains.map(publicBrain),
    };
  }

  async loadClassifiedRegistry() {
    const registry = await this.registry.load();
    let changed = false;
    const brains = await Promise.all(registry.brains.map(async (brain) => {
      if (brain.connectionType === 'service') {
        if (brain.serviceOwnership === SERVICE_OWNERSHIPS.REMOTE) return brain;
        changed = true;
        return {
          ...brain,
          serviceOwnership: SERVICE_OWNERSHIPS.REMOTE,
          serviceOwnershipReason: 'remote_connection',
        };
      }
      if (!brain.home) return brain;
      const agent = await findBrainLaunchAgent(brain.home, { launchAgentsDir: this.launchAgentsDir });
      if (!agent) return brain;
      const inferred = classifyLaunchAgentOwnership(agent, { appPath: this.appPath });
      const shouldTrustUnknown = inferred.reason === 'conflicting_launch_agent_markers';
      const ownership = inferred.ownership === SERVICE_OWNERSHIPS.UNKNOWN && !shouldTrustUnknown
        ? brain.serviceOwnership
        : inferred.ownership;
      const reason = inferred.ownership === SERVICE_OWNERSHIPS.UNKNOWN && !shouldTrustUnknown
        ? brain.serviceOwnershipReason
        : inferred.reason;
      if (ownership === brain.serviceOwnership && reason === brain.serviceOwnershipReason) return brain;
      changed = true;
      return { ...brain, serviceOwnership: ownership, serviceOwnershipReason: reason };
    }));
    if (!changed) return registry;
    const updated = { ...registry, brains };
    return typeof this.registry.save === 'function' ? this.registry.save(updated) : updated;
  }

  async discoverBrains() {
    const registry = await this.registry.load();
    return discoverLocalBrains({
      home: this.home,
      env: this.env,
      appSupport: this.registry.appSupport,
      launchAgentsDir: this.launchAgentsDir,
      registeredBrains: registry.brains,
      fetchImpl: this.fetchImpl,
    });
  }

  async validateApiKey(apiKey) {
    if (!apiKey?.startsWith('sk-')) throw new Error('Enter a valid OpenAI API key.');
    const response = await this.fetchImpl('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`OpenAI rejected this API key (HTTP ${response.status}).`);
    return true;
  }

  async availableApiKeys({ existingHome = null } = {}) {
    const candidates = [];
    if (this.env.OPENAI_API_KEY) {
      candidates.push({ id: 'environment', label: 'OPENAI_API_KEY', detail: 'Available to the BigBrain app', secret: this.env.OPENAI_API_KEY });
    }

    const fileKey = await readOpenAiKeyFromEnvFile(this.userEnvFile);
    if (fileKey) {
      candidates.push({ id: 'bigbrain-env-file', label: 'BigBrain configuration', detail: '~/.config/bigbrain/.env', secret: fileKey });
    }

    const registry = await this.registry.load();
    const allowedBrains = registry.brains.filter((brain) => brain.connectionType !== 'service');
    if (existingHome) {
      const existing = await this.inspectExistingBrain(existingHome);
      if (!allowedBrains.some((brain) => brain.id === existing.id)) allowedBrains.push(existing);
    }
    for (const brain of allowedBrains) {
      const secret = await this.keychain.get(brain.id).catch(() => null);
      if (secret) candidates.push({ id: `keychain:${brain.id}`, label: brain.name, detail: 'Stored in macOS Keychain', secret });
    }

    const seen = new Set();
    return candidates.flatMap((candidate) => {
      const secret = candidate.secret.trim();
      if (!secret || seen.has(secret)) return [];
      seen.add(secret);
      return [{ id: candidate.id, label: candidate.label, detail: candidate.detail, masked: maskApiKey(secret) }];
    });
  }

  async resolveApiKey(input) {
    const source = input?.apiKeySource || 'manual';
    if (source === 'manual') return input?.apiKey?.trim() || '';
    if (source === 'environment') return this.env.OPENAI_API_KEY?.trim() || '';
    if (source === 'bigbrain-env-file') return await readOpenAiKeyFromEnvFile(this.userEnvFile) || '';
    if (source.startsWith('keychain:')) {
      const brainId = source.slice('keychain:'.length);
      const registry = await this.registry.load();
      let allowed = registry.brains.some((brain) => brain.connectionType !== 'service' && brain.id === brainId);
      if (!allowed && input?.existingHome) {
        const existing = await this.inspectExistingBrain(input.existingHome);
        allowed = existing.id === brainId;
      }
      if (!allowed) throw new Error('That saved API key is no longer available. Choose another key.');
      return await this.keychain.get(brainId).catch(() => '');
    }
    throw new Error('Choose a valid API key source.');
  }

  async inspectExistingBrain(home) {
    if (!home) throw new Error('Choose a brain folder.');
    const resolvedHome = path.resolve(home);
    const configPath = await findBrainConfigPath(resolvedHome, { home: this.home });
    if (!configPath) {
      throw new Error('That folder is not an initialized BigBrain brain. Choose the folder that contains the brain files.');
    }
    const { loadConfig } = await import(pathToModule(this.appPath, 'src/bigbrain/config.js'));
    const config = await loadConfig({ configPath });
    const existingService = await findBrainLaunchAgent(config.brainHome, { launchAgentsDir: this.launchAgentsDir });
    return { id: config.brainId, name: config.brainName, home: config.brainHome, port: existingService?.port, replacedService: existingService };
  }

  async createBrain(input) {
    validateInput(input);
    const existing = input.existingHome ? await this.inspectExistingBrain(input.existingHome) : null;
    const newHome = input.newHome ? await this.validateNewBrainHome(input.newHome) : null;
    if (existing && newHome) throw new Error('Choose either an existing brain folder or a new folder, not both.');
    const apiKey = await this.resolveApiKey(input);
    await this.validateApiKey(apiKey);
    const defaultPointer = existing ? null : defaultBrainHomePointerPath(this.env, this.home);
    const previousDefaultPointer = defaultPointer ? await readFileIfPresent(defaultPointer) : null;
    const draft = existing
      ? await this.registry.registerExisting({
        ...existing,
        ownerName: input.ownerName,
        ownerEmail: input.ownerEmail,
        backupPreference: input.gitBackup === false ? 'none' : 'github',
      })
      : await this.registry.createDraft({
        ...input,
        home: newHome,
        description: input.description,
        backupPreference: input.gitBackup === false ? 'none' : 'github',
      });
    try {
      await this.keychain.set(draft.id, apiKey);
      const [{ initializeBrainHome }, { loadConfig }, { syncBrain }] = await Promise.all([
        import(pathToModule(this.appPath, 'src/bigbrain/config.js')),
        import(pathToModule(this.appPath, 'src/bigbrain/config.js')),
        import(pathToModule(this.appPath, 'src/bigbrain/sync.js')),
      ]);
      if (!existing) await initializeBrainHome(draft.home, {
        env: this.env,
        brainName: draft.name,
        brainDescription: draft.description,
      });
      const ownerSlug = `people/${slugify(input.ownerName)}`;
      await this.installService(draft, { ownerSlug, gitBackup: draft.backupPreference !== 'none' });
      const config = await loadConfig({ brainHome: draft.home });
      await syncBrain({ config, apiKey }).catch(() => null);
      const health = await this.readServiceHealth(`http://${draft.host}:${draft.port}`);
      const brain = await this.registry.update(draft.id, {
        brainId: config.brainId,
        status: 'running',
        mcpCompatibility: checkedCompatibility(health, this.now),
        owner: { ...draft.owner, personSlug: ownerSlug },
        onboarding: { step: 5, completed: true, error: null },
      });
      return {
        brain: publicBrain(brain),
        instructions: connectionInstructions(brain),
        backupPreference: brain.backupPreference || 'github',
      };
    } catch (error) {
      if (defaultPointer) await restoreFile(defaultPointer, previousDefaultPointer);
      await this.registry.update(draft.id, { status: 'error', onboarding: { step: 4, completed: false, error: redactSecrets(error.message) } });
      throw new Error(redactSecrets(error.message));
    }
  }

  async validateNewBrainHome(home) {
    const resolvedHome = path.resolve(String(home).trim());
    let stats;
    try {
      stats = await fs.stat(resolvedHome);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return resolvedHome;
    }
    if (!stats.isDirectory()) throw new Error('Choose a folder for the new private brain.');
    const configPath = await findBrainConfigPath(resolvedHome, { home: this.home });
    if (configPath) throw new Error('That folder already contains a BigBrain brain. Choose it as an existing brain folder instead.');
    return resolvedHome;
  }

  async connectService(input) {
    const serviceUrl = normalizeServiceUrl(input?.serviceUrl);
    const health = await this.readServiceHealth(serviceUrl);
    if (health?.ok !== true || typeof health.brain_id !== 'string' || typeof health.brain_name !== 'string') {
      throw new Error(`The service at ${serviceUrl} did not identify itself as BigBrain.`);
    }
    const mcpCompatibility = checkedCompatibility(health, this.now);
    return publicBrain(await this.registry.registerService({
      brainId: health.brain_id,
      name: health.brain_name,
      serviceUrl,
      mcpCompatibility,
    }));
  }

  async provisionRemoteBrain() {
    throw new Error(REMOTE_PROVISIONING_WIP_MESSAGE);
  }

  async checkConnection(id) {
    const registry = await this.loadClassifiedRegistry();
    const brain = registry.brains.find((item) => item.id === id);
    if (!brain) throw new Error(`Unknown brain: ${id}`);
    const publicValue = publicBrain(brain);
    const serviceUrl = publicValue.mcpUrl?.replace(/\/mcp$/, '');
    if (!serviceUrl) return publicValue;
    try {
      const health = await this.readServiceHealth(serviceUrl);
      if (health?.ok !== true || (brain.brainId && health.brain_id !== brain.brainId)) return publicValue;
      return publicBrain(await this.registry.update(id, {
        status: brain.connectionType === 'service' ? 'connected' : 'running',
        mcpCompatibility: checkedCompatibility(health, this.now),
      }));
    } catch {
      return publicValue;
    }
  }

  async readServiceHealth(serviceUrl) {
    let response;
    try {
      response = await this.fetchImpl(`${serviceUrl}/health`, { headers: { accept: 'application/json' } });
    } catch (error) {
      throw new Error(`Could not reach BigBrain at ${serviceUrl}: ${redactSecrets(error.message)}`);
    }
    if (!response.ok) throw new Error(`BigBrain at ${serviceUrl} returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error(`The service at ${serviceUrl} did not return a valid BigBrain health response.`);
    }
  }

  async installService(brain, { ownerSlug, gitBackup = true } = {}) {
    if (brain.serviceOwnership !== SERVICE_OWNERSHIPS.DESKTOP_BUNDLE) {
      throw new Error('Only a desktop-bundle service can be installed by the BigBrain desktop app.');
    }
    return this.localMcpRunner.provision(brain, { ownerSlug, gitBackup });
  }

  async activate(id) { return publicBrain(await this.registry.activate(id)); }
  async resolveCanonicalBrain(brainId) {
    const registry = await this.registry.load();
    for (const brain of registry.brains) {
      let canonicalBrainId = brain.brainId || null;
      if (!canonicalBrainId && brain.connectionType !== 'service' && brain.port) {
        const host = brain.host || '127.0.0.1';
        const health = await fetchBrainHealth(`http://${host}:${brain.port}`, this.fetchImpl).catch(() => null);
        canonicalBrainId = health?.brainId || null;
      }
      if (canonicalBrainId === brainId) return publicBrain({ ...brain, brainId: canonicalBrainId });
    }
    throw new Error(`Unknown canonical brain: ${brainId}`);
  }
  async rename(id, name) {
    if (!name?.trim()) throw new Error('Brain name is required.');
    return publicBrain(await this.registry.update(id, { name: name.trim() }));
  }
  async instructions(id) {
    const registry = await this.registry.load();
    const brain = registry.brains.find((item) => item.id === id);
    if (!brain) throw new Error(`Unknown brain: ${id}`);
    return connectionInstructions(publicBrain(brain));
  }
  async restart(id) {
    const registry = await this.loadClassifiedRegistry();
    const brain = registry.brains.find((item) => item.id === id);
    if (!brain) throw new Error(`Unknown brain: ${id}`);
    if (brain.serviceOwnership === SERVICE_OWNERSHIPS.REMOTE) {
      throw new Error('Remote BigBrain services must be restarted by their operator.');
    }
    if (brain.serviceOwnership !== SERVICE_OWNERSHIPS.DESKTOP_BUNDLE) {
      throw new Error('This local BigBrain service is not managed by the desktop app.');
    }
    await this.localMcpRunner.restart(brain);
    return publicBrain(await this.registry.update(id, { status: 'running' }));
  }
  async setDefault(id) {
    const brain = await this.registry.activate(id);
    const pointer = defaultBrainHomePointerPath(this.env, this.home);
    await fs.mkdir(path.dirname(pointer), { recursive: true });
    await fs.writeFile(pointer, `${brain.home}\n`);
    return publicBrain(brain);
  }
}

function defaultBrainHomePointerPath(env, home) {
  return env.BIGBRAIN_POINTER_PATH || path.join(home, '.config', 'bigbrain', 'default-brain-home');
}

async function readFileIfPresent(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreFile(filePath, content) {
  if (content === null) {
    await fs.rm(filePath, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function pathToModule(root, relative) { return new URL(`file://${path.join(root, relative)}`).href; }
function maskApiKey(value) { return `OpenAI key ending in ${String(value).slice(-4)}`; }
async function readOpenAiKeyFromEnvFile(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  for (const line of raw.split(/\r?\n/)) {
    const normalized = line.trim().replace(/^export\s+/, '');
    if (!normalized || normalized.startsWith('#')) continue;
    const match = normalized.match(/^OPENAI_API_KEY\s*=\s*(.*)$/);
    if (!match) continue;
    return unquoteEnvValue(match[1].trim());
  }
  return null;
}
function unquoteEnvValue(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}
function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'owner'; }
function validateInput(input) {
  if (!input?.ownerName?.trim() || !input?.ownerEmail?.includes('@')) throw new Error('Name and a valid email are required.');
  if (!input?.name?.trim()) throw new Error('Brain name is required.');
  if (!input?.existingHome && !input?.description?.trim()) throw new Error('Brain description is required.');
  if (input.mode && input.mode !== 'local') throw new Error('Run-on-device setup requires local mode.');
}
function publicBrain(brain) {
  if (brain.connectionType === 'service') {
    return { ...brain, dashboardUrl: `${brain.serviceUrl}/dashboard`, mcpUrl: `${brain.serviceUrl}/mcp` };
  }
  return { ...brain, dashboardUrl: `http://${brain.host}:${brain.port}/dashboard`, mcpUrl: `http://${brain.host}:${brain.port}/mcp` };
}

function checkedCompatibility(health, now) {
  return {
    ...assessMcpCompatibility(health),
    checked_at: now().toISOString(),
  };
}

async function fetchBrainHealth(serviceUrl, fetchImpl) {
  const response = await fetchImpl(`${serviceUrl}/health`, { headers: { accept: 'application/json' } });
  if (!response.ok) return null;
  const health = await response.json();
  if (health?.ok !== true || typeof health.brain_id !== 'string') return null;
  return { brainId: health.brain_id, brainName: health.brain_name || null };
}

export function normalizeServiceUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('Enter a valid BigBrain service address, including http:// or https://.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('BigBrain service addresses must use http or https.');
  if (parsed.username || parsed.password) throw new Error('BigBrain service addresses cannot include a username or password.');
  if (parsed.search || parsed.hash) throw new Error('Enter the BigBrain service address without query parameters or a fragment.');
  parsed.pathname = parsed.pathname.replace(/\/(dashboard|mcp|connect|health)\/?$/, '').replace(/\/$/, '');
  return parsed.toString().replace(/\/$/, '');
}
