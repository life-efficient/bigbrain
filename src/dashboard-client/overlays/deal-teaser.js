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

// Fall back to the browser copy command when clipboard permission is denied.
// Embedded browsers can deny the asynchronous clipboard API even on localhost.
function copyUsingSelection(message, document) {
  if (!document?.body || !document?.execCommand) return false;
  const focused = document.activeElement;
  const selection = document.getSelection?.();
  const ranges = [];
  for (let i = 0; selection && i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
  const textarea = document.createElement('textarea');
  textarea.value = message;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    return document.execCommand('copy') === true;
  } catch { return false; }
  finally {
    textarea.remove();
    focused?.focus?.({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

export async function copyDealTeaser(record, askIndex, clipboard = globalThis.navigator?.clipboard, document = globalThis.document) {
  const message = formatDealTeaser(record, askIndex);
  if (!message) throw new Error('Add a teaser summary and select a valid ask first.');
  if (clipboard?.writeText) {
    try { await clipboard.writeText(message); return; }
    catch { /* Try the synchronous browser copy fallback next. */ }
  }
  if (copyUsingSelection(message, document)) return;
  throw new Error('Automatic copying is unavailable. The complete message is selected below. Press Ctrl+C or Command+C to copy it.');
}
