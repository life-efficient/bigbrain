import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import {
  listContactChannels,
  legacyContactChannels,
  normalizeContactChannels,
  readContactChannel,
  removeContactChannel,
  upsertContactChannel,
} from '../../src/bigbrain/contact-channels.js';
import { createBrainPage } from '../../src/bigbrain/page-ops.js';

test('contact channels support multiple types, stable updates, primary selection, and removal', async () => {
  const fixture = await createFixture('bigbrain-contact-channels-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await createBrainPage({
      config,
      pagePath: 'people/alice',
      title: 'Alice',
      body: 'Alice is a test contact.',
      timelineEntry: timeline('Created Alice.'),
      timelineSignificance: 'minor',
    });

    const first = await upsertContactChannel({
      config,
      pagePath: 'people/alice',
      channel: { type: 'email', value: 'Alice@Example.com', label: 'work', primary: true },
      timelineEntry: timeline('Added Alice\'s work email.'),
      timelineSignificance: 'minor',
    });
    assert.match(first.channel.id, /^email-[a-f0-9]{8}$/);
    assert.equal(first.channel.value, 'alice@example.com');
    assert.equal(first.channel.primary, true);

    const retried = await upsertContactChannel({
      config,
      pagePath: 'people/alice.md',
      channel: { type: 'email', value: 'alice@example.com', label: 'office', primary: true },
      timelineEntry: timeline('Confirmed Alice\'s email label.'),
      timelineSignificance: 'patch',
    });
    assert.equal(retried.channel.id, first.channel.id);
    assert.equal(retried.channels.length, 1);
    assert.equal(retried.channel.label, 'office');

    const personal = await upsertContactChannel({
      config,
      pagePath: 'people/alice',
      channel: { type: 'email', value: 'alice@personal.example', primary: true, verified_at: '2026-10-03' },
      timelineEntry: timeline('Added Alice\'s preferred personal email.'),
      timelineSignificance: 'minor',
    });
    assert.equal(personal.channels.length, 2);
    assert.equal(personal.channels.find((channel) => channel.id === first.channel.id).primary, undefined);
    assert.equal(personal.channel.verified_at, '2026-10-03T00:00:00.000Z');

    const phone = await upsertContactChannel({
      config,
      pagePath: 'people/alice',
      channel: { type: 'phone', value: '+44 20 7946 0958', label: 'mobile' },
      timelineEntry: timeline('Added Alice\'s phone number.'),
      timelineSignificance: 'minor',
    });
    assert.equal(phone.channels.length, 3);

    const read = await readContactChannel({ config, pagePath: 'people/alice', channelId: phone.channel.id });
    assert.equal(read.channel.value, '+44 20 7946 0958');
    const removed = await removeContactChannel({
      config,
      pagePath: 'people/alice',
      channelId: phone.channel.id,
      timelineEntry: timeline('Removed Alice\'s old phone number.'),
      timelineSignificance: 'minor',
    });
    assert.equal(removed.channels.length, 2);
    assert.equal((await listContactChannels({ config, pagePath: 'people/alice' })).channels.length, 2);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('contact channel validation rejects malformed, duplicate, and non-person data', async () => {
  assert.throws(() => normalizeContactChannels([{ id: 'email-a', type: 'email', value: 'invalid' }]), /valid email/);
  assert.throws(() => normalizeContactChannels([
    { id: 'email-a', type: 'email', value: 'a@example.com' },
    { id: 'email-b', type: 'email', value: 'A@example.com' },
  ]), /Duplicate email/);
  assert.throws(() => normalizeContactChannels([
    { id: 'email-a', type: 'email', value: 'a@example.com', primary: true },
    { id: 'email-b', type: 'email', value: 'b@example.com', primary: true },
  ]), /Only one primary/);
  assert.deepEqual(legacyContactChannels({
    email: 'Legacy@Example.com',
    linkedin_url: 'https://www.linkedin.com/in/legacy',
    contact_channels: [{ id: 'email-current', type: 'email', value: 'current@example.com' }],
  }), [
    { type: 'email', value: 'legacy@example.com', legacy_field: 'email', read_only: true },
    { type: 'linkedin', value: 'https://www.linkedin.com/in/legacy', legacy_field: 'linkedin_url', read_only: true },
  ]);

  const fixture = await createFixture('bigbrain-contact-channels-scope-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await assert.rejects(
      () => listContactChannels({ config, pagePath: 'organizations/example' }),
      /only be stored on a people page/,
    );
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

function timeline(text) {
  return {
    text,
    provenance: {
      event_id: `test:${text}`,
      source_type: 'assistant_chat',
      source_label: 'Contact channel test',
      source_message: text,
    },
  };
}

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const brainHome = path.join(rootDir, 'brain');
  const env = {
    ...process.env,
    BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
    BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
  };
  const init = await initializeBrainHome(brainHome, { env });
  return { rootDir, brainHome, configPath: init.configPath };
}
