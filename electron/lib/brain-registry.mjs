import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const REGISTRY_VERSION = 1;
export const DEFAULT_PORT_START = 3333;

export function defaultAppSupport(home = os.homedir()) {
  return path.join(home, 'Library', 'Application Support', 'BigBrain');
}

export class BrainRegistry {
  constructor({ appSupport = defaultAppSupport(), host = '127.0.0.1' } = {}) {
    this.appSupport = appSupport;
    this.registryPath = path.join(appSupport, 'registry.json');
    this.host = host;
  }

  async load() {
    try {
      const value = JSON.parse(await fs.readFile(this.registryPath, 'utf8'));
      return normalizeRegistry(value);
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyRegistry();
      throw error;
    }
  }

  async save(registry) {
    const value = normalizeRegistry(registry);
    await fs.mkdir(this.appSupport, { recursive: true });
    const temporary = `${this.registryPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.registryPath);
    return value;
  }

  async createDraft({ name, ownerName, ownerEmail }) {
    const registry = await this.load();
    const id = crypto.randomUUID();
    const port = await allocatePort(registry.brains.map((brain) => brain.port), this.host);
    const brain = {
      id,
      name: String(name).trim(),
      home: path.join(this.appSupport, 'brains', id),
      port,
      host: this.host,
      serviceLabel: `ai.diffusing.bigbrain.${id}`,
      status: 'setup',
      owner: { name: String(ownerName).trim(), email: String(ownerEmail).trim().toLowerCase() },
      aiAccess: { type: 'bring_your_own_key', provider: 'openai' },
      onboarding: { step: 4, completed: false, error: null },
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    registry.brains.push(brain);
    registry.activeBrainId = id;
    await this.save(registry);
    return brain;
  }

  async update(id, updates) {
    const registry = await this.load();
    const index = registry.brains.findIndex((brain) => brain.id === id);
    if (index < 0) throw new Error(`Unknown brain: ${id}`);
    registry.brains[index] = { ...registry.brains[index], ...updates, id };
    await this.save(registry);
    return registry.brains[index];
  }

  async activate(id) {
    const registry = await this.load();
    const brain = registry.brains.find((candidate) => candidate.id === id);
    if (!brain) throw new Error(`Unknown brain: ${id}`);
    brain.lastOpenedAt = new Date().toISOString();
    registry.activeBrainId = id;
    await this.save(registry);
    return brain;
  }
}

export function emptyRegistry() {
  return { version: REGISTRY_VERSION, activeBrainId: null, brains: [] };
}

function normalizeRegistry(value) {
  if (!value || typeof value !== 'object') throw new Error('BigBrain registry must be an object.');
  return {
    version: REGISTRY_VERSION,
    activeBrainId: typeof value.activeBrainId === 'string' ? value.activeBrainId : null,
    brains: Array.isArray(value.brains) ? value.brains.filter((brain) => brain && typeof brain.id === 'string') : [],
  };
}

export async function allocatePort(reserved = [], host = '127.0.0.1', start = DEFAULT_PORT_START) {
  const used = new Set(reserved.map(Number));
  for (let port = start; port < start + 1000; port += 1) {
    if (!used.has(port) && await canListen(port, host)) return port;
  }
  throw new Error('No free local BigBrain port is available.');
}

export function canListen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}
