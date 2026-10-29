import { DEAL_STAGE_LABELS } from './deal-progress.js';

export function groupDealsByStage(records) {
  const columns = Object.entries(DEAL_STAGE_LABELS).map(([stage, label]) => ({ stage, label, records: [] }));
  const byStage = new Map(columns.map(column => [column.stage, column]));
  for (const record of records) (byStage.get(record.deal_stage) || byStage.get('unknown')).records.push(record);
  return columns.filter(column => column.records.length);
}
