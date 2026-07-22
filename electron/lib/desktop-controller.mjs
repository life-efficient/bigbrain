import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrainRegistry } from './brain-registry.mjs';
import { MacKeychain, redactSecrets } from './keychain.mjs';
import { connectionInstructions } from './connection-instructions.mjs';
import { findBrainLaunchAgent } from './launch-agent-discovery.mjs';

const execFileAsync = promisify(execFile);

export class DesktopController {
  constructor({
    registry = new BrainRegistry(),
    keychain = new MacKeychain(),
    appPath,
    nodePath = process.execPath,
    fetchImpl = fetch,
    env = process.env,
    userEnvFile = null,
  } = {}) {
    this.registry = registry;
    this.keychain = keychain;
    this.appPath = appPath;
    this.nodePath = nodePath;
    this.fetchImpl = fetchImpl;
    this.env = env;
    this.userEnvFile = userEnvFile || path.join(env.HOME || os.homedir(), '.config', 'bigbrain', '.env');
  }

  async state() {
    const registry = await this.registry.load();
    return { ...registry, brains: registry.brains.map(publicBrain) };
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
    try {
      await fs.access(path.join(resolvedHome, '.bigbrain-state', 'config.json'));
    } catch {
      throw new Error('That folder is not an initialized BigBrain brain. Choose the brain folder containing .bigbrain-state.');
    }
    const { loadConfig } = await import(pathToModule(this.appPath, 'src/bigbrain/config.js'));
    const config = await loadConfig({ brainHome: resolvedHome });
    const existingService = await findBrainLaunchAgent(config.brainHome);
    return { id: config.brainId, name: config.brainName, home: config.brainHome, port: existingService?.port, replacedService: existingService };
  }

  async createBrain(input) {
    validateInput(input);
    const existing = input.existingHome ? await this.inspectExistingBrain(input.existingHome) : null;
    const apiKey = await this.resolveApiKey(input);
    await this.validateApiKey(apiKey);
    const draft = existing
      ? await this.registry.registerExisting({ ...existing, ownerName: input.ownerName, ownerEmail: input.ownerEmail })
      : await this.registry.createDraft(input);
    try {
      await this.keychain.set(draft.id, apiKey);
      const [{ initializeBrainHome }, { loadConfig }, { syncBrain }] = await Promise.all([
        import(pathToModule(this.appPath, 'src/bigbrain/config.js')),
        import(pathToModule(this.appPath, 'src/bigbrain/config.js')),
        import(pathToModule(this.appPath, 'src/bigbrain/sync.js')),
      ]);
      if (!existing) await initializeBrainHome(draft.home, { brainName: draft.name });
      const ownerSlug = `people/${slugify(input.ownerName)}`;
      await this.installService(draft, { ownerSlug });
      const config = await loadConfig({ brainHome: draft.home });
      await syncBrain({ config, apiKey }).catch(() => null);
      const brain = await this.registry.update(draft.id, {
        status: 'running',
        owner: { ...draft.owner, personSlug: ownerSlug },
        onboarding: { step: 5, completed: true, error: null },
      });
      return { brain: publicBrain(brain), instructions: connectionInstructions(brain) };
    } catch (error) {
      await this.registry.update(draft.id, { status: 'error', onboarding: { step: 4, completed: false, error: redactSecrets(error.message) } });
      throw new Error(redactSecrets(error.message));
    }
  }

  async connectService(input) {
    const serviceUrl = normalizeServiceUrl(input?.serviceUrl);
    let response;
    try {
      response = await this.fetchImpl(`${serviceUrl}/health`, { headers: { accept: 'application/json' } });
    } catch (error) {
      throw new Error(`Could not reach BigBrain at ${serviceUrl}: ${redactSecrets(error.message)}`);
    }
    if (!response.ok) throw new Error(`BigBrain at ${serviceUrl} returned HTTP ${response.status}.`);
    let health;
    try {
      health = await response.json();
    } catch {
      throw new Error(`The service at ${serviceUrl} did not return a valid BigBrain health response.`);
    }
    if (health?.ok !== true || typeof health.brain_id !== 'string' || typeof health.brain_name !== 'string') {
      throw new Error(`The service at ${serviceUrl} did not identify itself as BigBrain.`);
    }
    return publicBrain(await this.registry.registerService({
      brainId: health.brain_id,
      name: health.brain_name,
      serviceUrl,
    }));
  }

  async installService(brain, { ownerSlug }) {
    const installer = path.join(this.appPath, 'scripts/install-local-mcp-service.mjs');
    const args = [installer, '--repo-root', this.appPath, '--brain-home', brain.home, '--port', String(brain.port), '--label', brain.serviceLabel,
      '--local-person-slug', ownerSlug, '--local-owner-email', brain.owner.email, '--local-owner-name', brain.owner.name, '--keychain-account', brain.id];
    if (brain.replacedService?.plistPath && brain.replacedService.label !== brain.serviceLabel) args.push('--replace-plist', brain.replacedService.plistPath);
    if (this.nodePath === process.execPath && process.versions.electron) args.push('--electron-run-as-node');
    await execFileAsync(this.nodePath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  }

  async activate(id) { return publicBrain(await this.registry.activate(id)); }
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
    const registry = await this.registry.load();
    const brain = registry.brains.find((item) => item.id === id);
    if (!brain) throw new Error(`Unknown brain: ${id}`);
    await execFileAsync('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${brain.serviceLabel}`]);
    return publicBrain(await this.registry.update(id, { status: 'running' }));
  }
  async setDefault(id) {
    const brain = await this.registry.activate(id);
    const pointer = path.join(process.env.HOME, '.config', 'bigbrain', 'default-brain-home');
    await fs.mkdir(path.dirname(pointer), { recursive: true });
    await fs.writeFile(pointer, `${brain.home}\n`);
    return publicBrain(brain);
  }
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
  if (input.mode && input.mode !== 'local') throw new Error('Run-on-device setup requires local mode.');
}
function publicBrain(brain) {
  if (brain.connectionType === 'service') {
    return { ...brain, dashboardUrl: `${brain.serviceUrl}/dashboard`, mcpUrl: `${brain.serviceUrl}/mcp` };
  }
  return { ...brain, dashboardUrl: `http://${brain.host}:${brain.port}/dashboard`, mcpUrl: `http://${brain.host}:${brain.port}/mcp` };
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
