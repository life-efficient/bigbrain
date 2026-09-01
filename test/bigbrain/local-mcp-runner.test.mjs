import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalMcpRunner } from '../../electron/lib/local-mcp-runner.mjs';

test('LocalMcpRunner invokes the packaged CLI installer with desktop ownership markers', async () => {
  const calls = [];
  const runner = new LocalMcpRunner({
    appPath: '/Applications/BigBrain.app/Contents/Resources/app',
    nodePath: '/usr/local/bin/node',
    env: { PATH: '/usr/bin' },
    electronRuntime: false,
    fsImpl: { access: async () => {} },
    execFileImpl: async (...args) => {
      calls.push(args);
      return { stdout: '{"ok":true}' };
    },
  });

  const result = await runner.provision({
    id: 'brain-entry',
    name: 'Personal Brain',
    home: '/Users/harry/brain',
    port: 55560,
    serviceLabel: 'ai.diffusing.bigbrain.brain-entry',
    owner: { name: 'Harry', email: 'harry@example.com' },
    replacedService: { label: 'local.bigbrain.mcp', plistPath: '/tmp/local.bigbrain.mcp.plist' },
  }, { ownerSlug: 'people/harry', gitBackup: false });

  assert.equal(result, '{"ok":true}');
  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, '/usr/local/bin/node');
  assert.deepEqual(args, [
    '/Applications/BigBrain.app/Contents/Resources/app/scripts/install-local-mcp-service.mjs',
    '--repo-root', '/Applications/BigBrain.app/Contents/Resources/app',
    '--brain-home', '/Users/harry/brain',
    '--port', '55560',
    '--label', 'ai.diffusing.bigbrain.brain-entry',
    '--local-person-slug', 'people/harry',
    '--local-owner-email', 'harry@example.com',
    '--local-owner-name', 'Harry',
    '--keychain-account', 'brain-entry',
    '--service-manager', 'desktop',
    '--service-source', 'desktop-bundle',
    '--no-git-backup',
    '--replace-plist', '/tmp/local.bigbrain.mcp.plist',
  ]);
  assert.equal(options.env.PATH, '/usr/bin');
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
});

test('LocalMcpRunner reports a recoverable missing installer error', async () => {
  const runner = new LocalMcpRunner({
    appPath: '/tmp/missing-bigbrain-app',
    fsImpl: { access: async (installer) => { throw new Error(`${installer}: ENOENT`); } },
  });
  await assert.rejects(
    () => runner.provision({ name: 'Personal Brain', home: '/tmp/brain', port: 55560 }),
    /missing its local service installer.*Update or reinstall BigBrain/,
  );
});

test('LocalMcpRunner restarts only the requested local service', async () => {
  const calls = [];
  const runner = new LocalMcpRunner({
    execFileImpl: async (...args) => { calls.push(args); },
  });
  await runner.restart({ serviceLabel: 'ai.diffusing.bigbrain.personal' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'launchctl');
  assert.deepEqual(calls[0][1].slice(0, 2), ['kickstart', '-k']);
  assert.match(calls[0][1][2], /\/ai\.diffusing\.bigbrain\.personal$/);
});
