import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod';

export const DOMAIN_REGISTRY_FILENAME = 'domains.yaml';
export const DOMAIN_REGISTRY_SCHEMA_VERSION = 1;
export const DOMAIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const domainIdSchema = z.string()
  .trim()
  .regex(DOMAIN_ID_PATTERN, 'Domain IDs must be lowercase hyphenated slugs.');

export const domainDefinitionSchema = z.object({
  name: z.string().trim().min(1, 'Domain name is required.'),
  guidance: z.string().trim().min(1, 'Domain guidance is required.'),
});

export const domainRegistrySchema = z.object({
  schema_version: z.literal(DOMAIN_REGISTRY_SCHEMA_VERSION),
  domains: z.record(z.string(), domainDefinitionSchema),
}).superRefine((value, context) => {
  for (const id of Object.keys(value.domains)) {
    const parsed = domainIdSchema.safeParse(id);
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        path: ['domains', id],
        message: parsed.error.issues[0]?.message || 'Domain ID must be a lowercase hyphenated slug.',
      });
    }
  }
});

export function domainRegistryPath(config) {
  return path.join(config.brainDir, DOMAIN_REGISTRY_FILENAME);
}

export async function loadDomainRegistry(config, { allowMissing = true } = {}) {
  return loadDomainRegistryFromReader(config, async (filePath) => fs.readFile(filePath, 'utf8'), { allowMissing });
}

export function loadDomainRegistrySync(config, { allowMissing = true } = {}) {
  const filePath = domainRegistryPath(config);
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return missingRegistryResult(config);
    throw error;
  }
  return parseDomainRegistryResult(config, raw, filePath);
}

export async function listBrainDomains(config) {
  const loaded = await loadDomainRegistry(config);
  return {
    registry_path: relativeRegistryPath(config),
    schema_version: loaded.registry.schema_version,
    status: loaded.status,
    valid: loaded.valid,
    errors: loaded.errors,
    domains: listDomainDefinitions(loaded.registry),
  };
}

export async function getBrainDomain(config, id) {
  const normalizedId = normalizeDomainId(id);
  const loaded = await requireValidDomainRegistry(config);
  const definition = loaded.registry.domains[normalizedId];
  if (!definition) throw new Error(`Domain not found: ${normalizedId}`);
  return { id: normalizedId, ...definition };
}

export async function createBrainDomain(config, { id, name, guidance }) {
  const normalizedId = normalizeDomainId(id);
  const loaded = await requireValidDomainRegistry(config);
  if (loaded.registry.domains[normalizedId]) throw new Error(`Domain already exists: ${normalizedId}`);
  const definition = normalizeDomainDefinition({ name, guidance });
  const registry = {
    ...loaded.registry,
    domains: {
      ...loaded.registry.domains,
      [normalizedId]: definition,
    },
  };
  await writeDomainRegistry(config, registry);
  return { id: normalizedId, ...definition };
}

export async function updateBrainDomain(config, { id, name, guidance }) {
  const normalizedId = normalizeDomainId(id);
  const loaded = await requireValidDomainRegistry(config);
  const existing = loaded.registry.domains[normalizedId];
  if (!existing) throw new Error(`Domain not found: ${normalizedId}`);
  const definition = normalizeDomainDefinition({
    name: name === undefined ? existing.name : name,
    guidance: guidance === undefined ? existing.guidance : guidance,
  });
  const registry = {
    ...loaded.registry,
    domains: {
      ...loaded.registry.domains,
      [normalizedId]: definition,
    },
  };
  await writeDomainRegistry(config, registry);
  return { id: normalizedId, ...definition };
}

export async function deleteBrainDomain(config, { id }) {
  const normalizedId = normalizeDomainId(id);
  const loaded = await requireValidDomainRegistry(config);
  if (!loaded.registry.domains[normalizedId]) throw new Error(`Domain not found: ${normalizedId}`);
  const references = await pagesReferencingDomain(config, normalizedId);
  if (references.length) {
    throw new Error(`Domain ${normalizedId} is still assigned to page(s): ${references.slice(0, 8).join(', ')}.`);
  }
  const domains = { ...loaded.registry.domains };
  delete domains[normalizedId];
  await writeDomainRegistry(config, { ...loaded.registry, domains });
  return { id: normalizedId, deleted: true };
}

export async function assertRegisteredPageDomains(config, value) {
  const normalized = normalizePageDomainIds(value);
  const loaded = await requireValidDomainRegistry(config);
  const unknown = normalized.filter((id) => !loaded.registry.domains[id]);
  if (unknown.length) {
    throw new Error(`Unknown Brain domain(s): ${unknown.join(', ')}. Use domains/list to select registered domains.`);
  }
  return normalized;
}

