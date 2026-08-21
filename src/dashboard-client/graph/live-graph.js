export function deriveGraphMotion(previousGraph, nextGraph, sourceEvents = []) {
  const previous = new Map((previousGraph?.nodes || []).map((node) => [node.slug, node]));
  const next = new Map((nextGraph?.nodes || []).map((node) => [node.slug, node]));
  const changes = [];

  for (const [slug, node] of next) {
    const before = previous.get(slug);
    if (!before) {
      changes.push({ slug, kind: 'created' });
    } else if (before.updated_at !== node.updated_at) {
      changes.push({ slug, kind: 'updated' });
    }
  }
  for (const slug of previous.keys()) {
    if (!next.has(slug)) changes.push({ slug, kind: 'removed' });
  }

  for (const event of sourceEvents) {
    if (!event?.slug || changes.some((change) => change.slug === event.slug)) continue;
    if (next.has(event.slug)) changes.push({ slug: event.slug, kind: event.kind === 'created' ? 'created' : 'updated' });
  }

  return {
    id: sourceEvents.at(-1)?.id || `${Date.now()}`,
    changes: changes.slice(0, 32),
    source_events: sourceEvents.length,
  };
}

export function graphPayloadsEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}
