import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import {
  ensureLocalOwnerMember,
  findActiveMemberByPersonSlug,
  resolveActorMember,
  upsertMember,
} from '../../src/bigbrain/members.js';
import { DEFAULT_POINTER_PATH } from '../../src/bigbrain/constants.js';

const execFileAsync = promisify(execFile);

test('ensureLocalOwnerMember creates an active owner for local assignee me resolution', async () => {
  const fixture = await createFixture('bigbrain-local-owner-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    const member = await ensureLocalOwnerMember(db, { personSlug: 'people/local-user' });

    assert.equal(member.person_slug, 'people/local-user');
    assert.equal(member.email, 'local-user@local.bigbrain');
    assert.equal(member.role, 'owner');
    assert.equal(member.status, 'active');

    const resolved = await resolveActorMember(db, null, {
      authMode: 'none',
      localPersonSlug: 'people/local-user',
    });
    assert.equal(resolved.person_slug, 'people/local-user');
    await db.close?.();
  } finally {
    await removeTempFixture(fixture.rootDir);
  }
});

test('configured member resolves assignee me for token-auth hosted brains', async () => {
  const fixture = await createFixture('bigbrain-token-owner-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    await upsertMember(db, {
      email: 'owner@example.test',
      name: 'Token Owner',
      person_slug: 'people/token-owner',
      role: 'owner',
      status: 'active',
    });

    const resolved = await resolveActorMember(db, null, {
      authMode: 'token',
      localPersonSlug: 'people/token-owner',
    });
    assert.equal(resolved.person_slug, 'people/token-owner');
    await db.close?.();
  } finally {
    await removeTempFixture(fixture.rootDir);
  }
});

test('ensureLocalOwnerMember repairs an existing inactive local member by person slug', async () => {
  const fixture = await createFixture('bigbrain-local-owner-repair-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    await upsertMember(db, {
      email: 'existing@example.test',
      name: 'Existing Local',
      person_slug: 'people/existing-local',
      role: 'member',
      status: 'inactive',
    });

    const member = await ensureLocalOwnerMember(db, {
      personSlug: 'people/existing-local',
      email: 'ignored@example.test',
      name: 'Updated Local',
    });

    assert.equal(member.email, 'existing@example.test');
    assert.equal(member.name, 'Updated Local');
    assert.equal(member.role, 'owner');
    assert.equal(member.status, 'active');
    assert.equal(member.person_slug, 'people/existing-local');
    await db.close?.();
  } finally {
    await removeTempFixture(fixture.rootDir);
  }
});

test('members ensure-local-owner CLI bootstraps a local owner row', async () => {
  const fixture = await createFixture('bigbrain-local-owner-cli-');
  try {
    const binPath = path.resolve('bin/bigbrain.js');
    const { stdout } = await execFileAsync(process.execPath, [
      binPath,
      '--config',
      fixture.configPath,
      '--json',
      'members',
      'ensure-local-owner',
      'people/cli-local',
      '--name',
      'CLI Local',
      '--email',
      'cli-local@example.test',
    ]);
    const result = JSON.parse(stdout);
    assert.equal(result.person_slug, 'people/cli-local');
    assert.equal(result.email, 'cli-local@example.test');
    assert.equal(result.role, 'owner');

    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    const member = await findActiveMemberByPersonSlug(db, 'people/cli-local');
    assert.equal(member.name, 'CLI Local');
    await db.close?.();
  } finally {
    await removeTempFixture(fixture.rootDir);
  }
});

test('local MCP installer dry-run reports local owner bootstrapping intent', async () => {
  const fixture = await createFixture('bigbrain-local-owner-installer-');
  try {
    const installerPath = path.resolve('scripts/install-local-mcp-service.mjs');
    const { stdout } = await execFileAsync(process.execPath, [
      installerPath,
      '--repo-root',
      process.cwd(),
      '--brain-home',
      fixture.brainHome,
      '--local-person-slug',
      'people/installer-local',
      '--local-owner-name',
      'Installer Local',
      '--local-owner-email',
      'installer-local@example.test',
      '--dry-run',
    ], { env: fixture.env });
    const result = JSON.parse(stdout);
    assert.equal(result.localPersonSlug, 'people/installer-local');
    assert.equal(result.localOwnerName, 'Installer Local');
    assert.equal(result.localOwnerEmail, 'installer-local@example.test');
    assert.equal(result.wouldEnsureLocalOwner, true);
  } finally {
    await removeTempFixture(fixture.rootDir);
  }
});

test('local identity fixtures do not rewrite the real default brain pointer', async () => {
  const before = await readIfExists(DEFAULT_POINTER_PATH);
  const fixture = await createFixture('bigbrain-local-owner-pointer-isolation-');
  try {
    assert.equal(await readIfExists(DEFAULT_POINTER_PATH), before);
    assert.equal((await fs.readFile(fixture.pointerPath, 'utf8')).trim(), fixture.brainHome);
  } finally {
    await removeTempFixture(fixture.rootDir);
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const brainHome = path.join(rootDir, 'brain');
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const env = {
    ...process.env,
    BIGBRAIN_POINTER_PATH: pointerPath,
    BIGBRAIN_STATE_ROOT: stateRoot,
  };
  const init = await initializeBrainHome(brainHome, { env });
  return { rootDir, brainHome, configPath: init.configPath, pointerPath, stateRoot, env };
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function removeTempFixture(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTmp = path.resolve(os.tmpdir());
  const relative = path.relative(resolvedTmp, resolvedRoot);
  assert.notEqual(relative, '');
  assert.equal(relative.startsWith('..'), false);
  assert.equal(path.isAbsolute(relative), false);
  await fs.rm(resolvedRoot, { recursive: true, force: true });
}
