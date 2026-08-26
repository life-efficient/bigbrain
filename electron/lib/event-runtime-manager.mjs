import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { EventInboxStore, EventRegistryStore, createEmptyEventRegistry, normalizeEventRegistry, normalizeListener, normalizeSubscription, defaultEventInboxPath, defaultEventRegistryPath } from '../../src/bigbrain/inbound-events.js';

export class EventRuntimeManager {
  constructor({ appPath = process.cwd(), registryPath = defaultEventRegistryPath(), inboxPath = defaultEventInboxPath(), configPath = null, runnerPath = null, spawnImpl = spawn, env = process.env, logger = console } = {}) {
    this.appPath = appPath;
    this.registryPath = path.resolve(registryPath);
    this.inboxPath = path.resolve(inboxPath);
    this.configPath = path.resolve(configPath || path.join(path.dirname(this.registryPath), 'event-ingestor.json'));
    this.runnerPath = runnerPath || path.join(appPath, 'scripts', 'bigbrain-event-ingestor.mjs');
    this.spawnImpl = spawnImpl;
    this.env = env;
    this.logger = logger;
    this.registry = new EventRegistryStore({ filePath: this.registryPath });
    this.inbox = new EventInboxStore({ filePath: this.inboxPath });
    this.child = null;
    this.started = false;
  }

  async state() {
    const registry = await this.registry.get();
    const inbox = await this.inbox.get();
    const counts = Object.values(inbox.deliveries).reduce((value, event) => { value[event.state] = (value[event.state] || 0) + 1; return value; }, {});
    return { ok: true, running: Boolean(this.child), registry_revision: registry.revision, runtime: registry.runtime, listeners: registry.listeners.map(safeListener), counts, collectors: inbox.collectors, registry_path: this.registryPath, inbox_path: this.inboxPath };
  }

  async ensureBrain(brain) {
    if (!brain?.id) return this.state();
    const brainId = brain.brainId || brain.id;
    const registry = await this.registry.get();
    const mcpUrl = brain.mcpUrl || (brain.port ? `http://${brain.host || '127.0.0.1'}:${brain.port}/mcp` : null);
    const kind = brain.connectionType === 'service' || brain.kind === 'remote' ? 'remote_mcp' : 'local_runtime';
    const existing = registry.brains?.find((candidate) => candidate.id === brainId);
    const brains = [...(registry.brains || []).filter((candidate) => candidate.id !== brainId), { id: brainId, name: brain.name || brainId, mcp_url: mcpUrl, credential_ref: brain.credential_ref || existing?.credential_ref || null, kind }];
    const listeners = registry.listeners.length ? registry.listeners : [defaultOpenAiListener(brainId)];
    const next = await this.registry.save({ ...registry, brains, listeners: listeners.map((listener) => listener.id === 'openai-news' && !listener.brain_ids?.length ? { ...listener, brain_ids: [brainId] } : listener) }, { audit: { action: 'brain_registered', brain_id: brainId } });
    await this.writeRuntimeConfig();
    return { ...next, brain_id: brainId };
  }

