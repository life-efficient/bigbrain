import fs from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';

export const BRAIN_PROFILE_FILENAME = 'BRAIN.md';
export const BRAIN_PROFILE_SCHEMA_VERSION = 1;

export const DEFAULT_ALLOWED_ROUTING_METADATA = Object.freeze([
  'title',
  'date',
  'organizer',
  'attendee_domains',
  'folder_membership',
  'existing_granola_provenance',
]);

const INGESTION_MODES = new Set(['auto', 'review', 'deny']);
const MIXED_MEETING_POLICIES = new Set(['hold', 'single_owner', 'approved_scoped_extract']);
const SENSITIVITY_LEVELS = new Set(['private', 'confidential-shared', 'internal']);
const GENERATION_METHODS = new Set(['onboarding-ai', 'user-edit', 'migration']);
const REVIEW_STATUSES = new Set(['draft', 'approved']);
const ALLOWED_ROUTING_METADATA = new Set(DEFAULT_ALLOWED_ROUTING_METADATA);
const SOURCE_RULE_TYPES = new Set(['granola_folder', 'organizer_domain', 'account_context']);
const SOURCE_RULE_EFFECTS = new Set(['include', 'exclude', 'review']);
const EXAMPLE_OUTCOMES = new Set(['include', 'exclude', 'review']);
const EXAMPLE_METADATA_KEYS = new Set(['title', 'organizer_domain', 'attendee_domains', 'folder_names']);

export function brainProfilePath(config) {
  return path.join(config.brainDir, BRAIN_PROFILE_FILENAME);
}

export function conservativeBrainProfileDraft(config, {
  updatedBy = 'bigbrain',
  generationMethod = 'migration',
  now = new Date(),
} = {}) {
  return {
    schema_version: BRAIN_PROFILE_SCHEMA_VERSION,
    identity: {
      brain_id: config.brainId,
      brain_name: config.brainName,
      summary: `${config.brainName} has not completed its routing profile yet.`,
    },
    purpose_tags: [],
    routing: {
      ingestion_mode: 'review',
      include: [],
      exclude: [],
      source_rules: [],
      examples: [],
      mixed_meeting_policy: 'hold',
      minimum_confidence: null,
      approval_required: true,
    },
    privacy: {
      sensitivity: 'private',
      descriptor_visibility: 'authenticated_only',
      allowed_routing_metadata: [...DEFAULT_ALLOWED_ROUTING_METADATA],
    },
    provenance: {
      profile_version: 1,
      updated_at: now.toISOString(),
      updated_by: updatedBy,
      generation_method: generationMethod,
      user_guidance_summary: 'Conservative draft; review before enabling automatic routing.',
      review_status: 'draft',
    },
  };
}

export async function loadBrainProfile(config, { allowMissing = true } = {}) {
  const profilePath = brainProfilePath(config);
  let raw;
  try {
    raw = await fs.readFile(profilePath, 'utf8');
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') {
      return profileResult({
        config,
        profilePath,
        profile: conservativeBrainProfileDraft(config),
        status: 'missing',
        valid: false,
        errors: ['profile_missing'],
      });
    }
    throw error;
  }

  try {
    const profile = parseBrainProfileMarkdown(raw);
    const normalized = normalizeBrainProfile(profile, config);
    return profileResult({ config, profilePath, profile: normalized, status: 'valid', valid: true, errors: [] });
  } catch (error) {
    return profileResult({
      config,
      profilePath,
      profile: conservativeBrainProfileDraft(config),
      status: 'invalid',
      valid: false,
      errors: ['profile_invalid'],
    });
  }
}

