import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { BrainRegistry, allocatePort } from '../../electron/lib/brain-registry.mjs';
import { connectionInstructions } from '../../electron/lib/connection-instructions.mjs';
import { DesktopController, normalizeServiceUrl } from '../../electron/lib/desktop-controller.mjs';
import { DisabledManagedInferenceClient, DisabledAuthProvider, DisabledEntitlementProvider, NoopUsageMeter } from '../../electron/lib/access-providers.mjs';
import { redactSecrets } from '../../electron/lib/keychain.mjs';

test('registry persists isolated brains and restores the active brain', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-registry-'));
  const registry = new BrainRegistry({ appSupport: root });
  const one = await registry.createDraft({ name: 'Research', ownerName: 'Ada', ownerEmail: 'ADA@example.com' });
  const two = await registry.createDraft({ name: 'Teaching', ownerName: 'Ada', ownerEmail: 'ada@example.com' });
  const three = await registry.createDraft({ name: 'Personal', ownerName: 'Ada', ownerEmail: 'ada@example.com' });
  assert.equal(new Set([one.id, two.id, three.id]).size, 3);
  assert.equal(new Set([one.port, two.port, three.port]).size, 3);
  assert.notEqual(one.home, two.home);
  await registry.activate(one.id);
  const reloaded = await new BrainRegistry({ appSupport: root }).load();
  assert.equal(reloaded.activeBrainId, one.id);
  assert.equal(reloaded.brains.length, 3);
  assert.equal(reloaded.brains[0].owner.email, 'ada@example.com');
});

test('port allocation skips reserved stable ports', async () => {
  const first = await allocatePort([], '127.0.0.1', 43880);
  const second = await allocatePort([first], '127.0.0.1', 43880);
  assert.equal(first, 43880);
  assert.equal(second, 43881);
});

test('registry registers an existing brain in place and rejects duplicates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-existing-registry-'));
  const existingHome = path.join(root, 'elsewhere', 'brain');
  const registry = new BrainRegistry({ appSupport: path.join(root, 'support') });
  const brain = await registry.registerExisting({ id: '11111111-1111-4111-8111-111111111111', name: 'Existing Brain', home: existingHome, ownerName: 'Ada', ownerEmail: 'ada@example.com' });
  assert.equal(brain.home, existingHome);
  assert.equal(brain.name, 'Existing Brain');
  await assert.rejects(() => registry.registerExisting({ id: brain.id, name: brain.name, home: existingHome, ownerName: 'Ada', ownerEmail: 'ada@example.com' }), /already registered/);
});

test('registry preserves an existing service port and replacement metadata', async () => {
  const appSupport = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-registry-existing-service-'));
  const registry = new BrainRegistry({ appSupport });
  const brain = await registry.registerExisting({
    id: '22222222-2222-4222-8222-222222222222', name: 'Migrated Brain', home: path.join(appSupport, 'elsewhere'),
    ownerName: 'Ada', ownerEmail: 'ada@example.com', port: 4545,
    replacedService: { label: 'local.bigbrain.mcp', plistPath: '/tmp/local.bigbrain.mcp.plist', port: 4545 },
  });
  assert.equal(brain.port, 4545);
  assert.equal(brain.serviceLabel, 'ai.diffusing.bigbrain.22222222-2222-4222-8222-222222222222');
  assert.equal(brain.replacedService.label, 'local.bigbrain.mcp');
  await fs.rm(appSupport, { recursive: true, force: true });
});

test('connection instructions are brain-specific and contain no credentials', () => {
  const result = connectionInstructions({ name: 'Lecture Brain', host: '127.0.0.1', port: 4123 });
  assert.equal(result.endpoint, 'http://127.0.0.1:4123/mcp');
  assert.match(result.codex, /lecture-brain/);
  assert.doesNotMatch(JSON.stringify(result), /api.?key|sk-/i);
});

