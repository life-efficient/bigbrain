import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  getLinkHistory,
  getRelatedLinkHistory,
  normalizeHistoryPagePath,
  parseRelatedLinkHistory,
  parseLinkHistory,
} from '../../src/bigbrain/link-history.js';

const execFileAsync = promisify(execFile);

test('Git link history reports introduced and removed page links in chronological order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-link-history-'));
  try {
    await git(root, 'init', '-b', 'main');
    await git(root, 'config', 'user.email', 'test@example.com');
    await git(root, 'config', 'user.name', 'BigBrain Test');
    await writePage(root, 'projects/source.md', '# Source\n');
    await commit(root, 'Create source page', '2026-08-01T10:00:00+00:00');

    await writePage(root, 'projects/source.md', '# Source\n\n- [Alice](../people/alice.md)\n- [[projects/relay]]\n- [Attachment](../projects/source.pdf)\n- [External](https://example.com/page.md)\n');
    await commit(root, 'Add source links', '2026-08-02T10:00:00+00:00');

    await writePage(root, 'projects/source.md', '# Source\n\n- [Acme](../organizations/acme.md)\n- [[projects/relay]]\n');
    await commit(root, 'Retarget source link', '2026-08-03T10:00:00+00:00');
    await writePage(root, 'people/alice.md', '# Alice\n');
    await commit(root, 'Add unrelated page', '2026-08-04T10:00:00+00:00');

    assert.deepEqual(await getLinkHistory({ repoRoot: root, pagePath: 'projects/source.md' }), [
      {
        type: 'link-introduced',
        commit_sha: await shaFor(root, 'Add source links'),
        timestamp: '2026-08-02T10:00:00Z',
        subject: 'Add source links',
        from_page: 'projects/source',
        to_page: 'people/alice',
      },
      {
        type: 'link-introduced',
        commit_sha: await shaFor(root, 'Add source links'),
        timestamp: '2026-08-02T10:00:00Z',
        subject: 'Add source links',
        from_page: 'projects/source',
        to_page: 'projects/relay',
      },
      {
        type: 'link-removed',
        commit_sha: await shaFor(root, 'Retarget source link'),
        timestamp: '2026-08-03T10:00:00Z',
        subject: 'Retarget source link',
        from_page: 'projects/source',
        to_page: 'people/alice',
      },
      {
        type: 'link-introduced',
        commit_sha: await shaFor(root, 'Retarget source link'),
        timestamp: '2026-08-03T10:00:00Z',
        subject: 'Retarget source link',
        from_page: 'projects/source',
        to_page: 'organizations/acme',
      },
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('link history is bounded and keeps Git access dependency-free through an injectable runner', async () => {
  const calls = [];
  const output = [
    '\x1eabc123\x1f2026-08-01T00:00:00+00:00\x1fAdd one link',
    '',
    'diff --git a/people/alice.md b/people/alice.md',
    '@@ -1,0 +1 @@',
    '+See [Project](../projects/relay.md).',
  ].join('\n');
  const events = await getLinkHistory({
    repoRoot: '/repo',
    pagePath: 'people/alice',
    limit: 9999,
    commitLimit: 9999,
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: output };
    },
  });

  assert.deepEqual(events, [{
    type: 'link-introduced',
    commit_sha: 'abc123',
    timestamp: '2026-08-01T00:00:00+00:00',
    subject: 'Add one link',
    from_page: 'people/alice',
    to_page: 'projects/relay',
  }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git');
  assert.ok(calls[0].args.includes('--max-count=500'));
  assert.ok(calls[0].args.includes('--'));
  assert.equal(calls[0].args.at(-1), 'people/alice.md');
  assert.equal(calls[0].options.maxBuffer, 8 * 1024 * 1024);
});

test('link history parser deduplicates one edge repeated in a commit and rejects invalid page paths', () => {
  const output = '\x1eabc\x1f2026-08-01T00:00:00Z\x1fRepeated link\n'
    + '@@ -1,0 +1,2 @@\n'
    + '+[Relay](../projects/relay.md)\n'
    + '+[Relay again](../projects/relay.md)\n';
  assert.deepEqual(parseLinkHistory(output, { pagePath: 'people/alice.md' }), [{
    type: 'link-introduced',
    commit_sha: 'abc',
    timestamp: '2026-08-01T00:00:00Z',
    subject: 'Repeated link',
    from_page: 'people/alice',
    to_page: 'projects/relay',
  }]);
  for (const invalid of ['', '../people/alice.md', 'people/../alice.md', 'people/alice.txt', 'people\\alice.md']) {
    assert.throws(() => normalizeHistoryPagePath(invalid), /Markdown page path/);
  }
});

test('related link history finds incoming and outgoing merge edges for a selected page', () => {
  const output = '\x1eabc\x1f2026-08-01T00:00:00Z\x1fConnect chains\n'
    + 'diff --git a/people/friend.md b/people/friend.md\n'
    + '@@ -1,0 +1 @@\n'
    + '+Meet [Mentor](../people/mentor.md)\n'
    + 'diff --git a/projects/deal.md b/projects/deal.md\n'
    + '@@ -1,0 +1 @@\n'
    + '+See [[people/mentor]]\n';
  assert.deepEqual(parseRelatedLinkHistory(output, { pageSlug: 'people/mentor' }), [
    {
      type: 'link-introduced',
      commit_sha: 'abc',
      timestamp: '2026-08-01T00:00:00Z',
      subject: 'Connect chains',
      from_page: 'people/friend',
      to_page: 'people/mentor',
    },
    {
      type: 'link-introduced',
      commit_sha: 'abc',
      timestamp: '2026-08-01T00:00:00Z',
      subject: 'Connect chains',
      from_page: 'projects/deal',
      to_page: 'people/mentor',
    },
  ]);
});

async function writePage(root, relativePath, contents) {
  const fullPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, contents, 'utf8');
}

async function commit(root, subject, date) {
  await git(root, 'add', '.');
  await execFileAsync('git', ['commit', '-m', subject], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

async function shaFor(root, subject) {
  return (await git(root, 'log', '-1', '--format=%H', '--grep', subject)).trim();
}

async function git(cwd, ...args) {
  return (await execFileAsync('git', args, { cwd })).stdout;
}
