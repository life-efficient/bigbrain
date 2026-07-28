import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
export const BRAIN_PROFILE_JSON_SCHEMA = require('../../schemas/brain-profile.schema.json');

export const BRAIN_PROFILE_FILENAME = 'BRAIN.md';
export const BRAIN_PROFILE_SCHEMA_VERSION = 1;

export function brainProfilePath(config) {
  return path.join(config.brainDir, BRAIN_PROFILE_FILENAME);
}

export function conservativeBrainProfileDraft(config) {
  return {
    schema_version: BRAIN_PROFILE_SCHEMA_VERSION,
    identity: {
      brain_id: config.brainId,
      brain_name: config.brainName,
      description: `${config.brainName} has not set a routing description yet.`,
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
        errors: ['description_missing'],
      });
    }
    throw error;
  }

  try {
    const profile = parseBrainProfileMarkdown(raw);
    const normalized = normalizeBrainProfile(profile, config);
    return profileResult({ config, profilePath, profile: normalized, status: 'valid', valid: true, errors: [] });
  } catch {
    return profileResult({
      config,
      profilePath,
      profile: conservativeBrainProfileDraft(config),
      status: 'invalid',
      valid: false,
      errors: ['description_invalid'],
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

export async function saveBrainProfileRevision(config, profile) {
  return writeBrainProfile(config, profile);
}

export function normalizeBrainProfile(input, config) {
  requireObject(input, 'Brain description');
  if (input.schema_version !== BRAIN_PROFILE_SCHEMA_VERSION) {
    throw new Error(`Unsupported brain description schema_version: ${input.schema_version ?? 'missing'}.`);
  }

  const identity = requireObject(input.identity, 'identity');
  const brainId = requireString(identity.brain_id, 'identity.brain_id');
  const brainName = requireString(identity.brain_name, 'identity.brain_name');
  if (brainId !== config.brainId) throw new Error('identity.brain_id must match the immutable runtime brain_id.');
  if (brainName !== config.brainName) throw new Error('identity.brain_name must match the runtime brain_name.');

  return {
    schema_version: BRAIN_PROFILE_SCHEMA_VERSION,
    identity: {
      brain_id: config.brainId,
      brain_name: config.brainName,
      description: requireString(identity.description ?? identity.summary, 'identity.description'),
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

export function isBrainProfileDocument(markdown) {
  try {
    const parsed = parseBrainProfileMarkdown(markdown);
    return Object.hasOwn(parsed, 'schema_version') && Object.hasOwn(parsed, 'identity');
  } catch {
    return false;
  }
}

export function renderBrainProfileMarkdown(profile) {
  const frontmatter = yaml.dump(profile, { noRefs: true, lineWidth: 100, sortKeys: false }).trimEnd();
  return `---\n${frontmatter}\n---\n\n# ${profile.identity.brain_name}\n\n${profile.identity.description}\n`;
}

export function authenticatedBrainAbout(config, loaded, {
  authState = 'local_trusted',
  writable = false,
  availableOperations = ['read'],
  serviceVersion = null,
} = {}) {
  const effectiveIngestionMode = loaded.valid ? 'auto' : 'review';
  return {
    schema_version: BRAIN_PROFILE_SCHEMA_VERSION,
    brain_id: config.brainId,
    brain_name: config.brainName,
    descriptor: loaded.valid ? loaded.profile : null,
    manifest: {
      filename: BRAIN_PROFILE_FILENAME,
      status: loaded.status,
      valid: loaded.valid,
      errors: [...loaded.errors],
      reviewed: loaded.valid,
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
