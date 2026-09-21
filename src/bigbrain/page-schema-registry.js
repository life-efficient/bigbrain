import fs from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod';

import { CANONICAL_SCHEMA_DIRS } from './constants.js';

export const PAGE_SCHEMA_REGISTRY_FILENAME = 'page-schemas.yaml';
export const PAGE_SCHEMA_REGISTRY_VERSION = 1;
export const PAGE_SCHEMA_DEFAULTS_VERSION = 1;

const SCHEMA_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object'];
const DEFAULT_SCHEMA_DESCRIPTIONS = {
  articles: 'Published online articles, Substack posts, newsletters, and other durable source publications.',
  videos: 'Canonical pages for externally published videos, with a readable account and preserved source transcript.',
  people: 'Canonical pages for people and relationship context.',
  organizations: 'Canonical pages for organizations and institutions.',
  deals: 'Canonical pages for transactions and deal work.',
  projects: 'Canonical pages for active workstreams and execution.',
  ideas: 'Canonical pages for unbuilt possibilities.',
  meetings: 'Canonical pages for meetings, preparation, and decisions.',
  tasks: 'Assignable work items with task-specific frontmatter.',
  concepts: 'Canonical pages for individual ideas, mechanisms, definitions, and phenomena.',
  frameworks: 'Canonical pages for structured models used to analyze, decide, or organize knowledge.',
  components: 'Canonical pages for technical or physical components.',
  products: 'Canonical pages for named commercial offerings.',
  processes: 'Canonical pages for repeatable operating processes.',
  writing: 'Canonical pages for authored prose artifacts.',
  protocol: 'Canonical pages for operating rules and preferences.',
  archive: 'Canonical pages for historical or superseded material.',
};

const fieldDefinitionSchema = z.object({
  type: z.enum(FIELD_TYPES).optional(),
  required: z.boolean().optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  default: z.unknown().optional(),
  description: z.string().trim().min(1).optional(),
}).passthrough();

const pageSchemaDefinitionSchema = z.object({
  path_prefix: z.string().trim().min(1).optional(),
  fields: z.record(z.string(), fieldDefinitionSchema).default({}),
  additional_properties: z.boolean().optional(),
  description: z.string().trim().min(1).optional(),
}).passthrough();

const PAGE_SCHEMA_RESERVED_FIELDS = new Set([
  'title',
  'created',
  'page_schema',
  'domains',
  'images',
  'visibility',
  'public',
  'public_raw_files',
  'redirect_from',
]);

export const pageSchemaRegistrySchema = z.object({
  schema_version: z.literal(PAGE_SCHEMA_REGISTRY_VERSION),
  defaults_version: z.number().int().nonnegative().optional(),
  schemas: z.record(z.string(), pageSchemaDefinitionSchema),
}).passthrough().superRefine((value, context) => {
  const prefixes = new Map();
  for (const [id, schema] of Object.entries(value.schemas)) {
    if (!SCHEMA_ID_PATTERN.test(id)) {
      context.addIssue({
        code: 'custom',
        path: ['schemas', id],
        message: 'Schema IDs must be lowercase hyphenated slugs.',
      });
    }
    if (!schema.path_prefix) continue;
    const prefix = normalizePathPrefix(schema.path_prefix);
    if (!prefix) {
      context.addIssue({
        code: 'custom',
        path: ['schemas', id, 'path_prefix'],
        message: 'path_prefix must be a relative non-hidden path without . or .. segments.',
      });
      continue;
    }
    if (prefixes.has(prefix)) {
      context.addIssue({
        code: 'custom',
        path: ['schemas', id, 'path_prefix'],
        message: `path_prefix ${schema.path_prefix} is already assigned to ${prefixes.get(prefix)}.`,
      });
    } else {
      prefixes.set(prefix, id);
    }
  }
});

export function pageSchemaRegistryPath(config) {
  return path.join(config.brainDir, PAGE_SCHEMA_REGISTRY_FILENAME);
}

