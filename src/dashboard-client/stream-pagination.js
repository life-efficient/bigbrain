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

function recentItemKey(item, kind) {
  if (kind === 'images') return `${item.slug || ''}:${item.image?.path || item.image?.url || ''}`;
  return item.slug || '';
}
