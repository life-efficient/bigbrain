export async function saveIntroductionArrangement(record, arrangementStatus, fetchImpl = fetch) {
  if (!['none', 'establishing', 'agreed'].includes(arrangementStatus)) throw new Error('Choose a valid arrangement option.');
  const response = await fetchImpl('/api/overlays/deals/introductions/arrangement', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_slug: record.page_slug, arrangement_status: arrangementStatus,
      expected_arrangement_status: record.arrangement_status || 'none' }),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The arrangement change could not be verified. Refresh before trying again.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to save the arrangement option. Please retry.'), { status: response.status });
  if (data.record?.page_slug !== record.page_slug || data.record.arrangement_status !== arrangementStatus) {
    throw new Error('The saved arrangement option could not be verified. Refresh before trying again.');
  }
  return data;
}
