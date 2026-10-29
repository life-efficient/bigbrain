import { recordStatus } from './deal-status.js';
import { DEAL_STAGE_LABELS } from './deal-progress.js';

export function groupDealsByStage(records, { includeEmpty = false } = {}) {
  const columns = Object.entries(DEAL_STAGE_LABELS).map(([stage, label]) => ({ stage, label, records: [] }));
  const byStage = new Map(columns.map(column => [column.stage, column]));
  for (const record of records) (byStage.get(record.deal_stage) || byStage.get('unknown')).records.push(record);
  return includeEmpty ? columns : columns.filter(column => column.records.length);
}

export function dealStage(record) {
  return Object.hasOwn(DEAL_STAGE_LABELS, record?.deal_stage) ? record.deal_stage : 'unknown';
}

export function stageDropTarget(id) {
  if (typeof id !== 'string' || !id.startsWith('stage:')) return null;
  const stage = id.slice(6);
  return Object.hasOwn(DEAL_STAGE_LABELS, stage) ? stage : null;
}

export async function saveDealStage(record, nextStage, fetchImpl = fetch) {
  if (recordStatus(record) === 'archived') throw new Error('Restore this deal before changing its stage.');
  if (!Object.hasOwn(DEAL_STAGE_LABELS, nextStage)) throw new Error('Choose a valid deal stage.');
  if (nextStage === dealStage(record)) return { record };
  const response = await fetchImpl('/api/overlays/deals/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_slug: record.page_slug, expected_deal_status: recordStatus(record), deal_stage: nextStage, expected_deal_stage: record.deal_stage || 'unknown', expected_stage_as_of: record.stage_as_of || null }) });
  let data;
  try { data = await response.json(); } catch { throw new Error('The stage change could not be verified. Refresh before trying again.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to save the stage. Please retry.'), { status: response.status });
  if (data.record?.page_slug !== record.page_slug || data.record.deal_stage !== nextStage || !data.record.stage_as_of) {
    throw new Error('The saved stage could not be verified. Refresh before trying again.');
  }
  return data;
}