export function defaultPageSchemaRegistry({ schemaDirs = CANONICAL_SCHEMA_DIRS, compatibility = false } = {}) {
  const schemas = {};
  for (const collection of schemaDirs) {
    const prefix = normalizePathPrefix(collection);
    if (!prefix) continue;
    const id = schemaIdForPathPrefix(prefix, Object.keys(schemas));
    const isBuiltIn = CANONICAL_SCHEMA_DIRS.includes(prefix);
    schemas[id] = compatibility || !isBuiltIn
      ? compatiblePageSchema(prefix)
      : defaultPageSchema(prefix);
  }
  return {
    schema_version: PAGE_SCHEMA_REGISTRY_VERSION,
    defaults_version: PAGE_SCHEMA_DEFAULTS_VERSION,
    schemas,
  };
}

function defaultPageSchema(collection) {
  return {
    path_prefix: collection,
    description: DEFAULT_SCHEMA_DESCRIPTIONS[collection] || `Canonical pages under ${collection}/.`,
    additional_properties: !['articles', 'tasks', 'videos'].includes(collection),
    fields: collection === 'tasks'
      ? defaultTaskFields()
      : collection === 'articles'
        ? defaultArticleFields()
        : collection === 'videos'
          ? defaultVideoFields()
          : {},
  };
}

function compatiblePageSchema(collection) {
  return {
    path_prefix: collection,
    description: DEFAULT_SCHEMA_DESCRIPTIONS[collection] || `Brain-local pages under ${collection}/.`,
    additional_properties: true,
    fields: {},
  };
}

function defaultArticleFields() {
  return {
    published_date: {
      type: 'string',
      required: true,
      description: 'Publisher publication timestamp in ISO 8601 format.',
    },
    article_url: {
      type: 'string',
      required: true,
      description: 'Canonical article URL used for source provenance.',
    },
    source_kind: { type: 'string', required: true, description: 'Source channel such as online-article, substack, newsletter, or rss.' },
    raw_file: { type: 'string', description: 'Relative path to the preserved source artifact.' },
    raw_mime_type: { type: 'string', description: 'MIME type of the preserved source artifact.' },
    retrieved: { type: 'string', description: 'Date or timestamp when the source was retrieved.' },
    publisher: { description: 'Publisher name.' },
    author: { description: 'Author name or names as supplied by the source.' },
    authors: { type: 'array', description: 'Author names when represented as an ordered list.' },
    publication: { description: 'Publication or newsletter name.' },
    publication_url: { type: 'string' },
    publication_key: { type: 'string' },
    post_key: { type: 'string' },
    published: { description: 'Legacy or source-specific publication value.' },
    published_period: { type: 'string' },
    source_feed: { type: 'string' },
    feed_url: { type: 'string' },
    rss_id: { type: 'string' },
    rss_guid: { type: 'string' },
    canonical_url: { type: 'string' },
    source_updated: { type: 'string' },
    retrieval_method: { type: 'string' },
    filing_outcome: { type: 'string' },
    fetch_status: { type: 'string' },
    podcast_url: { type: 'string' },
    podcast_duration_seconds: { description: 'Duration supplied by the source or transcript provider.' },
    transcript_available: { type: 'boolean' },
    relevance_rationale: { type: 'string' },
    retrieval_status: { type: 'string' },
    ingestion_status: { type: 'string' },
    verified_at: { type: 'string' },
    preview_only: { type: 'boolean' },
    transport_url: { type: 'string' },
    raw_format: { type: 'string' },
    post_id: { description: 'Source-provider post identifier.' },
    capture_method: { type: 'string' },
    source_guidance_available: { type: 'boolean' },
    ingest_outcome: { type: 'string' },
    publication_id: { type: 'string' },
    author_basis: { type: 'string' },
    publisher_post_id: { type: 'string' },
    raw_bytes: { description: 'Size of the preserved source artifact in bytes.' },
    transport: { type: 'string' },
    tags: { type: 'array' },
  };
}

