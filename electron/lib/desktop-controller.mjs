import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrainRegistry } from './brain-registry.mjs';
import { MacKeychain, redactSecrets } from './keychain.mjs';
import { connectionInstructions } from './connection-instructions.mjs';
import { findBrainLaunchAgent } from './launch-agent-discovery.mjs';

const execFileAsync = promisify(execFile);

export class DesktopController {
  constructor({ registry = new BrainRegistry(), keychain = new MacKeychain(), appPath, nodePath = process.execPath } = {}) {
    this.registry = registry;
    this.keychain = keychain;
    this.appPath = appPath;
    this.nodePath = nodePath;
  }

  async state() {
    const registry = await this.registry.load();
    return { ...registry, brains: registry.brains.map(publicBrain) };
  }

  async validateApiKey(apiKey) {
    if (!apiKey?.startsWith('sk-')) throw new Error('Enter a valid OpenAI API key.');
    const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`OpenAI rejected this API key (HTTP ${response.status}).`);
    return true;
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
    const draft = existing
      ? await this.registry.registerExisting({ ...existing, ownerName: input.ownerName, ownerEmail: input.ownerEmail })
      : await this.registry.createDraft(input);
    try {
      await this.validateApiKey(input.apiKey);
      await this.keychain.set(draft.id, input.apiKey);
      const [{ initializeBrainHome }, { loadConfig }, { syncBrain }] = await Promise.all([
        import(pathToModule(this.appPath, 'src/bigbrain/config.js')),
        import(pathToModule(this.appPath, 'src/bigbrain/config.js')),
        import(pathToModule(this.appPath, 'src/bigbrain/sync.js')),
      ]);
      if (!existing) await initializeBrainHome(draft.home, { brainName: draft.name });
      const ownerSlug = `people/${slugify(input.ownerName)}`;
      await this.installService(draft, { ownerSlug });
      const config = await loadConfig({ brainHome: draft.home });
      await syncBrain({ config, env: { ...process.env, OPENAI_API_KEY: input.apiKey } }).catch(() => null);
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
    return connectionInstructions(brain);
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
function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'owner'; }
function validateInput(input) {
  if (!input?.ownerName?.trim() || !input?.ownerEmail?.includes('@')) throw new Error('Name and a valid email are required.');
  if (!input?.name?.trim()) throw new Error('Brain name is required.');
  if (input.mode && input.mode !== 'local') throw new Error('Only local brains are supported.');
}
function publicBrain(brain) {
  return { ...brain, dashboardUrl: `http://${brain.host}:${brain.port}/dashboard`, mcpUrl: `http://${brain.host}:${brain.port}/mcp` };
}
