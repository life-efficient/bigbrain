import { randomUUID } from 'node:crypto';
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
    fields: ['deal_involvement', 'anonymised_title', 'anonymised_asks', 'anonymised_description', 'asks', 'teaser_summary'],
    orderBy: [{ field: 'title', direction: 'asc' }],
    limit,
    cursor,
  });
  const missing = result.pages.filter((page) => !page.summary?.trim()).map((page) => page.slug);
  const fallback = await indexedFallbacks(db, missing);
  return {
    overlay: { id: DEALS_OVERLAY_ID, name: 'Deals', schema_version: 2, enabled: true },
    brain: { brain_id: config.brainId, brain_name: config.brainName },
    records: result.pages.map((page) => ({
      page_slug: page.slug,
      title: page.title,
      summary: page.summary?.trim() || readableSummary(fallback.get(page.slug)),
      deal_involvement: page.frontmatter.deal_involvement,
      ...anonymisedDealFields(page.frontmatter),
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

export async function updateDealAsks(config, db, input, { actor = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput('Deal ask input must be an object.');
  if (actor?.scopes && !actor.scopes.some((scope) => ['brain:admin', 'brain:write'].includes(scope))) {
    throw Object.assign(new Error('Deal ask editing requires write access.'), { statusCode: 403 });
  }
  const slug = input.page_slug;
  if (typeof slug !== 'string' || !/^deals\/(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\.raw(?:\/|$))[^\\?#]+$/.test(slug) || slug.endsWith('.md') || slug.endsWith('/')) {
    throw invalidInput('page_slug must be a canonical deal slug.');
  }
  const asks = validateAsks(input.anonymised_asks, 'anonymised_asks');
  const expectedAsks = validateAsks(input.expected_anonymised_asks, 'expected_anonymised_asks');
  if (typeof input.expected_anonymised_description !== 'string') throw invalidInput('expected_anonymised_description is required.');
  if (input.anonymised_description !== undefined && typeof input.anonymised_description !== 'string') throw invalidInput('anonymised_description must be a string.');
  if ((input.anonymised_description?.length || 0) > 20000) throw invalidInput('anonymised_description is too long.');
  if (typeof input.expected_anonymised_title !== 'string') throw invalidInput('expected_anonymised_title is required.');
  if (input.anonymised_title !== undefined && (typeof input.anonymised_title !== 'string' || input.anonymised_title.length > 500)) throw invalidInput('anonymised_title must be a string of up to 500 characters.');
  const { updateBrainPage } = await import('../page-ops.js');
  let page;
  try {
    const timelineText = 'Updated anonymous deal asks and teaser from dashboard.';
    page = await updateBrainPage({ config, pagePath: slug,
      timelineEntry: timelineText,
      timelineSignificance: 'patch',
      timelineProvenance: { event_id: `dashboard:deal-anonymised_asks:${slug}:${randomUUID()}`,
        source_type: 'direct_edit', source_label: actor?.email ? `BigBrain dashboard (${actor.email})` : 'BigBrain dashboard',
        source_message: timelineText },
      frontmatterValues: { anonymised_asks: asks, ...(input.anonymised_title === undefined ? {} : { anonymised_title: input.anonymised_title.trim() }), ...(input.anonymised_description === undefined ? {} : { anonymised_description: input.anonymised_description.trim() }) },
      validateExisting(existing) {
        if (existing.type !== 'deals' || !DEALS_INVOLVEMENTS.includes(existing.frontmatter.deal_involvement)) {
          throw Object.assign(new Error('Page is not enrolled in the Deals overlay.'), { statusCode: 404 });
        }
        const current = anonymisedDealFields(existing.frontmatter);
        if (JSON.stringify(current.anonymised_asks) !== JSON.stringify(expectedAsks) || current.anonymised_description !== input.expected_anonymised_description.trim() || current.anonymised_title !== input.expected_anonymised_title.trim()) {
          throw Object.assign(new Error('This deal changed since you opened it. Refresh before saving your edits.'), { statusCode: 409 });
        }
      },
    });
  } catch (error) {
    if (error.code === 'ENOENT') error.statusCode = 404;
    throw error;
  }
  // Loaded lazily because the dashboard and MCP server already depend on each other.
  // Reuse the owning page API's index, persisted state and configured Git backup.
  const { postWriteMaintenance } = await import('../mcp-server.js');
  let maintenanceWarning = null;
  try {
    await postWriteMaintenance(config, process.env.BIGBRAIN_MCP_GIT_BACKUP === '1', actor, `Update deal asks for ${page.title}`);
  } catch (error) {
    maintenanceWarning = `Edits were saved to the page, but index or backup maintenance needs attention: ${error.message}`;
  }
  const payload = await buildDealsPayload(config, db, { limit: 100 });
  let record = payload.records.find((item) => item.page_slug === slug);
  for (let cursor = payload.next_cursor; !record && cursor !== null;) {
    const batch = await buildDealsPayload(config, db, { limit: 100, cursor });
    record = batch.records.find((item) => item.page_slug === slug);
    cursor = batch.next_cursor;
  }
  record = { ...(record || { page_slug: slug, title: page.title, summary: page.summary,
    deal_involvement: page.frontmatter.deal_involvement }),
    ...anonymisedDealFields(page.frontmatter) };
  return { record, ...(maintenanceWarning ? { maintenance_warning: maintenanceWarning } : {}) };
}

function normalizedAsks(value) {
  return Array.isArray(value) ? value.filter((ask) => typeof ask === 'string' && ask.trim()).map((ask) => ask.trim()) : [];
}
function validateAsks(value, field) {
  if (!Array.isArray(value) || value.length > 100 || value.some((ask) => typeof ask !== 'string' || !ask.trim() || ask.length > 5000)) {
    throw invalidInput(`${field} must be a list of up to 100 nonempty strings.`);
  }
  return value.map((ask) => ask.trim());
}

function anonymisedDealFields(frontmatter) {
  // Existing pages remain readable during migration. Explicit canonical values,
  // including empty ones, always win over legacy data. Never use internal text.
  const field = (key, legacy) => Object.hasOwn(frontmatter, key) ? frontmatter[key] : frontmatter[legacy];
  const description = field('anonymised_description', 'teaser_summary');
  return {
    anonymised_title: typeof frontmatter.anonymised_title === 'string' ? frontmatter.anonymised_title.trim() : '',
    anonymised_description: typeof description === 'string' ? description.trim() : '',
    anonymised_asks: normalizedAsks(field('anonymised_asks', 'asks')),
  };
}