function defaultVideoFields() {
  return {
    video_url: {
      type: 'string',
      required: true,
      description: 'Canonical public video URL used for source provenance and playback.',
    },
    source_kind: {
      type: 'string',
      required: true,
      description: 'Video platform or source channel, such as youtube.',
    },
    channel: { type: 'string', description: 'Publishing channel or creator.' },
    channel_url: { type: 'string', description: 'Canonical publishing channel URL.' },
    published_date: { type: 'string', description: 'Publisher publication timestamp in ISO 8601 format.' },
    duration_seconds: { type: 'number', description: 'Published video duration in seconds.' },
    thumbnail_url: { type: 'string', description: 'Public thumbnail URL for the video.' },
    transcript_available: { type: 'boolean', description: 'Whether a transcript was retrieved for this video.' },
    transcript_raw_file: { type: 'string', description: 'Relative path to the preserved verbatim transcript artifact.' },
    retrieved: { type: 'string', description: 'Date or timestamp when the video source was retrieved.' },
    source_video_id: { type: 'string', description: 'Platform-specific video identifier.' },
    raw_file: { type: 'string', description: 'Relative path to another preserved source artifact, when applicable.' },
    tags: { type: 'array' },
  };
}

export async function ensurePageSchemaRegistry(config) {
  return bootstrapPageSchemaRegistry(config);
}

export async function migratePageSchemaRegistry(config) {
  const loaded = await loadPageSchemaRegistry(config);
  if (loaded.status === 'invalid') {
    throw new Error(`Page schema registry is invalid: ${loaded.errors.join('; ')}`);
  }

  if (loaded.status === 'missing') {
    const registry = defaultPageSchemaRegistry({ schemaDirs: config.schemaDirs, compatibility: true });
    await writePageSchemaRegistry(config, registry);
    return {
      ...(await loadPageSchemaRegistry(config, { allowMissing: false })),
      migration: { created: true, changed: true, from_defaults_version: 0, to_defaults_version: PAGE_SCHEMA_DEFAULTS_VERSION, added: Object.keys(registry.schemas) },
    };
  }

  const registry = structuredClone(loaded.registry);
  const fromVersion = registry.defaults_version || 0;
  if (fromVersion > PAGE_SCHEMA_DEFAULTS_VERSION) {
    throw new Error(`Page schema defaults version ${fromVersion} is newer than this runtime supports (${PAGE_SCHEMA_DEFAULTS_VERSION}).`);
  }
  const added = [];
  let nextVersion = fromVersion;
  while (nextVersion < PAGE_SCHEMA_DEFAULTS_VERSION) {
    nextVersion += 1;
    applyPageSchemaDefaultsMigration(registry, config, nextVersion, added);
  }
  registry.defaults_version = nextVersion;
  const changed = added.length > 0 || fromVersion !== nextVersion;
  if (changed) await writePageSchemaRegistry(config, registry);
  return {
    ...(changed ? await loadPageSchemaRegistry(config, { allowMissing: false }) : loaded),
    migration: { created: false, changed, from_defaults_version: fromVersion, to_defaults_version: PAGE_SCHEMA_DEFAULTS_VERSION, added },
  };
}

function applyPageSchemaDefaultsMigration(registry, config, version, added) {
  if (version !== 1) throw new Error(`Missing page schema defaults migration for version ${version}.`);
  const existingPrefixes = new Set(Object.values(registry.schemas).map((schema) => normalizePathPrefix(schema.path_prefix)).filter(Boolean));
  for (const collection of config.schemaDirs || []) {
    const prefix = normalizePathPrefix(collection);
    if (!prefix || existingPrefixes.has(prefix)) continue;
    const id = schemaIdForPathPrefix(prefix, Object.keys(registry.schemas));
    registry.schemas[id] = compatiblePageSchema(prefix);
    existingPrefixes.add(prefix);
    added.push(id);
  }
}

