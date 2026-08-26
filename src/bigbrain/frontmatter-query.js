import { sqliteRawDatabase } from './db.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_FILTERS = 32;
const MAX_ORDER_BY = 8;
const MAX_FIELDS = 64;

const FILTER_OPERATORS = new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'exists']);
const VALUE_TYPES = new Set(['string', 'number', 'boolean', 'timestamp']);
const DIRECTIONS = new Set(['asc', 'desc']);
const PAGE_FIELDS = new Set(['slug', 'path', 'type', 'page_kind', 'title', 'summary', 'updated_at']);
const FIELD_PATTERN = /^[A-Za-z0-9_.-]+$/;

export async function queryPagesByFrontmatter({
  db,
  pathPrefix = null,
  type = null,
  filters = [],
  fields = [],
  orderBy = [],
  limit = DEFAULT_LIMIT,
  cursor = 0,
  countOnly = false,
  includeTotal = true,
  asOf = null,
} = {}) {
  if (!db || !['sqlite', 'postgres'].includes(db.backend)) throw new Error('A SQLite or Postgres database is required.');
  const normalized = normalizeQueryInput({ pathPrefix, type, filters, fields, orderBy, limit, cursor, countOnly, includeTotal, asOf });
  const countQuery = buildQuery({ db, normalized, countOnly: true });
  const total = normalized.includeTotal || normalized.countOnly
    ? await executeCount(db, countQuery)
    : null;

  if (normalized.countOnly) {
    return {
      pages: [],
      total,
      next_cursor: null,
      as_of: normalized.asOf,
    };
  }

  const pageQuery = buildQuery({ db, normalized, countOnly: false });
  const rows = await executeRows(db, pageQuery);
  const pageTotal = total === null ? null : Number(total);
  const nextCursor = pageTotal !== null && normalized.cursor + rows.length < pageTotal
    ? normalized.cursor + rows.length
    : null;
  return {
    pages: rows.map((row) => compactPageRecord(row, normalized.fields)),
    total: pageTotal,
    next_cursor: nextCursor,
    as_of: normalized.asOf,
  };
}

function normalizeQueryInput({ pathPrefix, type, filters, fields, orderBy, limit, cursor, countOnly, includeTotal, asOf }) {
  const normalizedPathPrefix = normalizePathPrefix(pathPrefix);
  const normalizedType = type === null || type === undefined || type === '' ? null : requireFieldValue(type, 'type', { stringOnly: true });
  const normalizedFilters = Array.isArray(filters) ? filters.map(normalizeFilter) : (() => { throw new Error('filters must be an array.'); })();
  if (normalizedFilters.length > MAX_FILTERS) throw new Error(`filters cannot contain more than ${MAX_FILTERS} items.`);
  const normalizedFields = Array.isArray(fields) ? fields.map((field) => normalizeField(field, 'fields')) : (() => { throw new Error('fields must be an array.'); })();
  if (normalizedFields.length > MAX_FIELDS) throw new Error(`fields cannot contain more than ${MAX_FIELDS} items.`);
  const normalizedOrderBy = Array.isArray(orderBy) ? orderBy.map(normalizeOrderBy) : (() => { throw new Error('order_by must be an array.'); })();
  if (normalizedOrderBy.length > MAX_ORDER_BY) throw new Error(`order_by cannot contain more than ${MAX_ORDER_BY} items.`);
  const normalizedLimit = normalizeInteger(limit, DEFAULT_LIMIT, 1, MAX_LIMIT, 'limit');
  const normalizedCursor = normalizeInteger(cursor, 0, 0, Number.MAX_SAFE_INTEGER, 'cursor');
  const normalizedAsOf = asOf === null || asOf === undefined || asOf === '' ? null : normalizeTimestamp(asOf, 'as_of');
  return {
    pathPrefix: normalizedPathPrefix,
    type: normalizedType,
    filters: normalizedFilters,
    fields: normalizedFields,
    orderBy: normalizedOrderBy,
    limit: normalizedLimit,
    cursor: normalizedCursor,
    countOnly: Boolean(countOnly),
    includeTotal: includeTotal !== false,
    asOf: normalizedAsOf,
  };
}

