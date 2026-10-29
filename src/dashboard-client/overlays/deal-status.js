export function recordStatus(record, introduction = false) {
  const status = record?.[introduction ? 'introduction_status' : 'deal_status'];
  if (status === 'active' || status === 'archived') return status;
  return ['paused', 'dropped'].includes(record?.[introduction ? 'stage' : 'deal_stage']) ? 'archived' : 'active';
}

export async function saveRecordStatus(record, status, introduction = false, fetchImpl = fetch) {
  if (!['active', 'archived'].includes(status)) throw new Error('Choose a valid status.');
  const stageField = introduction ? 'stage' : 'deal_stage';
  const statusField = introduction ? 'introduction_status' : 'deal_status';
  const response = await fetchImpl('/api/overlays/deals/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_slug: record.page_slug, status, expected_status: recordStatus(record, introduction),
      expected_stage: record[stageField] || 'unknown', expected_stage_as_of: record.stage_as_of || null }),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The status change could not be verified. Refresh before trying again.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to save the status. Please retry.'), { status: response.status });
  if (data.record?.page_slug !== record.page_slug || data.record[statusField] !== status
    || (data.record[stageField] || 'unknown') !== (record[stageField] || 'unknown')
    || (data.record.stage_as_of || null) !== (record.stage_as_of || null)) {
    throw new Error('The saved status could not be verified. Refresh before trying again.');
  }
  return data;
}
