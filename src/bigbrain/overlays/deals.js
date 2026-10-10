import { queryPagesByFrontmatter } from '../frontmatter-query.js';
import { sqliteRawDatabase } from '../db.js';

export const DEALS_OVERLAY_ID = 'deals';
export const DEALS_INVOLVEMENTS = Object.freeze(['active', 'network_actionable', 'network_observed']);

// This overlay is derived from the owning Brain's page index. Enrollment is
// explicit so public transactions and supporting material do not enter it.
export async function buildDealsPayload(config, db, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput('Deals input must be an object.');
  const limit = integer(input.limit, 100, 1, 100, 'limit');
  const cursor = integer(input.cursor, 0, 0, Number.MAX_SAFE_INTEGER, 'cursor');
  const involvement = input.deal_involvement;
  if (involvement !== undefined && !DEALS_INVOLVEMENTS.includes(involvement)) {
    throw invalidInput(`deal_involvement must be one of ${DEALS_INVOLVEMENTS.join(', ')}.`);
  }
  const result = await queryPagesByFrontmatter({
    db,
    pathPrefix: 'deals',
    type: 'deals',
    filters: [
      { field: 'page_kind', operator: 'eq', value: 'canonical' },
      { field: 'deal_involvement', operator: 'in', value: involvement ? [involvement] : [...DEALS_INVOLVEMENTS] },
    ],
    fields: ['deal_involvement'],
    orderBy: [{ field: 'title', direction: 'asc' }],
    limit,
    cursor,
  });
  const missing = result.pages.filter((page) => !page.summary?.trim()).map((page) => page.slug);
  const fallback = await indexedFallbacks(db, missing);
  return {
    overlay: { id: DEALS_OVERLAY_ID, name: 'Deals', schema_version: 1, enabled: true },
    brain: { brain_id: config.brainId, brain_name: config.brainName },
    records: result.pages.map((page) => ({
      page_slug: page.slug,
      title: page.title,
      summary: page.summary?.trim() || readableSummary(fallback.get(page.slug)),
      deal_involvement: page.frontmatter.deal_involvement,
      updated_at: page.updated_at,
    })),
    total: result.total,
    next_cursor: result.next_cursor,
  };
}

function integer(value, fallback, minimum, maximum, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidInput(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function invalidInput(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function readableSummary(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= 500) return text;
  const clipped = text.slice(0, 497);
  const boundary = clipped.lastIndexOf(' ');
  return `${boundary > 400 ? clipped.slice(0, boundary) : clipped}...`;
}

async function indexedFallbacks(db, slugs) {
  if (!slugs.length) return new Map();
  // Fetch bounded plain text only for the current result page, never source files.
  const placeholders = slugs.map((_, index) => db.backend === 'postgres' ? `$${index + 1}` : '?');
  const sql = `SELECT slug, substr(body_text, 1, 2000) AS excerpt FROM pages WHERE slug IN (${placeholders.join(', ')})`;
  const rows = db.backend === 'postgres'
    ? (await db.query(sql, slugs)).rows
    : sqliteRawDatabase(db).prepare(sql).all(...slugs);
  return new Map(rows.map((row) => [row.slug, row.excerpt]));
}