function normalizeFilter(filter) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new Error('Each filter must be an object.');
  const field = normalizeField(filter.field, 'filter.field');
  const operator = String(filter.operator ?? filter.op ?? '').trim().toLowerCase();
  if (!FILTER_OPERATORS.has(operator)) throw new Error(`Unsupported filter operator: ${operator || '(missing)'}.`);
  if (operator === 'exists') {
    if (filter.value !== undefined && typeof filter.value !== 'boolean') throw new Error('The exists filter value must be boolean when provided.');
    return { field, operator, value: filter.value === undefined ? true : filter.value, valueType: null };
  }
  if (operator === 'in') {
    if (!Array.isArray(filter.value) || filter.value.length === 0) throw new Error('The in filter requires a non-empty value array.');
    const valueType = normalizeValueType(filter.value_type ?? filter.valueType);
    return { field, operator, value: filter.value.map((value) => normalizeFilterValue(value)), valueType };
  }
  if (!Object.prototype.hasOwnProperty.call(filter, 'value')) throw new Error(`${operator} filters require a value.`);
  const valueType = normalizeValueType(filter.value_type ?? filter.valueType);
  return { field, operator, value: normalizeFilterValue(filter.value), valueType };
}

function normalizeOrderBy(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) throw new Error('Each order_by item must be an object.');
  const field = normalizeField(order.field, 'order_by.field');
  const direction = String(order.direction || 'asc').trim().toLowerCase();
  if (!DIRECTIONS.has(direction)) throw new Error(`Unsupported order_by direction: ${direction}.`);
  return { field, direction, valueType: normalizeValueType(order.value_type ?? order.valueType) };
}

function normalizeField(value, label) {
  const field = String(value ?? '').trim();
  if (!field || !FIELD_PATTERN.test(field) || field === 'frontmatter_json') throw new Error(`${label} must be a simple front-matter or page field name.`);
  return field;
}

function normalizeValueType(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!VALUE_TYPES.has(normalized)) throw new Error(`Unsupported value_type: ${normalized}.`);
  return normalized;
}

function normalizeFilterValue(value) {
  if (value === '$as_of') return value;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('Filter values must be strings, numbers, booleans, or null.');
}

function normalizePathPrefix(value) {
  if (value === null || value === undefined || value === '') return null;
  const prefix = String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '');
  if (!prefix || prefix === '.' || prefix.includes('..') || prefix.includes('\\') || prefix.includes('\0')) {
    throw new Error('path_prefix must be a relative Brain path prefix.');
  }
  if (!/^[A-Za-z0-9_.\/-]+$/.test(prefix)) throw new Error('path_prefix contains unsupported characters.');
  return prefix;
}

function requireFieldValue(value, label, { stringOnly = false } = {}) {
  if (stringOnly && typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = String(value).trim();
  if (!normalized) throw new Error(`${label} is required when provided.`);
  return normalized;
}

function normalizeInteger(value, fallback, minimum, maximum, label) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  return number;
}

function normalizeTimestamp(value, label) {
  const text = String(value).trim();
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error(`${label} must be a valid RFC3339 timestamp.`);
  return new Date(text).toISOString();
}

function buildQuery({ db, normalized, countOnly }) {
  const context = createSqlContext(db.backend);
  const predicates = [];
  if (normalized.pathPrefix) {
    const exact = context.addParam(normalized.pathPrefix);
    const nested = context.addParam(`${normalized.pathPrefix}/%`);
    predicates.push(`(p.slug = ${exact} OR p.slug LIKE ${nested})`);
  }
  if (normalized.type) predicates.push(`p.type = ${context.addParam(normalized.type)}`);
  for (const filter of normalized.filters) predicates.push(buildFilterPredicate(context, filter, normalized.asOf));
  const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
  const select = countOnly
    ? 'SELECT COUNT(*) AS total'
    : 'SELECT p.slug, p.path, p.type, p.page_kind, p.title, p.summary, p.updated_at, p.frontmatter_json';
  const orderBy = countOnly ? '' : buildOrderBy(context, normalized.orderBy);
  const paging = countOnly ? '' : ` LIMIT ${context.addParam(normalized.limit)} OFFSET ${context.addParam(normalized.cursor)}`;
  return {
    text: `${select} FROM pages p ${where}${orderBy}${paging}`,
    params: context.params,
  };
}

function createSqlContext(backend) {
  const params = [];
  return {
    backend,
    params,
    addParam(value) {
      params.push(value);
      return backend === 'postgres' ? `$${params.length}` : '?';
    },
  };
}

