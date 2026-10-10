export function dealTeaserParts(record = {}) {
  const summary = typeof record.teaser_summary === 'string' ? record.teaser_summary.trim() : '';
  const asks = Array.isArray(record.asks)
    ? record.asks.filter((ask) => typeof ask === 'string').map((ask) => ask.trim()).filter(Boolean)
    : [];
  return { summary, asks };
}

export function formatDealTeaser(record) {
  const { summary, asks } = dealTeaserParts(record);
  if (!summary || !asks.length) return '';
  return `${summary}\n\nLooking for:\n${asks.map((ask) => `• ${ask}`).join('\n')}`;
}

export async function copyDealTeaser(record, clipboard = globalThis.navigator?.clipboard) {
  const message = formatDealTeaser(record);
  if (!message) throw new Error('Add a teaser summary and at least one ask first.');
  if (!clipboard?.writeText) throw new Error('Clipboard access is unavailable. Select and copy the teaser below.');
  try {
    await clipboard.writeText(message);
  } catch {
    throw new Error('Could not copy. Select and copy the teaser below.');
  }
}