export function normalizeDomainId(value) {
  const result = domainIdSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid domain ID: ${result.error.issues[0]?.message || 'lowercase hyphenated slug required.'}`);
  return result.data;
}

export function normalizePageDomainIds(value) {
  if (!Array.isArray(value)) throw new Error('Page domains must be an array of existing domain IDs.');
  const normalized = value.map(normalizeDomainId);
  return [...new Set(normalized)];
}

export function pageDomainIssues(value, registry) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    return [{
      type: 'invalid_domain_membership',
      details: { value },
    }];
  }
  const issues = [];
  const seen = new Set();
  for (const rawId of value) {
    const parsed = domainIdSchema.safeParse(rawId);
    const id = typeof rawId === 'string' ? rawId.trim() : String(rawId ?? '');
    if (!parsed.success || !registry.domains[id]) {
      issues.push({ type: 'unregistered_domain', details: { domain: id } });
      continue;
    }
    if (seen.has(id)) issues.push({ type: 'duplicate_domain_membership', details: { domain: id } });
    seen.add(id);
  }
  return issues;
}

export function domainMembershipFieldSchema(loadedOrRegistry) {
  const loaded = loadedOrRegistry?.registry ? loadedOrRegistry : { registry: loadedOrRegistry || emptyDomainRegistry() };
  const ids = Object.keys(loaded.registry.domains).sort();
  const item = ids.length
    ? z.enum(ids)
    : z.string().regex(DOMAIN_ID_PATTERN).refine(() => false, 'No registered Brain domains are available.');
  const schema = z.toJSONSchema(z.object({
    domains: z.array(item).optional().describe(domainMembershipDescription(loaded)),
  }));
  const field = schema.properties?.domains || { type: 'array', items: { type: 'string' } };
  delete field.$schema;
  return field;
}

export function domainMembershipDescription(loadedOrRegistry) {
  const loaded = loadedOrRegistry?.registry ? loadedOrRegistry : { registry: loadedOrRegistry || emptyDomainRegistry() };
  const definitions = listDomainDefinitions(loaded.registry);
  const lines = [
    'Optional membership in existing registered Brain domains.',
    'Leave this field omitted when no domain clearly applies. Use multiple IDs when a page contributes to multiple knowledge domains.',
    'Do not use this field for page type, privacy, or source.',
  ];
  if (!definitions.length) {
    lines.push('No registered Brain domains are currently available. Domain creation is a separate user-directed operation.');
  } else {
    lines.push('Registered domains:');
    for (const domain of definitions) lines.push(`- ${domain.id} (${domain.name}): ${domain.guidance}`);
  }
  return lines.join('\n');
}

async function requireValidDomainRegistry(config) {
  const loaded = await loadDomainRegistry(config, { allowMissing: true });
  if (!loaded.valid) throw new Error(`Domain registry is ${loaded.status}: ${loaded.errors.join('; ')}`);
  return loaded;
}

async function writeDomainRegistry(config, registry) {
  const parsed = domainRegistrySchema.parse(registry);
  const filePath = domainRegistryPath(config);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, yaml.dump(parsed, { noRefs: true, lineWidth: 120, sortKeys: false }), { encoding: 'utf8', mode: 0o644 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function normalizeDomainDefinition(input) {
  return domainDefinitionSchema.parse(input);
}

async function loadDomainRegistryFromReader(config, reader, { allowMissing }) {
  const filePath = domainRegistryPath(config);
  try {
    const raw = await reader(filePath);
    return parseDomainRegistryResult(config, raw, filePath);
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return missingRegistryResult(config);
    if (error?.name === 'ZodError' || error instanceof DomainRegistryParseError) {
      return invalidRegistryResult(config, error);
    }
    throw error;
  }
}

function parseDomainRegistryResult(config, raw, filePath) {
  let parsedYaml;
  try {
    parsedYaml = yaml.load(raw);
  } catch (error) {
    return invalidRegistryResult(config, new DomainRegistryParseError(error.message));
  }
  const parsed = domainRegistrySchema.safeParse(parsedYaml);
  if (!parsed.success) return invalidRegistryResult(config, new DomainRegistryParseError(formatZodErrors(parsed.error)));
  return {
    path: filePath,
    registry: parsed.data,
    status: 'valid',
    valid: true,
    errors: [],
  };
}

function missingRegistryResult(config) {
  return {
    path: domainRegistryPath(config),
    registry: emptyDomainRegistry(),
    status: 'missing',
    valid: true,
    errors: [],
  };
}

function invalidRegistryResult(config, error) {
  return {
    path: domainRegistryPath(config),
    registry: emptyDomainRegistry(),
    status: 'invalid',
    valid: false,
    errors: [error instanceof Error ? error.message : String(error)],
  };
}

function emptyDomainRegistry() {
  return { schema_version: DOMAIN_REGISTRY_SCHEMA_VERSION, domains: {} };
}

function listDomainDefinitions(registry) {
  return Object.entries(registry?.domains || {})
    .map(([id, definition]) => ({ id, ...definition }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function relativeRegistryPath(config) {
  return path.relative(config.brainDir, domainRegistryPath(config)).replace(/\\/g, '/') || DOMAIN_REGISTRY_FILENAME;
}

function formatZodErrors(error) {
  return error.issues.map((issue) => `${issue.path.join('.') || 'registry'}: ${issue.message}`).join('; ');
}

class DomainRegistryParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DomainRegistryParseError';
  }
}

async function pagesReferencingDomain(config, domainId) {
  const files = [];
  await collectMarkdownFiles(config.brainDir, config.brainDir, files);
  const references = [];
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    const marker = raw.match(/^---\n([\s\S]*?)\n---\n/m);
    if (!marker) continue;
    let frontmatter;
    try {
      frontmatter = yaml.load(marker[1]);
    } catch {
      continue;
    }
    if (Array.isArray(frontmatter?.domains) && frontmatter.domains.includes(domainId)) {
      references.push(path.relative(config.brainDir, filePath).replace(/\\/g, '/').replace(/\.md$/i, ''));
    }
  }
  return references.sort();
}

async function collectMarkdownFiles(root, current, files) {
  const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.bigbrain-state' || entry.name === '.raw') continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdownFiles(root, fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
}