  async start({ brains = [] } = {}) {
    const existingConfig = await readJsonFile(this.configPath);
    if (existingConfig?.version < 2) {
      this.logger.info?.('BigBrain is leaving the legacy event ingestor in control until it is migrated with install-event-ingestor.');
      return this.state();
    }
    for (const brain of brains) await this.ensureBrain(brain);
    const runtimeConfig = await readJsonFile(this.configPath);
    if (runtimeConfig?.managed_by === 'launchd') return this.state();
    const exists = await fs.access(this.registryPath).then(() => true).catch(() => false);
    if (!exists || this.child) return this.state();
    await this.writeRuntimeConfig();
    const nodePath = await resolveNodePath(this.env);
    this.child = this.spawnImpl(nodePath, [this.runnerPath, '--config', this.configPath], { cwd: this.appPath, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout?.on('data', (chunk) => this.logger.info?.(`BigBrain inbound events: ${String(chunk).trim()}`));
    this.child.stderr?.on('data', (chunk) => this.logger.error?.(`BigBrain inbound events: ${String(chunk).trim()}`));
    this.child.once('exit', (code) => { if (this.child) this.logger.info?.(`BigBrain inbound event runtime stopped (${code ?? 'signal'}).`); this.child = null; });
    this.started = true;
    return this.state();
  }

  async stop() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.kill?.('SIGTERM');
    await new Promise((resolve) => { const timer = setTimeout(resolve, 2000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }

  async upsertListener(value) {
    const listener = normalizeListener(value.listener || value);
    const next = await this.registry.update((registry) => {
      const index = registry.listeners.findIndex((item) => item.id === listener.id);
      const listeners = [...registry.listeners];
      listeners[index < 0 ? listeners.length : index] = { ...(index < 0 ? {} : listeners[index]), ...listener };
      return { ...registry, listeners };
    }, { audit: { action: 'listener_upsert', listener_id: listener.id } });
    await this.reconcile();
    return safeListener(next.listeners.find((item) => item.id === listener.id));
  }

  async updateSubscription(value) {
    const subscription = normalizeSubscription(value.subscription || value);
    const next = await this.registry.update((registry) => {
      if (!registry.listeners.some((listener) => listener.id === subscription.listener_id)) throw new Error(`Listener not found: ${subscription.listener_id}`);
      const index = registry.subscriptions.findIndex((item) => item.id === subscription.id);
      const subscriptions = [...registry.subscriptions];
      subscriptions[index < 0 ? subscriptions.length : index] = { ...(index < 0 ? {} : subscriptions[index]), ...subscription };
      return { ...registry, subscriptions };
    }, { audit: { action: 'subscription_upsert', subscription_id: subscription.id } });
    await this.reconcile();
    return next.subscriptions.find((item) => item.id === subscription.id);
  }

  async setListenerState(listenerId, action) {
    const next = await this.registry.update((registry) => {
      const listeners = registry.listeners.map((listener) => listener.id === listenerId ? {
        ...listener,
        paused: action === 'pause',
        removed: action === 'remove',
        enabled: action === 'resume',
        status: action === 'pause' ? 'paused' : action === 'remove' ? 'removed' : 'active',
      } : listener);
      if (!listeners.some((listener) => listener.id === listenerId)) throw new Error(`Listener not found: ${listenerId}`);
      return { ...registry, listeners };
    }, { audit: { action: `listener_${action}`, listener_id: listenerId } });
    await this.reconcile();
    return safeListener(next.listeners.find((listener) => listener.id === listenerId));
  }

  async inboxList(options = {}) { return this.inbox.list(options); }
  async retry(deliveryId) { return this.inbox.retry(deliveryId); }
  async discard(deliveryId, reason) { return this.inbox.discard(deliveryId, reason); }
  async quarantine(deliveryId, reason) { return this.inbox.quarantine(deliveryId, reason); }

  async reconcile() {
    await this.writeRuntimeConfig();
    if (this.child) return this.state();
    return this.start();
  }

  async writeRuntimeConfig() {
    const existing = await readJsonFile(this.configPath);
    if (existing?.managed_by === 'launchd') return existing;
    const config = { version: 2, managed_by: 'desktop', registry_path: this.registryPath, inbox_path: this.inboxPath, webhook: { host: '127.0.0.1', port: 55561, enabled: true } };
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

export function defaultOpenAiListener(brainId) {
  return { id: 'openai-news', type: 'rss', scope: 'organization', url: 'https://openai.com/news/rss.xml', display_name: 'OpenAI News', icon: 'Rss', description: 'Capture useful OpenAI announcements and model release notes. Ignore security updates unless they materially affect current work.', listener_location: 'client', codex_execution_location: 'client', codex_execution_mode: 'app_thread', brain_ids: [brainId], capture_policy: { default_mode: 'full', retain_raw: false }, bootstrap: 'latest' };
}

function safeListener(listener) {
  const { credential_ref, ...safe } = listener || {};
  return { ...safe, credential_configured: Boolean(credential_ref) };
}

async function readJsonFile(filePath) {
  return fs.readFile(filePath, 'utf8').then((raw) => JSON.parse(raw)).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
}

async function resolveNodePath(env) {
  const candidates = [env.BIGBRAIN_NODE_PATH, env.NODE_BINARY, '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', process.execPath].filter(Boolean);
  for (const candidate of candidates) if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
  return 'node';
}