export async function writeBrainProfile(config, profile) {
  if (config.brainIdentityPersisted === false) {
    throw new Error('Persist the runtime brain identity before writing BRAIN.md.');
  }
  const normalized = normalizeBrainProfile(profile, config);
  const profilePath = brainProfilePath(config);
  const temporaryPath = `${profilePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, renderBrainProfileMarkdown(normalized), { encoding: 'utf8', mode: 0o644 });
    await fs.rename(temporaryPath, profilePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return profileResult({ config, profilePath, profile: normalized, status: 'valid', valid: true, errors: [] });
}

export function normalizeBrainProfile(input, config) {
  requireObject(input, 'Brain profile');
  assertKeys(input, ['schema_version', 'identity', 'purpose_tags', 'routing', 'privacy', 'provenance'], 'Brain profile');
  if (Number(input.schema_version) !== BRAIN_PROFILE_SCHEMA_VERSION) {
    throw new Error(`Unsupported brain profile schema_version: ${input.schema_version ?? 'missing'}.`);
  }

  const identity = requireObject(input.identity, 'identity');
  assertKeys(identity, ['brain_id', 'brain_name', 'summary'], 'identity');
  if (requireString(identity.brain_id, 'identity.brain_id') !== config.brainId) {
    throw new Error('identity.brain_id must match the immutable runtime brain_id.');
  }
  if (requireString(identity.brain_name, 'identity.brain_name') !== config.brainName) {
    throw new Error('identity.brain_name must match the runtime brain_name.');
  }

  const routing = requireObject(input.routing, 'routing');
  assertKeys(routing, ['ingestion_mode', 'include', 'exclude', 'source_rules', 'examples', 'mixed_meeting_policy', 'minimum_confidence', 'approval_required'], 'routing');
  const ingestionMode = requireEnum(routing.ingestion_mode, INGESTION_MODES, 'routing.ingestion_mode');
  const minimumConfidence = normalizeConfidence(routing.minimum_confidence);
  const privacy = requireObject(input.privacy, 'privacy');
  const provenance = requireObject(input.provenance, 'provenance');
  assertKeys(privacy, ['sensitivity', 'descriptor_visibility', 'allowed_routing_metadata'], 'privacy');
  assertKeys(provenance, ['profile_version', 'updated_at', 'updated_by', 'generation_method', 'user_guidance_summary', 'review_status'], 'provenance');
  const descriptorVisibility = requireString(privacy.descriptor_visibility, 'privacy.descriptor_visibility');
  if (descriptorVisibility !== 'authenticated_only') {
    throw new Error('privacy.descriptor_visibility must be authenticated_only for schema version 1.');
  }

  return {
    schema_version: BRAIN_PROFILE_SCHEMA_VERSION,
    identity: {
      brain_id: config.brainId,
      brain_name: config.brainName,
      summary: requireString(identity.summary, 'identity.summary'),
    },
    purpose_tags: uniqueStringArray(input.purpose_tags, 'purpose_tags'),
    routing: {
      ingestion_mode: ingestionMode,
      include: stringArray(routing.include, 'routing.include'),
      exclude: stringArray(routing.exclude, 'routing.exclude'),
      source_rules: normalizeSourceRules(routing.source_rules),
      examples: normalizeExamples(routing.examples),
      mixed_meeting_policy: requireEnum(routing.mixed_meeting_policy, MIXED_MEETING_POLICIES, 'routing.mixed_meeting_policy'),
      minimum_confidence: minimumConfidence,
      approval_required: requireBoolean(routing.approval_required, 'routing.approval_required'),
    },
    privacy: {
      sensitivity: requireEnum(privacy.sensitivity, SENSITIVITY_LEVELS, 'privacy.sensitivity'),
      descriptor_visibility: descriptorVisibility,
      allowed_routing_metadata: enumArray(privacy.allowed_routing_metadata, ALLOWED_ROUTING_METADATA, 'privacy.allowed_routing_metadata'),
    },
    provenance: {
      profile_version: requirePositiveInteger(provenance.profile_version, 'provenance.profile_version'),
      updated_at: requireIsoDate(provenance.updated_at, 'provenance.updated_at'),
      updated_by: requireActorLabel(provenance.updated_by),
      generation_method: requireEnum(provenance.generation_method, GENERATION_METHODS, 'provenance.generation_method'),
      user_guidance_summary: requireString(provenance.user_guidance_summary, 'provenance.user_guidance_summary'),
      review_status: requireEnum(provenance.review_status, REVIEW_STATUSES, 'provenance.review_status'),
    },
  };
}

export function parseBrainProfileMarkdown(markdown) {
  if (!String(markdown).startsWith('---\n')) throw new Error(`${BRAIN_PROFILE_FILENAME} must begin with YAML frontmatter.`);
  const end = String(markdown).indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`${BRAIN_PROFILE_FILENAME} frontmatter is not closed.`);
  const parsed = yaml.load(String(markdown).slice(4, end));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${BRAIN_PROFILE_FILENAME} frontmatter must be an object.`);
  return parsed;
}

export function renderBrainProfileMarkdown(profile) {
  const frontmatter = yaml.dump(profile, { noRefs: true, lineWidth: 100, sortKeys: false }).trimEnd();
  return `---\n${frontmatter}\n---\n\n# ${profile.identity.brain_name}\n\n${profile.identity.summary}\n`;
}

export function authenticatedBrainAbout(config, loaded, {
  authState = 'local_trusted',
  writable = false,
  availableOperations = ['read'],
  serviceVersion = null,
} = {}) {
  const approved = loaded.valid && loaded.profile.provenance.review_status === 'approved';
  const effectiveIngestionMode = approved
    && loaded.profile.routing.ingestion_mode === 'auto'
    && loaded.profile.routing.approval_required === false
    ? 'auto'
    : loaded.valid && loaded.profile.routing.ingestion_mode === 'deny'
      ? 'deny'
      : 'review';
  return {
    schema_version: BRAIN_PROFILE_SCHEMA_VERSION,
    brain_id: config.brainId,
    brain_name: config.brainName,
    descriptor: loaded.valid ? redactDescriptor(loaded.profile) : null,
    manifest: {
      filename: BRAIN_PROFILE_FILENAME,
      status: loaded.status,
      valid: loaded.valid,
      errors: [...loaded.errors],
      reviewed: approved,
    },
    capabilities: {
      filing_rules: true,
      read: true,
      write: Boolean(writable),
      routing_profile: loaded.valid,
      available_operations: [...availableOperations],
    },
    auth_state: authState,
    service_version: serviceVersion,
    routing: {
      auto_write_allowed: Boolean(writable) && effectiveIngestionMode === 'auto',
      effective_ingestion_mode: effectiveIngestionMode,
    },
  };
}

