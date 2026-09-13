import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import {
  bootstrapPageSchemaRegistry,
  deletePageSchema,
  getPageSchema,
  loadPageSchemaRegistry,
  PAGE_SCHEMA_REGISTRY_FILENAME,
  registerPageSchema,
  resolvePageSchema,
  updatePageSchema,
} from '../../src/bigbrain/page-schema-registry.js';

test('new Brains receive an editable default page schema registry', async () => {
  const fixture = await createFixture('bigbrain-page-schema-missing-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const loaded = await loadPageSchemaRegistry(config);

    assert.equal(loaded.status, 'valid');
    assert.equal(loaded.valid, true);
    assert.equal(resolvePageSchema(loaded.registry, { pagePath: 'people/alice.md' }).id, 'people');
    const task = resolvePageSchema(loaded.registry, { pagePath: 'tasks/follow-up.md' });
    assert.equal(task.id, 'tasks');
    assert.deepEqual(task.schema.fields.status.enum, ['open', 'in_progress', 'waiting', 'done', 'archived']);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page schema registry remains optional for existing Brains until explicitly bootstrapped', async () => {
  const fixture = await createFixture('bigbrain-page-schema-missing-');
  try {
    await fs.rm(path.join(fixture.brainHome, PAGE_SCHEMA_REGISTRY_FILENAME));
    const config = await loadConfig({ configPath: fixture.configPath });
    const loaded = await loadPageSchemaRegistry(config);

    assert.equal(loaded.status, 'missing');
    assert.equal(loaded.valid, true);
    assert.deepEqual(loaded.registry.schemas, {});
    assert.equal(resolvePageSchema(loaded.registry, { pagePath: 'people/alice.md' }), null);

    const bootstrapped = await bootstrapPageSchemaRegistry(config);
    assert.equal(bootstrapped.status, 'valid');
    assert.equal(resolvePageSchema(bootstrapped.registry, { pagePath: 'people/alice.md' }).id, 'people');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page schema registry resolves arbitrary schemas by page metadata or path', async () => {
  const fixture = await createFixture('bigbrain-page-schema-valid-');
  try {
    await fs.writeFile(path.join(fixture.brainHome, PAGE_SCHEMA_REGISTRY_FILENAME), `schema_version: 1
schemas:
  work-item:
    path_prefix: work
    fields:
      state:
        type: string
        enum: [queued, active, closed]
        required: true
  client-brief:
    path_prefix: work/briefs
    fields:
      client:
        type: string
        required: true
  freeform-note:
    fields:
      topic:
        type: string
`, 'utf8');
    const config = await loadConfig({ configPath: fixture.configPath });
    const loaded = await loadPageSchemaRegistry(config);

    assert.equal(loaded.status, 'valid');
    assert.equal(resolvePageSchema(loaded.registry, { pagePath: 'work/briefs/acme.md' }).id, 'client-brief');
    assert.equal(resolvePageSchema(loaded.registry, { pagePath: 'notes/research.md', frontmatter: { page_schema: 'freeform-note' } }).id, 'freeform-note');
    assert.throws(
      () => resolvePageSchema(loaded.registry, { pagePath: 'notes/research.md', frontmatter: { page_schema: 'missing-schema' } }),
      /unknown page_schema/,
    );
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page schema registry rejects invalid or ambiguous path prefixes', async () => {
  const fixture = await createFixture('bigbrain-page-schema-invalid-');
  try {
    await fs.writeFile(path.join(fixture.brainHome, PAGE_SCHEMA_REGISTRY_FILENAME), `schema_version: 1
schemas:
  first:
    path_prefix: tasks
  second:
    path_prefix: tasks/
  unsafe:
    path_prefix: ../outside
`, 'utf8');
    const config = await loadConfig({ configPath: fixture.configPath });
    const loaded = await loadPageSchemaRegistry(config);

    assert.equal(loaded.status, 'invalid');
    assert.equal(loaded.valid, false);
    assert.match(loaded.errors.join('\n'), /already assigned/);
    assert.match(loaded.errors.join('\n'), /relative non-hidden path/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page schemas can be registered, updated, and safely deleted per Brain', async () => {
  const fixture = await createFixture('bigbrain-page-schema-register-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const registered = await registerPageSchema(config, {
      id: 'decision-log',
      definition: {
        path_prefix: 'decisions',
        description: 'Decision records for this Brain.',
        fields: {
          outcome: { type: 'string', required: true },
        },
      },
    });
    assert.equal(registered.id, 'decision-log');

    const updated = await updatePageSchema(config, {
      id: 'decision-log',
      definition: {
        path_prefix: 'decisions',
        description: 'Decision records with explicit state.',
        fields: {
          outcome: { type: 'string', required: true },
          state: { type: 'string', enum: ['proposed', 'accepted'], default: 'proposed' },
        },
      },
    });
    assert.equal(updated.fields.state.default, 'proposed');
    assert.equal((await getPageSchema(config, 'decision-log')).description, 'Decision records with explicit state.');

    const deleted = await deletePageSchema(config, { id: 'decision-log' });
    assert.deepEqual(deleted, { id: 'decision-log', deleted: true });
    await assert.rejects(() => getPageSchema(config, 'decision-log'), /not found/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

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
