export function dealTeaserParts(record = {}) {
  const title = typeof record.anonymised_title === 'string' ? record.anonymised_title.trim() : '';
  const summary = typeof record.anonymised_description === 'string' ? record.anonymised_description.trim() : '';
  const asks = Array.isArray(record.anonymised_asks)
    ? record.anonymised_asks.filter((ask) => typeof ask === 'string').map((ask) => ask.trim()).filter(Boolean)
    : [];
  return { title, summary, asks };
}

export function formatDealTeaser(record, askIndex) {
  const { title, summary, asks } = dealTeaserParts(record);
  if (!title || !summary || !Number.isInteger(askIndex) || askIndex < 0 || askIndex >= asks.length) return '';
  return `${title}\n\n${summary}\n\n${asks[askIndex]}`;
}

export function formatAllDealAsks(record) {
  const { title, summary, asks } = dealTeaserParts(record);
  if (!title || !summary || !asks.length) return '';
  return `${title}\n\n${summary}\n\nWhat is needed:\n${asks.map((ask) => `• ${ask}`).join('\n')}`;
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
  if (!message) throw new Error('Add an anonymised title and description and select a valid ask first.');
  return copyMessage(message, clipboard, document);
}

export async function copyAllDealAsks(record, clipboard = globalThis.navigator?.clipboard, document = globalThis.document) {
  const message = formatAllDealAsks(record);
  if (!message) throw new Error('Add an anonymised title and description and at least one ask first.');
  return copyMessage(message, clipboard, document);
}

async function copyMessage(message, clipboard, document) {
  if (clipboard?.writeText) {
    try { await clipboard.writeText(message); return; }
    catch { /* Try the synchronous browser copy fallback next. */ }
  }
  if (copyUsingSelection(message, document)) return;
  throw new Error('Automatic copying is unavailable. The complete message is selected below. Press Ctrl+C or Command+C to copy it.');
}
