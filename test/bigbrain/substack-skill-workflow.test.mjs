import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('Substack modes, email dispatcher, and generic source worker share one preflight contract', async () => {
  const substack = await read('skills/bigbrain-substack-ingest/SKILL.md');
  const email = await read('skills/bigbrain-manage-email/SKILL.md');
  const article = await read('skills/bigbrain-source-article-ingest/SKILL.md');
  const reference = await read('skills/bigbrain-substack-ingest/references/shared-ledger.md');
  const daily = await read('automations/daily-bigbrain-substack-reconcile/automation.toml');
  const emailSchedule = await read('automations/bigbrain-email-ingest-daily/automation.toml');
  for (const name of ['bigbrain-substack-ingest', 'bigbrain-manage-email', 'bigbrain-source-article-ingest']) {
    const skill = await read(`skills/${name}/SKILL.md`);
    const frontmatter = yaml.load(skill.match(/^---\n([\s\S]*?)\n---/)[1]);
    assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name']);
    assert.equal(frontmatter.name, name);
    assert.ok(frontmatter.description.length > 0 && frontmatter.description.length <= 1024);
    const metadata = yaml.load(await read(`skills/${name}/agents/openai.yaml`));
    assert.ok(metadata.interface.default_prompt.includes(`$${name}`));
  }
  assert.match(substack, /before fetching article content/);
  assert.match(substack, /same owning Brain/);
  assert.match(substack, /Another legitimate transport for the same canonical source is allowed/);
  assert.match(substack, /five unresolved posts/);
  assert.match(substack, /oldest retryable hole/);
  assert.match(substack, /at least weekly/);
  assert.match(substack, /Do not mark inventory complete until the list's end is observed/);
  assert.match(substack, /`events\/listener_upsert`/);
  assert.match(substack, /`skill: bigbrain-substack-ingest`/);
  assert.match(substack, /never pause, remove, or unsubscribe/);
  assert.match(substack, /daily no-op exits quietly/);
  assert.doesNotMatch(substack, /Use the active automation's `memory.md`/);
  assert.match(email, /skip duplicate fetching and writing/);
  assert.match(email, /live competing claim is deferred/);
  assert.match(article, /substack_context: \{ledger_preflight_complete: true, claimed: true\}/);
  assert.match(article, /prevents recursion/);
  assert.match(reference, /nextOffset/);
  assert.match(reference, /`renew`/);
  assert.match(reference, /paths: \[\]/);
  assert.match(daily, /Run \$bigbrain-substack-ingest in daily reconciliation mode/);
  assert.match(daily, /Exit quietly when nothing actionable changes/);
  assert.match(emailSchedule, /shared persistent post ledger before article retrieval/);
});

test('documented command protocol makes RSS completion reusable by email and browser while preserving older holes', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'substack-skill-flow-'));
  const db = path.join(temporary, 'ledger.sqlite');
  const inputFile = path.join(temporary, 'input.json');
  const command = async (operation, input = {}) => {
    await fs.writeFile(inputFile, JSON.stringify(input));
    const { stdout } = await execFileAsync(process.execPath, [path.join(root, 'bin/bigbrain-substack-ledger.js'), operation, '--input-file', inputFile, '--db', db]);
    return JSON.parse(stdout);
  };
  const publicationUrl = 'https://workflowtest.substack.com/';
  const url = `${publicationUrl}p/retained-post`;
  const olderUrl = `${publicationUrl}p/older-blocked-post`;
  try {
    assert.equal((await command('status')).exists, false);
    await command('publication-upsert', {publicationUrl, feedUrl: `${publicationUrl}feed`, title: 'Workflow fixture'});
    const identity = {publicationUrl, url, publishedAt: '2026-01-02T08:00:00Z', title: 'Retained post'};
    await command('discover', {...identity, channel: 'rss'});
    const first = await command('claim', {url, owner: 'rss-worker', leaseSeconds: 3600});
    assert.equal(first.claimed, true);
    assert.equal((await command('claim', {url, owner: 'mail-worker'})).claimed, false);
    await command('complete', {url, leaseToken: first.leaseToken, outcome: 'source_and_update', verification: {readBack: true, verifiedAt: '2026-01-03T08:00:00Z', brainId: 'fixture-brain', paths: ['sources/post.md', 'sources/.raw/post.html', 'organizations/subject.md'], evidence: 'Fixture source, sidecar, and canonical coverage read back.'}});
    for (const channel of ['email', 'browser']) {
      const sighting = await command('discover', {...identity, url: `${url}?utm_source=${channel}`, channel});
      assert.equal(sighting.alreadyExists, true);
      assert.equal(sighting.post.outcome, 'source_and_update');
      const state = await command('status', {url});
      assert.equal(state.posts[0].verification.brainId, 'fixture-brain');
      assert.equal((await command('claim', {url, owner: `${channel}-worker`})).claimed, false);
    }
    await command('discover', {publicationUrl, url: olderUrl, publishedAt: '2026-01-01T08:00:00Z', title: 'Older blocked post', channel: 'browser'});
    const older = await command('claim', {url: olderUrl, owner: 'browser-worker'});
    await command('complete', {url: olderUrl, leaseToken: older.leaseToken, outcome: 'needs_review', reason: 'Fixture: source remains paywalled'});
    await command('scan-checkpoint', {publicationUrl, channel: 'browser', through: '2026-01-03T08:00:00Z', oldestSeenAt: '2026-01-01T08:00:00Z', newestSeenAt: '2026-01-02T08:00:00Z'});
    const outstanding = await command('status', {publicationUrl, outstandingOnly: true});
    assert.deepEqual(outstanding.posts.map(post => post.url), [olderUrl]);
    assert.ok(outstanding.publications[0].filed_high_watermark);
    assert.equal(outstanding.publications[0].outstanding_count, 1);
  } finally {
    await fs.rm(temporary, {recursive: true, force: true});
  }
});
