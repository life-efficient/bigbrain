import fs from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod';

export const PAGE_SCHEMA_REGISTRY_FILENAME = 'page-schemas.yaml';
export const PAGE_SCHEMA_REGISTRY_VERSION = 1;

const SCHEMA_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object'];

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

function missingRegistryResult(config) {
  return {
    path: pageSchemaRegistryPath(config),
    registry: { schema_version: PAGE_SCHEMA_REGISTRY_VERSION, schemas: {} },
    status: 'missing',
    valid: true,
    errors: [],
  };
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

function formatError(error) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || 'registry'}: ${issue.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