function buildFilterPredicate(context, filter, asOf) {
  const field = pageFieldExpression(filter.field, context);
  if (filter.operator === 'exists') {
    const exists = pageFieldExistsExpression(filter.field, context);
    return filter.value ? exists : `(NOT ${exists})`;
  }

  const exists = pageFieldExistsExpression(filter.field, context);
  if (filter.operator === 'in') {
    const typedField = typedExpression(field, filter.valueType, filter.value);
    const placeholders = filter.value.map((value) => context.addParam(typedValue(sqlValue(value, asOf), filter.valueType, value)));
    return `(${exists} AND ${typedField} IN (${placeholders.join(', ')}))`;
  }

  const value = sqlValue(filter.value, asOf);
  if (value === null) {
    if (filter.operator === 'eq') return `(${exists} AND ${field} IS NULL)`;
    if (filter.operator === 'neq') return `(${exists} AND ${field} IS NOT NULL)`;
    throw new Error(`${filter.operator} cannot compare with null.`);
  }

  const operator = {
    eq: '=',
    neq: '<>',
    lt: '<',
    lte: '<=',
    gt: '>',
    gte: '>=',
  }[filter.operator];
  const typedField = typedExpression(field, filter.valueType, filter.value);
  return `(${exists} AND ${typedField} ${operator} ${context.addParam(typedValue(value, filter.valueType, filter.value))})`;
}

function buildOrderBy(context, orderBy) {
  const items = orderBy.length ? orderBy : [{ field: 'slug', direction: 'asc', valueType: null }];
  const clauses = items.map((order) => {
    const expression = pageFieldExpression(order.field, context);
    const typed = typedExpression(expression, order.valueType, null);
    return `${typed} ${order.direction.toUpperCase()} NULLS LAST`;
  });
  if (!items.some((order) => order.field === 'slug')) clauses.push('p.slug ASC');
  return ` ORDER BY ${clauses.join(', ')}`;
}

function pageFieldExpression(field, context) {
  if (PAGE_FIELDS.has(field)) return `p.${field}`;
  if (context.backend === 'postgres') {
    return `(p.frontmatter_json ->> ${context.addParam(field)})`;
  }
  const path = jsonPath(field);
  return `(CASE json_type(p.frontmatter_json, '${path}')
    WHEN 'true' THEN 'true'
    WHEN 'false' THEN 'false'
    WHEN 'null' THEN NULL
    ELSE CAST(json_extract(p.frontmatter_json, '${path}') AS TEXT)
  END)`;
}

function pageFieldExistsExpression(field, context) {
  if (PAGE_FIELDS.has(field)) return `p.${field} IS NOT NULL`;
  if (context.backend === 'postgres') return `(p.frontmatter_json ? ${context.addParam(field)})`;
  return `json_type(p.frontmatter_json, '${jsonPath(field)}') IS NOT NULL`;
}

function typedExpression(expression, valueType, value) {
  if (valueType === 'number' || (valueType === null && (typeof value === 'number' || (Array.isArray(value) && value.some((item) => typeof item === 'number'))))) return `CAST(${expression} AS REAL)`;
  return expression;
}

function typedValue(value, valueType, originalValue) {
  if (valueType === 'number' || (valueType === null && typeof originalValue === 'number')) return Number(value);
  return value;
}

function sqlValue(value, asOf) {
  if (value === '$as_of') return asOf || (() => { throw new Error('The $as_of filter value requires as_of.'); })();
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function jsonPath(field) {
  return `$.${JSON.stringify(field)}`;
}

async function executeCount(db, query) {
  if (db.backend === 'postgres') {
    const result = await db.query(query.text, query.params);
    return Number(result.rows[0]?.total || 0);
  }
  const raw = sqliteRawDatabase(db);
  return Number(raw.prepare(query.text).get(...query.params)?.total || 0);
}

async function executeRows(db, query) {
  if (db.backend === 'postgres') return (await db.query(query.text, query.params)).rows;
  const raw = sqliteRawDatabase(db);
  return raw.prepare(query.text).all(...query.params);
}

function compactPageRecord(row, fields) {
  const frontmatter = parseFrontmatterJson(row.frontmatter_json);
  const selectedFrontmatter = fields.length
    ? Object.fromEntries(fields.filter((field) => !PAGE_FIELDS.has(field) && Object.prototype.hasOwnProperty.call(frontmatter, field)).map((field) => [field, frontmatter[field]]))
    : frontmatter;
  return {
    slug: row.slug,
    path: row.path,
    type: row.type,
    page_kind: row.page_kind,
    title: row.title,
    summary: row.summary,
    updated_at: normalizeOutputTimestamp(row.updated_at),
    frontmatter: selectedFrontmatter,
  };
}

function parseFrontmatterJson(value) {
  if (value && typeof value === 'object') return value;
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeOutputTimestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}
