import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { applyUpdate, checkForUpdate, updateExitCode } from '../../src/bigbrain/update.js';

const execFileAsync = promisify(execFile);

test('stable ignores prereleases while beta selects the newest prerelease', async () => {
  const fixture = await createReleaseFixture();
  try {
    await release(fixture.publisher, '1.1.0', 'v1.1.0');
    await release(fixture.publisher, '1.2.0-beta.1', 'v1.2.0-beta.1');
    await git(fixture.checkout, 'fetch', '--tags', 'origin');

    const stable = await checkForUpdate({ repoRoot: fixture.checkout, channel: 'stable' });
    const beta = await checkForUpdate({ repoRoot: fixture.checkout, channel: 'beta' });

    assert.equal(stable.status, 'update_available');
    assert.equal(stable.available_version, '1.1.0');
    assert.equal(beta.status, 'update_available');
    assert.equal(beta.available_version, '1.2.0-beta.1');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('apply fast-forwards a clean source checkout to the selected release', async () => {
  const fixture = await createReleaseFixture();
  try {
    await release(fixture.publisher, '1.1.0', 'v1.1.0');
    const report = await applyUpdate({ repoRoot: fixture.checkout, postUpdate: false });

    assert.equal(report.status, 'updated');
    assert.equal(report.ok, true);
    assert.equal(report.available_version, '1.1.0');
    assert.equal(JSON.parse(await fs.readFile(path.join(fixture.checkout, 'package.json'), 'utf8')).version, '1.1.0');
    assert.equal(updateExitCode(report), 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('apply safely blocks dirty worktrees', async () => {
  const fixture = await createReleaseFixture();
  try {
    await release(fixture.publisher, '1.1.0', 'v1.1.0');
    await fs.writeFile(path.join(fixture.checkout, 'local-notes.txt'), 'keep me\n');
    const report = await applyUpdate({ repoRoot: fixture.checkout, postUpdate: false });

    assert.equal(report.status, 'blocked');
    assert.equal(report.reason, 'dirty_worktree');
    assert.equal(updateExitCode(report), 2);
    assert.equal(await fs.readFile(path.join(fixture.checkout, 'local-notes.txt'), 'utf8'), 'keep me\n');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('apply requires explicit approval for a major release', async () => {
  const fixture = await createReleaseFixture();
  try {
    await release(fixture.publisher, '2.0.0', 'v2.0.0');
    const blocked = await applyUpdate({ repoRoot: fixture.checkout, postUpdate: false });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.reason, 'major_update_requires_approval');

    const applied = await applyUpdate({ repoRoot: fixture.checkout, postUpdate: false, allowMajor: true });
    assert.equal(applied.status, 'updated');
    assert.equal(applied.available_version, '2.0.0');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

async function createReleaseFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-update-'));
  const remote = path.join(root, 'remote.git');
  const publisher = path.join(root, 'publisher');
  const checkout = path.join(root, 'checkout');
  await execFileAsync('git', ['init', '--bare', remote]);
  await execFileAsync('git', ['init', '-b', 'main', publisher]);
  await git(publisher, 'config', 'user.email', 'updates@example.test');
  await git(publisher, 'config', 'user.name', 'BigBrain Updates Test');
  await fs.writeFile(path.join(publisher, 'package.json'), `${JSON.stringify({ name: 'bigbrain-test', version: '1.0.0' }, null, 2)}\n`);
  await fs.mkdir(path.join(publisher, 'bin'));
  await fs.writeFile(path.join(publisher, 'bin/bigbrain.js'), '#!/usr/bin/env node\n');
  await git(publisher, 'add', '.');
  await git(publisher, 'commit', '-m', 'release 1.0.0');
  await git(publisher, 'tag', 'v1.0.0');
  await git(publisher, 'remote', 'add', 'origin', remote);
  await git(publisher, 'push', '-u', 'origin', 'main', '--tags');
  await execFileAsync('git', ['clone', '--branch', 'main', remote, checkout]);
  await git(checkout, 'reset', '--hard', 'v1.0.0');
  return { root, remote, publisher, checkout };
}

async function release(repo, version, tag) {
  await fs.writeFile(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'bigbrain-test', version }, null, 2)}\n`);
  await git(repo, 'add', 'package.json');
  await git(repo, 'commit', '-m', `release ${version}`);
  await git(repo, 'tag', tag);
  await git(repo, 'push', 'origin', 'main', '--tags');
}

async function git(cwd, ...args) {
  return execFileAsync('git', args, { cwd });
}
