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

export const INITIAL_GRAPH_REVEAL_STEP_MS = 110;

export function buildInitialGraphRevealStages(graph, {
  maxNodes = 900,
  maxStages = 10,
  minNodes = 16,
} = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (nodes.length < minNodes || nodes.length > maxNodes) return [];

  const datedNodes = nodes.filter((node) => Number.isFinite(graphNodeTimestamp(node)));
  if (datedNodes.length < Math.ceil(nodes.length * 0.6)) return [];

  const orderedNodes = [...nodes].sort((left, right) => {
    const leftTime = graphNodeTimestamp(left);
    const rightTime = graphNodeTimestamp(right);
    if (leftTime !== rightTime) return (leftTime || Number.POSITIVE_INFINITY) - (rightTime || Number.POSITIVE_INFINITY);
    return String(left.slug).localeCompare(String(right.slug));
  });
  const stageCount = Math.min(maxStages, Math.max(2, Math.ceil(nodes.length / 48)));
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  return Array.from({ length: stageCount }, (_, index) => {
    const nodeCount = index === stageCount - 1
      ? orderedNodes.length
      : Math.max(1, Math.ceil(((index + 1) / stageCount) * orderedNodes.length));
    const stageNodes = orderedNodes.slice(0, nodeCount);
    const slugs = new Set(stageNodes.map((node) => node.slug));
    return {
      ...graph,
      nodes: stageNodes,
      edges: edges.filter((edge) => slugs.has(edge.source) && slugs.has(edge.target)),
    };
  });
}

function graphNodeTimestamp(node) {
  return Date.parse(node?.lineage_at || node?.created_at || node?.updated_at);
}
