import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { dealMetadataSchema } from '../deal-schema.js';
import { parseMarkdownPage } from '../markdown.js';
import { queryPagesByFrontmatter } from '../frontmatter-query.js';
import { sqliteRawDatabase, replacePageIndex } from '../db.js';

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
    fields: ['deal_types', 'deal_stage', 'stage_as_of', 'deal_involvement', 'anonymised_title', 'anonymised_asks', 'anonymised_description', 'asks', 'teaser_summary'],
    orderBy: [{ field: 'title', direction: 'asc' }],
    limit,
    cursor,
  });
  const missing = result.pages.filter((page) => !page.summary?.trim()).map((page) => page.slug);
  const fallback = await indexedFallbacks(db, missing);
  const related = await relatedCommercialPages(db, result.pages.map(page => page.slug));
  return {
    overlay: { id: DEALS_OVERLAY_ID, name: 'Deals', schema_version: 3, enabled: true },
    brain: { brain_id: config.brainId, brain_name: config.brainName },
    records: result.pages.map((page) => ({
      page_slug: page.slug,
      title: page.title,
      summary: page.summary?.trim() || readableSummary(fallback.get(page.slug)),
      deal_involvement: page.frontmatter.deal_involvement,
      deal_types: stringList(page.frontmatter.deal_types),
      deal_stage: page.frontmatter.deal_stage || 'unknown',
      stage_as_of: page.frontmatter.stage_as_of || null,
      introductions: related.introductions.get(page.slug) || [],
      tasks: related.tasks.get(page.slug) || [],
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

export async function updateDealStage(config, db, input, { actor = null, indexPage = replacePageIndex } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput('Deal stage input must be an object.');
  if (actor?.scopes && !actor.scopes.some(scope => ['brain:admin', 'brain:write'].includes(scope))) {
    throw Object.assign(new Error('Changing deal stages requires write access.'), { statusCode: 403 });
  }
  const slug = input.page_slug;
  if (typeof slug !== 'string' || !/^deals\/(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\.raw(?:\/|$))[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(slug) || slug.endsWith('/') || slug.includes('//')) {
    throw invalidInput('page_slug must be a canonical deal slug.');
  }
  const stageSchema = dealMetadataSchema.shape.deal_stage.unwrap();
  if (!stageSchema.safeParse(input.deal_stage).success) throw invalidInput('deal_stage must be a supported deal stage.');
  if (typeof input.expected_deal_stage !== 'string' || !input.expected_deal_stage || input.expected_deal_stage.length > 100) throw invalidInput('expected_deal_stage is required.');
  if (!Object.hasOwn(input, 'expected_stage_as_of') || (input.expected_stage_as_of !== null && (typeof input.expected_stage_as_of !== 'string' || !dealMetadataSchema.shape.stage_as_of.safeParse(input.expected_stage_as_of).success))) {
    throw invalidInput('expected_stage_as_of must be the previously read date or null.');
  }
  const stageAsOf = new Date().toISOString();
  const timelineText = `Manually changed deal stage from ${input.expected_deal_stage} to ${input.deal_stage} in the Deals board.`;
  const noChange = Symbol('no stage change');
  const { updateBrainPage } = await import('../page-ops.js');
  let page;
  let changed = false;
  let maintenanceWarning = null;
  try {
    page = await updateBrainPage({ config, pagePath: slug,
      frontmatterValues: { deal_stage: input.deal_stage, stage_as_of: stageAsOf },
      timelineEntry: timelineText, timelineSignificance: 'minor',
      timelineProvenance: { event_id: `dashboard:deal-stage:${slug}:${randomUUID()}`, source_type: 'direct_edit',
        source_label: actor?.email ? `BigBrain dashboard (${actor.email})` : 'BigBrain dashboard', source_message: timelineText },
      validateExisting(existing) {
        if (existing.type !== 'deals' || !DEALS_INVOLVEMENTS.includes(existing.frontmatter.deal_involvement)) throw Object.assign(new Error('Page is not enrolled in the Deals overlay.'), { statusCode: 404 });
        if ((existing.frontmatter.deal_stage || 'unknown') !== input.expected_deal_stage || (existing.frontmatter.stage_as_of || null) !== input.expected_stage_as_of) {
          throw Object.assign(new Error('This deal stage changed elsewhere. Refresh the board before moving it.'), { statusCode: 409 });
        }
        // Exit under the write lock before any file, date or timeline mutation.
        if ((existing.frontmatter.deal_stage || 'unknown') === input.deal_stage) throw { marker: noChange, page: existing };
      },
      async afterWrite(saved) {
        try {
          const parsed = parseMarkdownPage(saved.markdown, slug);
          await indexPage(db, { ...parsed, path: path.join(config.brainDir, saved.path), pageKind: 'canonical',
            contentHash: createHash('sha256').update(saved.markdown).digest('hex'), updatedAt: stageAsOf });
        } catch {
          maintenanceWarning = 'The stage was saved, but index maintenance needs attention. Refresh before another move.';
        }
      },
    });
    changed = true;
  } catch (error) {
    if (error.marker === noChange) page = error.page;
    else { if (error.code === 'ENOENT') error.statusCode = 404; throw error; }
  }
  if (changed && process.env.BIGBRAIN_MCP_GIT_BACKUP === '1') {
    try {
      const { postWriteMaintenance } = await import('../mcp-server.js');
      await postWriteMaintenance(config, true, actor, `Change deal stage for ${page.title}`);
    } catch {
      maintenanceWarning = 'The stage was saved, but index or backup maintenance needs attention. Refresh before another move.';
    }
  }
  let record;
  try {
    for (let cursor = 0; cursor !== null && !record;) {
      const batch = await buildDealsPayload(config, db, { limit: 100, cursor });
      record = batch.records.find(item => item.page_slug === slug);
      cursor = batch.next_cursor;
    }
  } catch {
    maintenanceWarning ||= 'The stage was saved, but the updated board could not be loaded. Refresh before another move.';
  }
  return { record: { ...(record || { page_slug: slug }),
    title: page.title, summary: page.summary, deal_involvement: page.frontmatter.deal_involvement,
    deal_types: stringList(page.frontmatter.deal_types), ...anonymisedDealFields(page.frontmatter),
    deal_stage: page.frontmatter.deal_stage || 'unknown', stage_as_of: page.frontmatter.stage_as_of || null,
    ...(changed ? { updated_at: stageAsOf } : {}) }, ...(maintenanceWarning ? { maintenance_warning: maintenanceWarning } : {}) };
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


function stringList(value) {
  return Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().replace(/\.md$/, '')) : [];
}

async function allIndexedPages(db, pathPrefix, fields) {
  const result = [];
  let cursor = 0;
  do {
    const page = await queryPagesByFrontmatter({ db, pathPrefix, type: pathPrefix,
      filters: [{ field: 'page_kind', operator: 'eq', value: 'canonical' }], fields,
      orderBy: [{ field: 'title', direction: 'asc' }], limit: 100, cursor });
    result.push(...page.pages);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return result;
}

async function relatedCommercialPages(db, dealSlugs, selectedIntroductions = null) {
  const introductions = new Map();
  const tasks = new Map();
  if (!dealSlugs.length && !selectedIntroductions?.length) return { introductions, tasks };
  const selectedDeals = new Set(dealSlugs);
  const introPages = selectedIntroductions || (await allIndexedPages(db, 'deal_introductions', ['deal', 'parties', 'purpose', 'stage', 'stage_as_of']))
    .filter(p => selectedDeals.has(p.frontmatter.deal));
  const owners = new Set([...dealSlugs, ...introPages.map(p => p.slug)]);
  const taskPages = (await allIndexedPages(db, 'tasks', ['source', 'status', 'assignees', 'waiting_on', 'due']))
    .filter(p => !['done', 'archived'].includes(p.frontmatter.status) && stringList(p.frontmatter.source).some(s => owners.has(s)));
  const referenceSlugs = [...new Set([
    ...introPages.flatMap(p => stringList(p.frontmatter.parties)),
    ...taskPages.flatMap(p => [...stringList(p.frontmatter.assignees), ...stringList(p.frontmatter.waiting_on)]),
  ])];
  const titles = new Map();
  // Bounded batches avoid SQLite parameter limits on large deal networks.
  for (let start = 0; start < referenceSlugs.length; start += 100) {
    const refs = referenceSlugs.slice(start, start + 100);
    const result = await queryPagesByFrontmatter({ db, filters: [{ field: 'slug', operator: 'in', value: refs }], fields: [], limit: 100 });
    for (const p of result.pages) titles.set(p.slug, p.title);
  }
  const references = values => stringList(values).map(page_slug => ({ page_slug, title: titles.get(page_slug) || page_slug }));
  for (const p of taskPages) {
    const record = { page_slug: p.slug, title: p.title, status: p.frontmatter.status || 'open',
      assignees: references(p.frontmatter.assignees), waiting_on: references(p.frontmatter.waiting_on), due: p.frontmatter.due || null };
    for (const owner of new Set(stringList(p.frontmatter.source))) {
      if (!owners.has(owner)) continue;
      if (!tasks.has(owner)) tasks.set(owner, []);
      tasks.get(owner).push(record);
    }
  }
  for (const p of introPages) {
    const record = { page_slug: p.slug, title: p.title, summary: p.summary || '', deal: p.frontmatter.deal,
      parties: references(p.frontmatter.parties), purpose: p.frontmatter.purpose || '', stage: p.frontmatter.stage || 'unknown',
      stage_as_of: p.frontmatter.stage_as_of || null, updated_at: p.updated_at, tasks: tasks.get(p.slug) || [] };
    if (!introductions.has(record.deal)) introductions.set(record.deal, []);
    introductions.get(record.deal).push(record);
  }
  return { introductions, tasks };
}


export async function buildDealIntroductionsPayload(config, db, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput('Introductions input must be an object.');
  const limit = integer(input.limit, 100, 1, 100, 'limit');
  const cursor = integer(input.cursor, 0, 0, Number.MAX_SAFE_INTEGER, 'cursor');
  const result = await queryPagesByFrontmatter({ db, pathPrefix: 'deal_introductions', type: 'deal_introductions',
    filters: [{ field: 'page_kind', operator: 'eq', value: 'canonical' }],
    fields: ['deal', 'parties', 'purpose', 'stage', 'stage_as_of'],
    orderBy: [{ field: 'title', direction: 'asc' }], limit, cursor });
  const parentSlugs = [...new Set(result.pages.map(p => p.frontmatter.deal).filter(Boolean))];
  const parents = parentSlugs.length ? await queryPagesByFrontmatter({ db,
    filters: [{ field: 'slug', operator: 'in', value: parentSlugs }], fields: [], limit: 100 }) : { pages: [] };
  const parentTitles = new Map(parents.pages.map(p => [p.slug, p.title]));
  const related = await relatedCommercialPages(db, parentSlugs, result.pages);
  const recordsBySlug = new Map([...related.introductions.values()].flat().map(p => [p.page_slug, p]));
  return { records: result.pages.map(p => ({ ...recordsBySlug.get(p.slug),
    parent_deal: { page_slug: p.frontmatter.deal || '', title: parentTitles.get(p.frontmatter.deal) || p.frontmatter.deal || 'Parent deal not recorded' },
  })), total: result.total, next_cursor: result.next_cursor };
}