export async function bootstrapPageSchemaRegistry(config, { overwrite = false } = {}) {
  const loaded = await loadPageSchemaRegistry(config);
  if (loaded.status === 'valid' && !overwrite) return loaded;
  if (loaded.status === 'invalid' && !overwrite) {
    throw new Error(`Page schema registry is invalid: ${loaded.errors.join('; ')}`);
  }
  await writePageSchemaRegistry(config, defaultPageSchemaRegistry());
  return loadPageSchemaRegistry(config, { allowMissing: false });
}

export async function loadPageSchemaRegistry(config, { allowMissing = true } = {}) {
  const filePath = pageSchemaRegistryPath(config);
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return missingRegistryResult(config);
    throw error;
  }

  let source;
  try {
    source = yaml.load(raw);
  } catch (error) {
    return invalidRegistryResult(config, error);
  }
  const parsed = pageSchemaRegistrySchema.safeParse(source);
  if (!parsed.success) return invalidRegistryResult(config, parsed.error);
  return {
    path: filePath,
    registry: parsed.data,
    status: 'valid',
    valid: true,
    errors: [],
  };
}

export async function listPageSchemas(config) {
  const loaded = await requireValidPageSchemaRegistry(config);
  return Object.entries(loaded.registry.schemas)
    .map(([id, definition]) => ({ id, ...definition }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function getPageSchema(config, id) {
  const normalizedId = normalizeSchemaId(id);
  const loaded = await requireValidPageSchemaRegistry(config);
  const definition = loaded.registry.schemas[normalizedId];
  if (!definition) throw new Error(`Page schema not found: ${normalizedId}`);
  return { id: normalizedId, ...definition };
}

export async function registerPageSchema(config, { id, definition } = {}) {
  const normalizedId = normalizeSchemaId(id);
  const loaded = await requireValidPageSchemaRegistry(config);
  if (loaded.registry.schemas[normalizedId]) throw new Error(`Page schema already exists: ${normalizedId}`);
  await writePageSchemaRegistry(config, {
    ...loaded.registry,
    schemas: {
      ...loaded.registry.schemas,
      [normalizedId]: definition,
    },
  });
  return getPageSchema(config, normalizedId);
}

export async function updatePageSchema(config, { id, definition } = {}) {
  const normalizedId = normalizeSchemaId(id);
  const loaded = await requireValidPageSchemaRegistry(config);
  if (!loaded.registry.schemas[normalizedId]) throw new Error(`Page schema not found: ${normalizedId}`);
  await writePageSchemaRegistry(config, {
    ...loaded.registry,
    schemas: {
      ...loaded.registry.schemas,
      [normalizedId]: definition,
    },
  });
  return getPageSchema(config, normalizedId);
}

export async function deletePageSchema(config, { id } = {}) {
  const normalizedId = normalizeSchemaId(id);
  const loaded = await requireValidPageSchemaRegistry(config);
  if (!loaded.registry.schemas[normalizedId]) throw new Error(`Page schema not found: ${normalizedId}`);
  const references = await explicitSchemaReferences(config, normalizedId);
  if (references.length) {
    throw new Error(`Page schema ${normalizedId} is still declared by page(s): ${references.slice(0, 8).join(', ')}.`);
  }
  const schemas = { ...loaded.registry.schemas };
  delete schemas[normalizedId];
  await writePageSchemaRegistry(config, { ...loaded.registry, schemas });
  return { id: normalizedId, deleted: true };
}

export function resolvePageSchema(registry, { pagePath, frontmatter = {} } = {}) {
  const schemas = registry?.schemas || {};
  const explicitId = typeof frontmatter?.page_schema === 'string' ? frontmatter.page_schema.trim() : '';
  if (explicitId) {
    const schema = schemas[explicitId];
    if (!schema) throw new Error(`Page declares unknown page_schema: ${explicitId}`);
    return { id: explicitId, schema, source: 'frontmatter' };
  }

  const relativePath = normalizePagePath(pagePath);
  const matches = Object.entries(schemas)
    .filter(([, schema]) => schema.path_prefix && relativePath.startsWith(`${normalizePathPrefix(schema.path_prefix)}/`))
    .sort(([, left], [, right]) => normalizePathPrefix(right.path_prefix).length - normalizePathPrefix(left.path_prefix).length);
  if (!matches.length) return null;
  const [id, schema] = matches[0];
  return { id, schema, source: 'path_prefix' };
}

export function pageSchemaComplianceIssues(registry, { pagePath, frontmatter = {} } = {}) {
  const normalizedFrontmatter = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
    ? frontmatter
    : {};
  let resolved;
  try {
    resolved = resolvePageSchema(registry, { pagePath, frontmatter: normalizedFrontmatter });
  } catch (error) {
    const declaredSchema = typeof normalizedFrontmatter.page_schema === 'string'
      ? normalizedFrontmatter.page_schema.trim()
      : null;
    return {
      schema: null,
      issues: [{
        type: 'unknown_page_schema',
        details: {
          page_schema: declaredSchema,
          message: error instanceof Error ? error.message : String(error),
        },
      }],
    };
  }
  if (!resolved) return { schema: null, issues: [] };

  const issues = [];
  const schemaFields = resolved.schema.fields || {};
  const additionalProperties = resolved.schema.additional_properties;
  const strictFields = additionalProperties === false
    || (additionalProperties === undefined && Object.keys(schemaFields).length > 0);
  if (strictFields) {
    for (const field of Object.keys(normalizedFrontmatter)) {
      if (PAGE_SCHEMA_RESERVED_FIELDS.has(field) || Object.prototype.hasOwnProperty.call(schemaFields, field)) continue;
      issues.push({
        type: 'schema_field_unknown',
        details: {
          field,
          message: `Frontmatter field ${field} is not declared by schema ${resolved.id}.`,
        },
      });
    }
  }
  for (const [field, definition] of Object.entries(schemaFields)) {
    const present = Object.prototype.hasOwnProperty.call(normalizedFrontmatter, field);
    if (!present) {
      if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
        issues.push({
          type: 'schema_default_missing',
          details: {
            field,
            default_value: definition.default,
            remediation: 'apply_default',
          },
        });
      } else if (definition.required) {
        issues.push({
          type: 'schema_required_field_missing',
          details: { field },
        });
      }
      continue;
    }

    const value = normalizedFrontmatter[field];
    if (definition.type && !matchesSchemaFieldType(value, definition.type)) {
      issues.push({
        type: 'schema_field_type_mismatch',
        details: {
          field,
          expected_type: definition.type,
          actual_type: schemaValueType(value),
        },
      });
      continue;
    }
    if (Array.isArray(definition.enum) && !definition.enum.some((candidate) => Object.is(candidate, value))) {
      issues.push({
        type: 'schema_field_invalid_enum',
        details: {
          field,
          allowed_values: definition.enum,
          actual_value: value,
        },
      });
    }
  }

  return {
    schema: {
      id: resolved.id,
      source: resolved.source,
      path_prefix: resolved.schema.path_prefix || null,
    },
    issues,
  };
}

export async function assertPageSchemaCompliance(config, { pagePath, frontmatter = {} } = {}) {
  const loaded = await loadPageSchemaRegistry(config);
  if (loaded.status === 'missing') {
    const explicitId = typeof frontmatter?.page_schema === 'string' ? frontmatter.page_schema.trim() : '';
    if (explicitId) {
      throw new Error(`Page declares unknown page_schema: ${explicitId}. Initialize or register the Brain schema registry first.`);
    }
    return { schema: null, issues: [], compatibility_mode: true };
  }
  if (!loaded.valid) throw new Error(`Page schema registry is invalid: ${loaded.errors.join('; ')}`);
  const compliance = pageSchemaComplianceIssues(loaded.registry, { pagePath, frontmatter });
  if (!compliance.issues.length) return compliance;
  const schemaLabel = compliance.schema?.id || 'declared page schema';
  const messages = compliance.issues.map((issue) => {
    if (issue.type === 'schema_field_unknown') return `field ${issue.details.field} is not declared`;
    if (issue.type === 'schema_required_field_missing') return `required field ${issue.details.field} is missing`;
    if (issue.type === 'schema_field_type_mismatch') return `field ${issue.details.field} must be ${issue.details.expected_type}`;
    if (issue.type === 'schema_field_invalid_enum') return `field ${issue.details.field} has a value outside the declared enum`;
    if (issue.type === 'schema_default_missing') return `field ${issue.details.field} is missing its declared default`;
    if (issue.type === 'unknown_page_schema') return issue.details.message;
    return issue.details?.message || issue.type;
  });
  throw new Error(`Page ${pagePath} does not comply with schema ${schemaLabel}: ${messages.join('; ')}.`);
}

function missingRegistryResult(config) {
  return {
    path: pageSchemaRegistryPath(config),
    registry: { schema_version: PAGE_SCHEMA_REGISTRY_VERSION, schemas: {} },
    status: 'missing',
    valid: true,
    errors: [],
  };
}

async function requireValidPageSchemaRegistry(config) {
  const loaded = await loadPageSchemaRegistry(config);
  if (loaded.status === 'missing') {
    throw new Error(`Page schema registry is missing: ${PAGE_SCHEMA_REGISTRY_FILENAME}. Initialize or register the Brain schema registry first.`);
  }
  if (!loaded.valid) throw new Error(`Page schema registry is invalid: ${loaded.errors.join('; ')}`);
  return loaded;
}

async function writePageSchemaRegistry(config, registry) {
  const parsed = pageSchemaRegistrySchema.parse(registry);
  const filePath = pageSchemaRegistryPath(config);
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

function defaultTaskFields() {
  return {
    status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'done', 'archived'], default: 'open' },
    priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3'], default: 'p3' },
    readiness: { type: 'string', enum: ['underspecified', 'ready'], default: 'underspecified' },
    execution_mode: { type: 'string', enum: ['agent', 'user', 'interactive'], default: 'agent' },
    assignees: { type: 'array', default: [] },
    source: { type: 'array', default: [] },
    due: { type: 'string' },
  };
}

function normalizeSchemaId(value) {
  const normalized = String(value || '').trim();
  if (!SCHEMA_ID_PATTERN.test(normalized)) throw new Error('Schema ID must be a lowercase hyphenated slug.');
  return normalized;
}

function schemaIdForPathPrefix(prefix, existingIds = []) {
  const base = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pages';
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function invalidRegistryResult(config, error) {
  return {
    path: pageSchemaRegistryPath(config),
    registry: { schema_version: PAGE_SCHEMA_REGISTRY_VERSION, schemas: {} },
    status: 'invalid',
    valid: false,
    errors: [formatError(error)],
  };
}

function normalizePathPrefix(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/');
  if (!normalized || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return null;
  return normalized;
}

function normalizePagePath(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.md$/i, '');
  if (!normalized) throw new Error('pagePath is required to resolve a page schema.');
  return normalized;
}

function matchesSchemaFieldType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

function schemaValueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function formatError(error) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || 'registry'}: ${issue.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

async function explicitSchemaReferences(config, schemaId) {
  const files = [];
  await collectMarkdownFiles(config.brainDir, files);
  const references = [];
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) continue;
    let frontmatter;
    try {
      frontmatter = yaml.load(match[1]);
    } catch {
      continue;
    }
    if (frontmatter?.page_schema === schemaId) {
      references.push(path.relative(config.brainDir, filePath).replace(/\\/g, '/').replace(/\.md$/i, ''));
    }
  }
  return references.sort();
}

async function collectMarkdownFiles(current, files) {
  const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.bigbrain-state' || entry.name === '.raw') continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdownFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
}
