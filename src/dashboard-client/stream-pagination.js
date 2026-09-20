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

export function createBottomReachGate(threshold = 120) {
  let wasNearBottom = false;
  let lastScrollTop = 0;

  function nearBottom({ scrollTop, clientHeight, scrollHeight }) {
    return scrollHeight > clientHeight && scrollHeight - clientHeight - scrollTop <= threshold;
  }

  return {
    observe(metrics) {
      wasNearBottom = nearBottom(metrics);
      lastScrollTop = metrics.scrollTop;
    },
    onScroll(metrics, intentional) {
      const near = nearBottom(metrics);
      const reached = intentional && !wasNearBottom && near && metrics.scrollTop > lastScrollTop;
      wasNearBottom = near;
      lastScrollTop = metrics.scrollTop;
      return reached;
    },
  };
}

const preferredSourceOrder = new Map([
  'assistant_chat', 'granola', 'rss', 'substack', 'whatsapp', 'youtube', 'webhook',
].map((type, index) => [type, index]));

export function orderStreamSourceTypes(sourceTypes) {
  function group(type) {
    if (preferredSourceOrder.has(type)) return 0;
    if (type === 'cli') return 2;
    if (type === 'unknown') return 3;
    return 1;
  }
  return [...sourceTypes].sort((left, right) => {
    const groupDifference = group(left[0]) - group(right[0]);
    if (groupDifference) return groupDifference;
    if (group(left[0]) === 0) return preferredSourceOrder.get(left[0]) - preferredSourceOrder.get(right[0]);
    return left[2].localeCompare(right[2]);
  });
}

function recentItemKey(item, kind) {
  if (kind === 'images') return `${item.slug || ''}:${item.image?.path || item.image?.url || ''}`;
  return item.slug || '';
}
