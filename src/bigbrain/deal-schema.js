import { z } from 'zod';

export const DEAL_TYPES = ['capital_raise', 'acquisition', 'compute_brokerage', 'customer_introduction', 'commercial_partnership', 'advisory', 'other'];
export const DEAL_STAGES = ['unknown', 'qualifying', 'preparing', 'seeking_counterparties', 'negotiating', 'closing', 'delivering', 'completed'];
export const INTRODUCTION_STAGES = ['unknown', 'candidate', 'proposed', 'introduced', 'discussing', 'negotiating', 'agreed', 'delivering', 'completed', 'declined'];
export const ANONYMISED_TITLE_DESCRIPTION = "Short, concrete externally shareable deal title with company, project and person names removed. Retain the specific asset, technology, geography, scale or transaction that makes the deal distinctive; do not replace substance with a generic sector label. Separate from the internal title.";
export const ANONYMISED_DESCRIPTION_DESCRIPTION = "Externally shareable, evidence-backed description with company, project and person names removed. Lead with the actual offering or requirement, proposed transaction and strongest differentiators. Preserve specific technology and capabilities, geography, capacity, scale, traction, commercial figures and terms; retain evidenced family pedigree and government relationships when authorised for the audience. Do not suppress useful facts merely because their combination is distinctive or potentially recognisable, and do not replace them with generic sector labels. Preserve specific material uncertainty, but avoid routine defensive qualification or diligence boilerplate. Do not invent traction, authority, commitments or relationships. Exclude private contact details, URLs, internal sourcing routes and strategy unless explicitly authorised for the audience. Separate from the internal summary.";
export const ANONYMISED_ASKS_DESCRIPTION = "Evidence-backed, externally shareable requests for contributions from potential new participants in the deal, such as capital, compute supply, customers, acquisition, delivery or introductions. Each complete sentence states the participant sought and their role, retaining concrete amounts, capacity, specifications, geography and commercial requirements where supported and shareable. Remove company, project and person names without diluting the request into generic language. Excludes documents, clarification, approvals and follow-ups owed by parties already involved; record actionable prerequisites as linked tasks. Use an empty array when no external ask is established. Never invent an ask or unsupported commitment. Exclude private contact details, URLs, internal sourcing routes and strategy unless explicitly authorised for the audience.";
export const WAITING_ON_DESCRIPTION = 'Canonical people/ or organizations/ page slugs for parties whose response, information or action is currently awaited. These are dependencies, not task assignees; assignees remain the active Brain members responsible for following up. Empty means no recorded external dependency.';
const slug = (prefix) => z.string().regex(new RegExp(`^(${prefix})/[A-Za-z0-9][A-Za-z0-9_/-]*$`)).refine(v => !v.split('/').some(s => !s || s === '.' || s === '..'), 'Use a canonical page slug without extension');
const party = slug('people|organizations');
const date = z.union([z.iso.date(), z.iso.datetime({ offset: false })]);
export const waitingOnSchema = z.array(party).describe(WAITING_ON_DESCRIPTION);
export const dealMetadataSchema = z.object({
  anonymised_title: z.string().describe(ANONYMISED_TITLE_DESCRIPTION).optional(),
  anonymised_description: z.string().describe(ANONYMISED_DESCRIPTION_DESCRIPTION).optional(),
  anonymised_asks: z.array(z.string().trim().min(1)).describe(ANONYMISED_ASKS_DESCRIPTION).optional(),
  deal_types: z.array(z.enum(DEAL_TYPES)).describe('Commercial purposes of this deal. Multiple may apply; do not assume every deal is a fundraise. Omit or use an empty array when unknown.').optional(),
  deal_status: z.enum(['active', 'archived']).describe('Whether this deal remains in the active working portfolio. Archiving preserves its commercial stage and evidence date and does not archive its introductions. Missing status means active, except legacy paused or dropped stages.').optional(),
  deal_stage: z.enum(DEAL_STAGES).describe('Evidence-backed stage of the underlying deal, independent of any individual introduction. Facilitation arrangements are tracked independently on deal introductions. Seeking counterparties means an active search, not merely a hypothetical need. Use unknown when evidence is insufficient.').optional(),
  stage_as_of: date.describe('Date of evidence supporting the current deal stage, not the metadata entry date.').optional(),
}).passthrough();
export const dealIntroductionSchema = z.object({
  deal: slug('deals').describe('Required canonical parent deal slug. The underlying offering or requirement stays on that deal page.'),
  parties: z.array(party).min(2).refine(v => new Set(v).size === v.length, 'Parties must be distinct').describe('At least two distinct canonical organisation or person page slugs participating in this specific commercial introduction. Do not infer that an introduction occurred merely because parties are named.'),
  purpose: z.string().trim().min(1).describe('The specific commercial objective connecting these parties for the parent deal. A different objective may warrant another introduction page.'),
  introduction_status: z.enum(['active', 'archived']).describe('Whether this specific introduction is actively tracked. Independent of parent deal status and other introductions. Archiving preserves stage and evidence date; missing status means active except a legacy paused stage.').optional(),
  arrangement_status: z.enum(['none', 'establishing', 'agreed']).describe('Status of the facilitation arrangement for this specific introduction, independent of commercial stage. none or omitted means no arrangement is recorded, not proof that none exists; establishing means scope, authority, disclosure permissions or fees are being agreed; agreed requires evidence that the relevant parties have agreed the arrangement, not merely a draft or proposal.').optional(),
  stage: z.enum(INTRODUCTION_STAGES).describe('Evidence-backed progress of this specific introduction. Negotiating includes counterparty-specific commercial terms, such as supply or investment arrangements. Candidate or proposed does not mean introduced; agreed does not mean completed. Use unknown when not established.'),
  stage_as_of: date.describe('Date of evidence for this introduction stage. Do not substitute the filing date for an unknown event date.').optional(),
}).passthrough();
function fieldsFrom(schema) {
  return Object.fromEntries(Object.entries(schema.shape).map(([key, value]) => {
    const json = z.toJSONSchema(value, { unrepresentable: 'any' });
    delete json.$schema;
    return [key, { ...json, ...(!value.isOptional() ? { required: true } : {}) }];
  }));
}
export const dealMetadataFields = () => fieldsFrom(dealMetadataSchema);
export const dealIntroductionFields = () => fieldsFrom(dealIntroductionSchema);
export const taskWaitingOnField = () => { const json = z.toJSONSchema(waitingOnSchema); delete json.$schema; return json; };
export function commercialMetadataIssues(pagePath, frontmatter) {
  const collection = String(pagePath).split('/')[0];
  const schema = collection === 'deal_introductions' ? dealIntroductionSchema : collection === 'deals' ? dealMetadataSchema : collection === 'tasks' && Object.hasOwn(frontmatter, 'waiting_on') ? z.object({ waiting_on: waitingOnSchema }).passthrough() : null;
  if (!schema || String(pagePath).includes('/.raw/')) return [];
  const result = schema.safeParse(frontmatter);
  return result.success ? [] : result.error.issues.map(issue => ({ type: 'schema_field_invalid_value', details: { field: issue.path.join('.'), message: issue.message } }));
}

export function commercialProgress(frontmatter, introduction = false) {
  const stageKey = introduction ? 'stage' : 'deal_stage';
  const statusKey = introduction ? 'introduction_status' : 'deal_status';
  const legacyArchived = (introduction ? ['paused'] : ['paused', 'dropped']).includes(frontmatter[stageKey]);
  return { [stageKey]: legacyArchived || (!introduction && frontmatter[stageKey] === 'establishing_arrangement') ? 'unknown' : frontmatter[stageKey] || 'unknown',
    [statusKey]: frontmatter[statusKey] || (legacyArchived ? 'archived' : 'active') };
}
