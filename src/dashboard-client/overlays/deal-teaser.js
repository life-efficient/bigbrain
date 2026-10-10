export function dealTeaserParts(record = {}) {
  const summary = typeof record.teaser_summary === 'string' ? record.teaser_summary.trim() : '';
  const asks = Array.isArray(record.asks)
    ? record.asks.filter((ask) => typeof ask === 'string').map((ask) => ask.trim()).filter(Boolean)
    : [];
  return { summary, asks };
}

export function formatDealTeaser(record, askIndex) {
  const { summary, asks } = dealTeaserParts(record);
  if (!summary || !Number.isInteger(askIndex) || askIndex < 0 || askIndex >= asks.length) return '';
  return `${summary}\n\nLooking for:\n• ${asks[askIndex]}`;
}

export async function copyDealTeaser(record, askIndex, clipboard = globalThis.navigator?.clipboard) {
  const message = formatDealTeaser(record, askIndex);
  if (!message) throw new Error('Add a teaser summary and select a valid ask first.');
  if (!clipboard?.writeText) throw new Error('Clipboard access is unavailable. Select and copy the teaser below.');
  try {
    await clipboard.writeText(message);
  } catch {
    throw new Error('Could not copy. Select and copy the teaser below.');
  }
}
