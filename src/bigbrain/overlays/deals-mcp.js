import { buildDealIntroductionsPayload, updateDealAsks, updateDealDetails, updateDealStage, updateDealStatus, updateIntroductionArrangement, updateIntroductionStage } from './deals.js';
import { buildDealsPdf, readAnonymisedDeals } from './deals-pdf.js';
import { DEAL_STAGES, INTRODUCTION_STAGES, dealMetadataFields, dealIntroductionFields } from '../deal-schema.js';

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const text = description => ({ type: 'string', description });
const slug = { type: 'string', description: 'Canonical enrolled deals/ or deal_introductions/ page slug, without .md. Read the current record before editing.' };
const status = { type: 'string', enum: ['active', 'archived'] };
const arrangement = { type: 'string', enum: ['none', 'establishing', 'agreed'], description: 'Facilitation arrangement, independent of commercial stage. none means not recorded; agreed requires evidence of agreement, not a draft.' };
const expectedDate = { type: ['string', 'null'], description: 'Exact stage_as_of from the last read, or null when absent. Used to reject stale writes.' };
const snapshotStage = text('Exact stage from the last read, including unknown. Used to reject stale writes.');
function field(schema, name) { const { required, ...definition } = schema[name]; return definition; }
const dealFields = dealMetadataFields();
const introFields = dealIntroductionFields();
const anonymous = { anonymised_stage_comment: { ...field(dealFields, 'anonymised_stage_comment'), maxLength: 20000 }, anonymised_title: { ...field(dealFields, 'anonymised_title'), maxLength: 500 }, anonymised_description: { ...field(dealFields, 'anonymised_description'), maxLength: 20000 }, anonymised_asks: { ...field(dealFields, 'anonymised_asks'), maxItems: 100 } };
const dealValues = object({ title: { type: 'string', minLength: 1, maxLength: 500, description: 'Internal title. This is not used in anonymised exports.' }, summary: { type: 'string', maxLength: 20000, description: 'Internal deal description. This is not used in anonymised exports.' }, ...anonymous }, ['title', 'summary', 'anonymised_title', 'anonymised_description', 'anonymised_asks']);
const introductionValues = object({ title: { type: 'string', minLength: 1, maxLength: 500 }, purpose: { ...field(introFields, 'purpose'), maxLength: 20000 }, arrangement_status: arrangement });
const pagination = object({ limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 }, cursor: { type: 'integer', minimum: 0, description: 'Offset returned as next_cursor. Follow until null for complete coverage.' } }, []);
const operations = [
  { action: 'introductions', description: 'Read all canonical deal introductions, independently of parent deal enrollment. Returns parent, parties, purpose, arrangement, stage, status, edit_values and linked next actions. Follow next_cursor to retrieve every page. Active status alone does not mean actively fundraising.', schema: pagination, read: true, run: buildDealIntroductionsPayload },
  { action: 'update_details', description: 'Edit a deal internal title/description and anonymised title/description/asks, or an introduction title/purpose/arrangement. Copy the complete edit_values from the latest read into expected_values; supply the complete replacement values of the same shape. When changing the stage comment, also send expected_deal_stage and expected_stage_as_of from the latest read. Rejects stale edits atomically and preserves unrelated fields and page content.', schema: object({ page_slug: slug, expected_deal_stage: snapshotStage, expected_stage_as_of: expectedDate, values: { oneOf: [dealValues, introductionValues] }, expected_values: { oneOf: [dealValues, introductionValues], description: 'Exact complete edit_values snapshot from the last read, not displayed fallback text.' } }, ['page_slug', 'values', 'expected_values']), run: updateDealDetails },
  { action: 'update_stage', description: 'Move an active deal to an evidence-supported commercial stage, independent of its introductions. Sets stage_as_of to the current manual transition time and clears the previous anonymised stage comment so outdated progress is not shared. Requires prior stage/status/date; archived deals cannot move. To identify active fundraising, consider capital_raise type and an active search stage, not active status alone.', schema: object({ page_slug: slug, deal_stage: { type: 'string', enum: DEAL_STAGES }, expected_deal_stage: snapshotStage, expected_deal_status: status, expected_stage_as_of: expectedDate }), run: updateDealStage },
  { action: 'introductions/update_stage', description: 'Move an active deal introduction to its own evidence-supported stage. Keeps parent deal and facilitation arrangement unchanged. Sets stage_as_of to the current manual transition time; rejects stale snapshots and archived introductions.', schema: object({ page_slug: slug, stage: { type: 'string', enum: INTRODUCTION_STAGES }, expected_stage: snapshotStage, expected_introduction_status: status, expected_stage_as_of: expectedDate }), run: updateIntroductionStage },
  { action: 'update_status', description: 'Archive or restore one deal or introduction. Preserves commercial stage and evidence date. Does not cascade to its parent, introductions or tasks. Requires the exact previously read status, stage and stage_as_of.', schema: object({ page_slug: slug, status, expected_status: status, expected_stage: snapshotStage, expected_stage_as_of: expectedDate }), run: updateDealStatus },
  { action: 'introductions/update_arrangement', description: 'Change the recorded facilitation arrangement for one introduction: none, establishing or agreed. Independent of commercial stage. Requires evidence for agreed and the prior arrangement status; rejects stale edits.', schema: object({ page_slug: slug, arrangement_status: arrangement, expected_arrangement_status: arrangement }), run: updateIntroductionArrangement },
  { action: 'update_asks', description: 'Replace anonymised asks and optionally anonymised title, description or stage comment. Asks are evidence-backed contributions sought from NEW participants, not documents or replies owed by existing parties; use linked tasks for those. Empty asks are valid. Follow the shared field descriptions: remove names while retaining concrete commercial requirements. Provide all three prior anonymised fields for concurrency, plus the prior comment, expected_deal_stage and expected_stage_as_of when changing the comment; never invent claims.', schema: object({ page_slug: slug, expected_deal_stage: snapshotStage, expected_stage_as_of: expectedDate, ...anonymous, expected_anonymised_stage_comment: text('Exact previously read anonymised_stage_comment; required when changing that field.'), expected_anonymised_title: text('Exact previously read anonymised_title.'), expected_anonymised_description: text('Exact previously read anonymised_description.'), expected_anonymised_asks: anonymous.anonymised_asks }, ['page_slug', 'anonymised_asks', 'expected_anonymised_title', 'expected_anonymised_description', 'expected_anonymised_asks']), run: updateDealAsks },
  { action: 'export', description: 'Export prepared anonymised titles, descriptions, stage labels, stage comments and asks for active enrolled shareable deals without further generalising their commercial substance. Omit page_slugs for every active deal; provide a nonempty list for exactly those selected deals. Invalid, missing, archived or incomplete selected deals fail rather than falling back. JSON is returned by default; PDF returns an embedded application/pdf MCP resource. Does not publish, send, change visibility or save a Brain file.', schema: object({ page_slugs: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Exact selected canonical deal slugs; omit for all active enrolled deals.' }, format: { type: 'string', enum: ['json', 'pdf'], default: 'json' } }, []), read: true },
];
const names = operation => [`overlays/deals/${operation.action}`, `overlays_deals_${operation.action.replaceAll('/', '_')}`];
const byName = new Map(operations.flatMap(operation => names(operation).map(name => [name, operation])));
export const dealsMcpMutationNames = operations.filter(operation => !operation.read).flatMap(names);
export const dealsMcpPolicies = Object.fromEntries([...byName].map(([name, operation]) => [name, { layer: operation.read ? 'read' : 'create', scopes: [operation.read ? 'brain:read' : 'brain:write'] }]));
export function isDealsMcpTool(name) { return byName.has(name); }
export function dealsMcpToolDefinitions(mutationProperties) {
  return operations.flatMap(operation => names(operation).map((name, index) => ({ name,
    description: index ? `Alias for ${names(operation)[0]} for clients that do not support slash tool names. ${operation.description}` : operation.description,
    inputSchema: operation.read ? operation.schema : { ...operation.schema, properties: { ...operation.schema.properties, ...mutationProperties }, required: [...operation.schema.required, 'commit_message', 'provenance'] },
    annotations: { readOnlyHint: !!operation.read, destructiveHint: !operation.read, openWorldHint: false },
  })));
}
export async function executeDealsMcpTool(name, config, db, args, options, toolJson) {
  const operation = byName.get(name);
  if (operation.action === 'export') {
    if (args.format !== undefined && !['json', 'pdf'].includes(args.format)) throw new Error('format must be json or pdf.');
    if (args.format === 'pdf') {
      const pdf = await buildDealsPdf(config, db, { pageSlugs: args.page_slugs });
      return { content: [{ type: 'text', text: 'Anonymised deal overview PDF. Save the attached resource as anonymised-deals.pdf.' },
        { type: 'resource', resource: { uri: 'bigbrain://exports/anonymised-deals.pdf', mimeType: 'application/pdf', blob: pdf.toString('base64') } }] };
    }
    const records = await readAnonymisedDeals(db, { pageSlugs: args.page_slugs });
    return toolJson({ records, total: records.length });
  }
  return toolJson(await operation.run(config, db, args, options));
}
