export async function loadAllDealRecords(endpoint, { signal, fetchImpl = fetch } = {}) {
  const records = [];
  const seen = new Set();
  let cursor = null;
  let total = null;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor !== null) params.set('cursor', String(cursor));
    const response = await fetchImpl(`${endpoint}?${params}`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Unable to load records (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data.records)) throw new Error('The records could not be read.');
    if (Number.isInteger(data.total) && data.total >= 0) total = data.total;
    records.push(...data.records);
    cursor = data.next_cursor ?? null;
    if (cursor !== null) {
      const key = String(cursor);
      if (seen.has(key)) throw new Error('Unable to finish loading all records. Please retry.');
      seen.add(key);
    }
  } while (cursor !== null);
  if (total !== null && records.length < total) throw new Error('Unable to finish loading all records. Please retry.');
  return records;
}

export async function fetchAnonymisedDealsPdf(fetchImpl = fetch) {
  const response = await fetchImpl('/api/overlays/deals/export.pdf', { cache: 'no-store' });
  if (!response.ok) {
    let message = '';
    try { const data = await response.json(); message = data.error || data.message || ''; } catch { /* Use the status fallback. */ }
    throw new Error(message || `Unable to download the PDF (${response.status}).`);
  }
  if (!response.headers.get('content-type')?.includes('application/pdf')) {
    throw new Error('The PDF could not be generated. Please retry.');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('The generated PDF was empty. Please retry.');
  return blob;
}
