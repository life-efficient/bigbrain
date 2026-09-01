import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_TYPE_DEFINITIONS,
  SOURCE_TYPE_VALUES,
  TIMELINE_SIGNIFICANCE_VALUES,
  mutationMetadataSchema,
  parseMutationMetadata,
  sourceTypeSchema,
  timelineSignificanceSchema,
} from '../../src/bigbrain/source-taxonomy.js';

test('source taxonomy has semantic descriptions for every source type', () => {
  assert.deepEqual(SOURCE_TYPE_VALUES, [
    'assistant_chat',
    'whatsapp',
    'gmail',
    'google_calendar',
    'granola',
    'rss',
    'webhook',
    'cli',
    'direct_edit',
    'unknown',
  ]);
  for (const sourceType of SOURCE_TYPE_VALUES) {
    assert.equal(sourceTypeSchema.parse(sourceType), sourceType);
    assert.match(SOURCE_TYPE_DEFINITIONS[sourceType].description, /\S/);
  }
});

test('source taxonomy distinguishes assistant chat, CLI, direct edit, and unknown', () => {
  assert.notEqual(SOURCE_TYPE_DEFINITIONS.assistant_chat.description, SOURCE_TYPE_DEFINITIONS.cli.description);
  assert.notEqual(SOURCE_TYPE_DEFINITIONS.assistant_chat.description, SOURCE_TYPE_DEFINITIONS.direct_edit.description);
  assert.match(SOURCE_TYPE_DEFINITIONS.unknown.description, /cannot be established/i);
});

test('timeline significance accepts only patch, minor, or major', () => {
  assert.deepEqual(TIMELINE_SIGNIFICANCE_VALUES, ['patch', 'minor', 'major']);
  for (const significance of TIMELINE_SIGNIFICANCE_VALUES) {
    assert.equal(timelineSignificanceSchema.parse(significance), significance);
  }
  assert.equal(timelineSignificanceSchema.safeParse('trivial').success, false);
  assert.equal(timelineSignificanceSchema.safeParse(undefined).success, false);
});

test('mutation metadata requires a compact source and single-line commit message', () => {
  const valid = {
    commit_message: 'Record the Gmail update on the project',
    provenance: {
      event_id: 'gmail:event-1',
      source_type: 'gmail',
      source_label: 'Data center thread',
      source_message: 'The data center discussion updated the project context.',
    },
  };
  assert.deepEqual(parseMutationMetadata(valid), valid);
  assert.equal(mutationMetadataSchema.safeParse({
    ...valid,
    commit_message: 'first\nsecond',
  }).success, false);
  assert.equal(mutationMetadataSchema.safeParse({
    ...valid,
    provenance: { ...valid.provenance, source_type: 'not-a-source' },
  }).success, false);
});
