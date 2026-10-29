import { z } from 'zod';

export const DEAL_TYPES = ['capital_raise', 'acquisition', 'compute_brokerage', 'customer_introduction', 'commercial_partnership', 'advisory', 'other'];
export const DEAL_STAGES = ['unknown', 'qualifying', 'preparing', 'seeking_counterparties', 'negotiating', 'closing', 'delivering', 'completed', 'paused', 'dropped'];
export const INTRODUCTION_STAGES = ['unknown', 'candidate', 'proposed', 'introduced', 'discussing', 'negotiating', 'agreed', 'delivering', 'completed', 'paused', 'declined'];
export const ANONYMISED_ASKS_DESCRIPTION = 'Evidence-backed, externally shareable requests for contributions from potential new participants in the deal, such as capital, compute supply, customers, acquisition, delivery or introductions. Each complete sentence states the participant sought and their role. Excludes documents, clarification, approvals and follow-ups owed by parties already involved; record actionable prerequisites as linked tasks. Use an empty array when no external ask is established. Never invent an ask to complete the record. Omit identifying details, private economics and unsupported commitments.';
export const WAITING_ON_DESCRIPTION = 'Canonical people/ or organizations/ page slugs for parties whose response, information or action is currently awaited. These are dependencies, not task assignees; assignees remain the active Brain members responsible for following up. Empty means no recorded external dependency.';
const slug = (prefix) => z.string().regex(new RegExp(`^(${prefix})/[A-Za-z0-9][A-Za-z0-9_/-]*$`)).refine(v => !v.split('/').some(s => !s || s === '.' || s === '..'), 'Use a canonical page slug without extension');
const party = slug('people|organizations');
const date = z.union([z.iso.date(), z.iso.datetime({ offset: false })]);
export const waitingOnSchema = z.array(party).describe(WAITING_ON_DESCRIPTION);
export const dealMetadataSchema = z.object({
  anonymised_title: z.string().describe('Short externally shareable deal title without party names or identifying combinations of details. Separate from the internal title.').optional(),
  anonymised_description: z.string().describe('Concise evidenced description of the offering or requirement and proposed commercial arrangement. Omit identities, private economics, provenance and identifying combinations of details; preserve material uncertainty without inventing commitments. Separate from the internal summary.').optional(),
  anonymised_asks: z.array(z.string().trim().min(1)).describe(ANONYMISED_ASKS_DESCRIPTION).optional(),
  deal_types: z.array(z.enum(DEAL_TYPES)).describe('Commercial purposes of this deal. Multiple may apply; do not assume every deal is a fundraise. Omit or use an empty array when unknown.').optional(),
  deal_stage: z.enum(DEAL_STAGES).describe('Evidence-backed stage of the underlying deal, independent of any individual introduction. Seeking counterparties means an active search, not merely a hypothetical need. Use unknown when evidence is insufficient.').optional(),
  stage_as_of: date.describe('Date of evidence supporting the current deal stage, not the metadata entry date.').optional(),
}).passthrough();
export const dealIntroductionSchema = z.object({
  deal: slug('deals').describe('Required canonical parent deal slug. The underlying offering or requirement stays on that deal page.'),
  parties: z.array(party).min(2).refine(v => new Set(v).size === v.length, 'Parties must be distinct').describe('At least two distinct canonical organisation or person page slugs participating in this specific commercial introduction. Do not infer that an introduction occurred merely because parties are named.'),
  purpose: z.string().trim().min(1).describe('The specific commercial objective connecting these parties for the parent deal. A different objective may warrant another introduction page.'),
  stage: z.enum(INTRODUCTION_STAGES).describe('Evidence-backed progress of this specific introduction. Candidate or proposed does not mean introduced; agreed does not mean completed. Use unknown when not established.'),
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
