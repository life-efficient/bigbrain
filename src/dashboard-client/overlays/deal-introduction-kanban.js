import { recordStatus } from './deal-status.js';
import { INTRODUCTION_STAGE_LABELS } from './deal-progress.js';

export function introductionStage(record) {
  return Object.hasOwn(INTRODUCTION_STAGE_LABELS, record?.stage) ? record.stage : 'unknown';
}

export function groupIntroductionsByStage(records, { includeEmpty = false } = {}) {
  const columns = Object.entries(INTRODUCTION_STAGE_LABELS).map(([stage, label]) => ({ stage, label, records: [] }));
  const byStage = new Map(columns.map(column => [column.stage, column]));
  for (const record of records) byStage.get(introductionStage(record)).records.push(record);
  return columns.filter(column => column.records.length || (includeEmpty && column.stage !== 'unknown'));
}

export function introductionStageDropTarget(id) {
  if (typeof id !== 'string' || !id.startsWith('introduction-stage:')) return null;
  const stage = id.slice('introduction-stage:'.length);
  return Object.hasOwn(INTRODUCTION_STAGE_LABELS, stage) ? stage : null;
}

export async function saveIntroductionStage(record, nextStage, fetchImpl = fetch) {
  if (recordStatus(record, true) === 'archived') throw new Error('Restore this introduction before changing its stage.');
  if (!Object.hasOwn(INTRODUCTION_STAGE_LABELS, nextStage)) throw new Error('Choose a valid introduction stage.');
  if (nextStage === introductionStage(record)) return { record };
  const response = await fetchImpl('/api/overlays/deals/introductions/stage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_slug: record.page_slug, stage: nextStage,
      expected_stage: record.stage || 'unknown', expected_stage_as_of: record.stage_as_of || null,
      expected_introduction_status: recordStatus(record, true) }),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The stage change could not be verified. Refresh before trying again.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to save the stage. Please retry.'), { status: response.status });
  if (data.record?.page_slug !== record.page_slug || data.record.stage !== nextStage || !data.record.stage_as_of) {
    throw new Error('The saved stage could not be verified. Refresh before trying again.');
  }
  return data;
}