test('desktop connects to and persists an existing BigBrain service', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-service-registry-'));
  const registry = new BrainRegistry({ appSupport: root });
  const requests = [];
  const controller = new DesktopController({
    registry,
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify({ ok: true, brain_id: 'brn_service', brain_name: 'Company Memory' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const brain = await controller.connectService({ serviceUrl: 'https://brain.example.test/dashboard/' });
  assert.deepEqual(requests, ['https://brain.example.test/health']);
  assert.equal(brain.name, 'Company Memory');
  assert.equal(brain.connectionType, 'service');
  assert.equal(brain.dashboardUrl, 'https://brain.example.test/dashboard');
  assert.equal(brain.mcpUrl, 'https://brain.example.test/mcp');

  const reloaded = await controller.state();
  assert.equal(reloaded.activeBrainId, brain.id);
  assert.equal(reloaded.brains[0].serviceUrl, 'https://brain.example.test');
  await assert.rejects(() => controller.connectService({ serviceUrl: 'https://brain.example.test/mcp' }), /already connected/);
  await fs.rm(root, { recursive: true, force: true });
});

test('desktop resolves canonical brain identity without treating it as a registry selector', async () => {
  const canonicalBrainId = 'brn_01234567-89ab-4cde-8fab-0123456789ab';
  const controller = new DesktopController({
    registry: {
      load: async () => ({
        brains: [{
          id: 'desktop-entry',
          name: 'Local Brain',
          host: '127.0.0.1',
          port: 55560,
          status: 'running',
        }],
      }),
    },
    fetchImpl: async (url) => {
      assert.equal(url, 'http://127.0.0.1:55560/health');
      return new Response(JSON.stringify({
        ok: true,
        brain_id: canonicalBrainId,
        brain_name: 'Local Brain',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const resolved = await controller.resolveCanonicalBrain(canonicalBrainId);
  assert.equal(resolved.id, 'desktop-entry');
  assert.equal(resolved.brainId, canonicalBrainId);
  assert.equal(resolved.dashboardUrl, 'http://127.0.0.1:55560/dashboard');
  await assert.rejects(
    () => controller.resolveCanonicalBrain('brn_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
    /Unknown canonical brain/,
  );
});

test('service address validation accepts service routes and rejects unsafe URL shapes', () => {
  assert.equal(normalizeServiceUrl('http://127.0.0.1:3333/mcp'), 'http://127.0.0.1:3333');
  assert.equal(normalizeServiceUrl('https://brain.example.test/connect/'), 'https://brain.example.test');
  assert.throws(() => normalizeServiceUrl('file:///tmp/brain'), /http or https/);
  assert.throws(() => normalizeServiceUrl('https://user:secret@brain.example.test'), /username or password/);
  assert.throws(() => normalizeServiceUrl('https://brain.example.test?token=secret'), /query parameters/);
});

test('desktop discovers only masked API-key descriptors from explicit BigBrain sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-api-key-discovery-'));
  const userEnvFile = path.join(root, '.env');
  await fs.writeFile(userEnvFile, "export OPENAI_API_KEY='sk-file-2222'\n");
  const registry = {
    load: async () => ({ brains: [
      { id: 'local-brain', name: '<Research & Notes>' },
      { id: 'remote-brain', name: 'Remote', connectionType: 'service' },
      { id: 'missing-brain', name: 'Missing key' },
    ] }),
  };
  const keychain = {
    get: async (id) => {
      if (id === 'local-brain') return 'sk-keychain-3333';
      throw new Error('Keychain lookup denied: sk-do-not-leak');
    },
  };
  const controller = new DesktopController({
    registry,
    keychain,
    env: { HOME: root, OPENAI_API_KEY: 'sk-environment-1111' },
    userEnvFile,
  });

  const options = await controller.availableApiKeys();
  assert.deepEqual(options, [
    { id: 'environment', label: 'OPENAI_API_KEY', detail: 'Available to the BigBrain app', masked: 'OpenAI key ending in 1111' },
    { id: 'bigbrain-env-file', label: 'BigBrain configuration', detail: '~/.config/bigbrain/.env', masked: 'OpenAI key ending in 2222' },
    { id: 'keychain:local-brain', label: '<Research & Notes>', detail: 'Stored in macOS Keychain', masked: 'OpenAI key ending in 3333' },
  ]);
  const serialized = JSON.stringify(options);
  assert.doesNotMatch(serialized, /sk-environment|sk-file|sk-keychain|sk-do-not-leak/);
  assert.doesNotMatch(serialized, /remote-brain/);
  await fs.rm(root, { recursive: true, force: true });
});

test('API-key discovery deduplicates secrets and selected sources are resolved again in the main process', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-api-key-resolution-'));
  const userEnvFile = path.join(root, '.env');
  await fs.writeFile(userEnvFile, 'OPENAI_API_KEY="sk-shared-4444"\n');
  const registry = { load: async () => ({ brains: [{ id: 'brain-one', name: 'One' }] }) };
  const keychain = { get: async () => 'sk-keychain-5555' };
  const controller = new DesktopController({
    registry,
    keychain,
    env: { HOME: root, OPENAI_API_KEY: 'sk-shared-4444' },
    userEnvFile,
  });

  assert.equal((await controller.availableApiKeys()).length, 2);
  assert.equal(await controller.resolveApiKey({ apiKeySource: 'environment' }), 'sk-shared-4444');
  assert.equal(await controller.resolveApiKey({ apiKeySource: 'keychain:brain-one' }), 'sk-keychain-5555');
  assert.equal(await controller.resolveApiKey({ apiKeySource: 'manual', apiKey: '  sk-manual-6666  ' }), 'sk-manual-6666');
  await assert.rejects(() => controller.resolveApiKey({ apiKeySource: 'keychain:tampered' }), /no longer available/);
  await assert.rejects(() => controller.resolveApiKey({ apiKeySource: 'unknown-source' }), /valid API key source/);
  await fs.rm(root, { recursive: true, force: true });
});

test('API-key validation uses the injected client without exposing the credential', async () => {
  const requests = [];
  const controller = new DesktopController({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response('{}', { status: 200 });
    },
  });
  await controller.validateApiKey('sk-validation-7777');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/models');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer sk-validation-7777');
});

test('desktop onboarding exposes two working action-led setup paths', async () => {
  const desktopSource = await fs.readFile(new URL('../../electron/desktop.js', import.meta.url), 'utf8');
  const desktopHtml = await fs.readFile(new URL('../../electron/desktop.html', import.meta.url), 'utf8');
  const preloadSource = await fs.readFile(new URL('../../electron/preload.cjs', import.meta.url), 'utf8');
  const mainSource = await fs.readFile(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
  assert.match(desktopSource, /Run BigBrain on this device/);
  assert.match(desktopSource, /Connect to an existing BigBrain/);
  assert.match(desktopSource, /api\.connectService/);
  assert.match(desktopSource, /api\.apiKeyOptions/);
  assert.match(desktopSource, /api\.discoverBrains/);
  assert.match(desktopSource, /Found on this Mac/);
  assert.match(desktopSource, /Enter a different API key/);
  assert.match(desktopSource, /escapeHtml\(option\.label\)/);
  assert.match(desktopSource, /role="radio"/);
  assert.match(desktopSource, /form\.apiKey='';showConnection/);
  assert.match(preloadSource, /desktop:connect-service/);
  assert.match(preloadSource, /desktop:api-key-options/);
  assert.match(preloadSource, /desktop:discover-brains/);
  assert.match(preloadSource, /desktop:open-brain/);
  assert.match(preloadSource, /process\.isMainFrame/);
  assert.match(preloadSource, /location\.pathname\.endsWith\('\/electron\/desktop\.html'\)/);
  assert.doesNotMatch(preloadSource, /require\(['"](?:path|url)['"]\)/);
  assert.match(mainSource, /connectedDashboardOrigins\.has\(parsed\.origin\)/);
  assert.match(mainSource, /mainWindow\.loadURL\(brain\.dashboardUrl\)/);
  assert.match(mainSource, /Choose or add brain/);
  assert.match(mainSource, /will-frame-navigate/);
  assert.match(mainSource, /desktop:api-key-options/);
  assert.match(mainSource, /desktop:discover-brains/);
  assert.match(desktopHtml, /--bg:#18181b/);
  assert.match(desktopHtml, /\.primary\{border:1px solid #fafafa;background:#fafafa;color:#18181b/);
  assert.doesNotMatch(desktopHtml, /#207146|#377652|#f4fff7|#f2f4ef/i);
  assert.doesNotMatch(desktopSource, /Hosted mode|Choose a mode|<strong>Local<\/strong>|cannot save service connections/);
});

test('sandbox-compatible preload executes and exposes the desktop bridge only to the local main frame', async () => {
  const source = await fs.readFile(new URL('../../electron/preload.cjs', import.meta.url), 'utf8');
  const exposed = new Map();
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => exposed.set(name, value) },
    ipcRenderer: { invoke: () => {}, on: () => {}, removeListener: () => {} },
  };
  const run = (processValue, location) => vm.runInNewContext(source, {
    process: processValue,
    location,
    require: (specifier) => {
      if (specifier === 'electron') return electron;
      throw new Error(`Unsupported sandbox import: ${specifier}`);
    },
  });

  run({ isMainFrame: true }, { protocol: 'file:', pathname: '/Applications/BigBrain.app/Contents/Resources/app.asar/electron/desktop.html' });
  const bridge = exposed.get('bigbrainDesktop');
  assert.equal(typeof bridge?.state, 'function');
  assert.equal(typeof bridge?.discoverBrains, 'function');
  assert.equal(typeof bridge?.apiKeyOptions, 'function');

  exposed.clear();
  run({ isMainFrame: false }, { protocol: 'file:', pathname: '/Applications/BigBrain.app/Contents/Resources/app.asar/electron/desktop.html' });
  run({ isMainFrame: true }, { protocol: 'https:', pathname: '/electron/desktop.html' });
  assert.equal(exposed.size, 0);
});

test('secret redaction protects errors and future provider contracts fail closed', async () => {
  assert.equal(redactSecrets('bad sk-abcdefghijklmnopqrstuvwxyz token'), 'bad [REDACTED] token');
  await assert.rejects(() => new DisabledManagedInferenceClient().request(), /not available/);
  assert.deepEqual(await new DisabledAuthProvider().authenticate(), { state: 'not_required' });
  assert.deepEqual(await new DisabledEntitlementProvider().status(), { state: 'bring_your_own_key' });
  assert.deepEqual(await new NoopUsageMeter().record(), { recorded: false });
});