function profileResult({ config, profilePath, profile, status, valid, errors }) {
  return {
    profilePath,
    profile,
    status,
    valid,
    errors,
    about: authenticatedBrainAbout(config, { profile, status, valid, errors }),
  };
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`);
  return value;
}

function requirePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`);
  return number;
}

function requireIsoDate(value, name) {
  const string = requireString(value, name);
  if (Number.isNaN(Date.parse(string))) throw new Error(`${name} must be an ISO date-time.`);
  return string;
}

function requireEnum(value, choices, name) {
  const string = requireString(value, name);
  if (!choices.has(string)) throw new Error(`${name} must be one of: ${Array.from(choices).join(', ')}.`);
  return string;
}

function stringArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function uniqueStringArray(value, name) {
  const values = stringArray(value, name);
  if (new Set(values).size !== values.length) throw new Error(`${name} must not contain duplicates.`);
  return values;
}

function enumArray(value, choices, name) {
  const values = uniqueStringArray(value, name);
  for (const item of values) {
    if (!choices.has(item)) throw new Error(`${name} contains unsupported value: ${item}.`);
  }
  return values;
}

function requireActorLabel(value) {
  const string = requireString(value, 'provenance.updated_by');
  if (string.includes('@') || !/^[a-z0-9][a-z0-9/_-]*$/i.test(string)) {
    throw new Error('provenance.updated_by must be a safe system label or person slug, not an email address.');
  }
  return string;
}

function normalizeConfidence(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error('routing.minimum_confidence must be null or a number from 0 to 1.');
  return number;
}

function normalizeSourceRules(value) {
  if (!Array.isArray(value)) throw new Error('routing.source_rules must be an array.');
  return value.map((item, index) => {
    const name = `routing.source_rules[${index}]`;
    requireObject(item, name);
    assertKeys(item, ['type', 'effect', 'value'], name);
    return {
      type: requireEnum(item.type, SOURCE_RULE_TYPES, `${name}.type`),
      effect: requireEnum(item.effect, SOURCE_RULE_EFFECTS, `${name}.effect`),
      value: requireString(item.value, `${name}.value`),
    };
  });
}

function normalizeExamples(value) {
  if (!Array.isArray(value)) throw new Error('routing.examples must be an array.');
  return value.map((item, index) => {
    const name = `routing.examples[${index}]`;
    requireObject(item, name);
    assertKeys(item, ['label', 'outcome', 'metadata', 'rationale'], name);
    const metadata = requireObject(item.metadata, `${name}.metadata`);
    assertKeys(metadata, Array.from(EXAMPLE_METADATA_KEYS), `${name}.metadata`);
    const normalizedMetadata = {};
    if (metadata.title !== undefined) normalizedMetadata.title = requireString(metadata.title, `${name}.metadata.title`);
    if (metadata.organizer_domain !== undefined) normalizedMetadata.organizer_domain = requireString(metadata.organizer_domain, `${name}.metadata.organizer_domain`);
    if (metadata.attendee_domains !== undefined) normalizedMetadata.attendee_domains = stringArray(metadata.attendee_domains, `${name}.metadata.attendee_domains`);
    if (metadata.folder_names !== undefined) normalizedMetadata.folder_names = stringArray(metadata.folder_names, `${name}.metadata.folder_names`);
    if (Object.keys(normalizedMetadata).length === 0) throw new Error(`${name}.metadata must include at least one supported field.`);
    return {
      label: requireString(item.label, `${name}.label`),
      outcome: requireEnum(item.outcome, EXAMPLE_OUTCOMES, `${name}.outcome`),
      metadata: normalizedMetadata,
      rationale: requireString(item.rationale, `${name}.rationale`),
    };
  });
}

function assertKeys(value, allowed, name) {
  const supported = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !supported.has(key));
  if (unknown.length > 0) throw new Error(`${name} contains unsupported field(s): ${unknown.join(', ')}.`);
}

function redactDescriptor(profile) {
  return {
    ...profile,
    provenance: {
      profile_version: profile.provenance.profile_version,
      updated_at: profile.provenance.updated_at,
      generation_method: profile.provenance.generation_method,
      user_guidance_summary: profile.provenance.user_guidance_summary,
      review_status: profile.provenance.review_status,
    },
  };
}
