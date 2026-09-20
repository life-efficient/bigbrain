export function appendUniqueRecentItems(currentItems, incomingItems, kind) {
  const next = [...currentItems];
  const seen = new Set(currentItems.map((item) => recentItemKey(item, kind)));
  for (const item of incomingItems) {
    const key = recentItemKey(item, kind);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

function recentItemKey(item, kind) {
  if (kind === 'images') return `${item.slug || ''}:${item.image?.path || item.image?.url || ''}`;
  return item.slug || '';
}
