import fs from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod';

import { CANONICAL_SCHEMA_DIRS } from './constants.js';

export const PAGE_SCHEMA_REGISTRY_FILENAME = 'page-schemas.yaml';
export const PAGE_SCHEMA_REGISTRY_VERSION = 1;

const SCHEMA_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object'];
const DEFAULT_SCHEMA_DESCRIPTIONS = {
  articles: 'Published online articles, Substack posts, newsletters, and other durable source publications.',
  people: 'Canonical pages for people and relationship context.',
  organizations: 'Canonical pages for organizations and institutions.',
  deals: 'Canonical pages for transactions and deal work.',
  projects: 'Canonical pages for active workstreams and execution.',
  ideas: 'Canonical pages for unbuilt possibilities.',
  meetings: 'Canonical pages for meetings, preparation, and decisions.',
  tasks: 'Assignable work items with task-specific frontmatter.',
  concepts: 'Canonical pages for reusable mental models and frameworks.',
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
  description: z.string().trim().min(1).optional(),
}).passthrough();

export const pageSchemaRegistrySchema = z.object({
  schema_version: z.literal(PAGE_SCHEMA_REGISTRY_VERSION),
  schemas: z.record(z.string(), pageSchemaDefinitionSchema),
}).superRefine((value, context) => {
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

export function defaultPageSchemaRegistry() {
  return {
    schema_version: PAGE_SCHEMA_REGISTRY_VERSION,
    schemas: Object.fromEntries(CANONICAL_SCHEMA_DIRS.map((collection) => [collection, {
      path_prefix: collection,
      description: DEFAULT_SCHEMA_DESCRIPTIONS[collection] || `Canonical pages under ${collection}/.`,
      fields: collection === 'tasks' ? defaultTaskFields() : collection === 'articles' ? defaultArticleFields() : {},
    }])),
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
  };
}

export async function ensurePageSchemaRegistry(config) {
  return bootstrapPageSchemaRegistry(config);
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
  for (const [field, definition] of Object.entries(resolved.schema.fields || {})) {
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
