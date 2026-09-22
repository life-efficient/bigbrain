export const FOCUSED_NETWORK_MAX_HOPS = 2;

export function normalizeFocusedGraphSlug(value) {
  const normalized = String(value || '').trim().replace(/^\/+/, '').replace(/\.md$/i, '');
  return normalized || null;
}

function normalizeFocusedGraphEdge(edge) {
  const source = normalizeFocusedGraphSlug(edge?.source);
  const target = normalizeFocusedGraphSlug(edge?.target);
  if (!source || !target || source === target) return null;
  return { ...edge, source, target };
}

export function buildFocusedNetworkGraph(graph, lineage, focusSlug, maxHops = FOCUSED_NETWORK_MAX_HOPS) {
  const normalizedFocusSlug = normalizeFocusedGraphSlug(focusSlug);
  if (!normalizedFocusSlug) return graph;
  const sourceNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const sourceEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const events = Array.isArray(lineage?.link_events) ? lineage.link_events : [];
  const summaries = new Map();
  const pageSlug = normalizeFocusedGraphSlug(lineage?.page?.slug);
  if (pageSlug) summaries.set(pageSlug, lineage.page);
  for (const event of events) {
    const fromSlug = normalizeFocusedGraphSlug(event?.from?.slug);
    const toSlug = normalizeFocusedGraphSlug(event?.to?.slug);
    if (fromSlug) summaries.set(fromSlug, event.from);
    if (toSlug) summaries.set(toSlug, event.to);
  }
  const historicalEdges = events
    .filter((event) => event?.from_page && event?.to_page)
    .map((event, index) => ({
      id: `lineage:${event.commit_sha || index}:${event.from_page}:${event.to_page}`,
      source: normalizeFocusedGraphSlug(event.from_page),
      target: normalizeFocusedGraphSlug(event.to_page),
      timestamp: event.timestamp || null,
      created_at: event.timestamp || null,
      updated_at: event.timestamp || null,
      lineage_event: true,
      type: event.type,
    }))
    .map(normalizeFocusedGraphEdge)
    .filter(Boolean);
  const fallbackEdges = [
    ...(Array.isArray(lineage?.backlinks)
      ? lineage.backlinks.map((link) => ({ source: link.from_slug, target: normalizedFocusSlug }))
      : []),
  ].map(normalizeFocusedGraphEdge).filter(Boolean);
  const edgeByDirection = new Map();
  for (const edge of [...sourceEdges.map(normalizeFocusedGraphEdge), ...fallbackEdges, ...historicalEdges].filter(Boolean)) {
    const key = `${edge.source}:${edge.target}`;
    if (!edgeByDirection.has(key) || edge.lineage_event) edgeByDirection.set(key, edge);
  }
  const allEdges = [...edgeByDirection.values()];
  const incomingByTarget = new Map();
  const outgoingBySource = new Map();
  for (const edge of allEdges) {
    if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
    incomingByTarget.get(edge.target).push(edge.source);
    if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
    outgoingBySource.get(edge.source).push(edge.target);
  }
  for (const neighbors of incomingByTarget.values()) neighbors.sort((left, right) => left.localeCompare(right));
  for (const neighbors of outgoingBySource.values()) neighbors.sort((left, right) => left.localeCompare(right));
  const hops = new Map([[normalizedFocusSlug, 0]]);
  const parentBySlug = new Map();
  const queue = [normalizedFocusSlug];
  while (queue.length) {
    const current = queue.shift();
    const currentHop = hops.get(current);
    if (currentHop >= maxHops) continue;
    for (const neighbor of incomingByTarget.get(current) || []) {
      if (neighbor === normalizedFocusSlug || hops.has(neighbor)) continue;
      hops.set(neighbor, currentHop + 1);
      parentBySlug.set(neighbor, current);
      queue.push(neighbor);
    }
    for (const neighbor of outgoingBySource.get(current) || []) {
      if (neighbor === normalizedFocusSlug || hops.has(neighbor)) continue;
      hops.set(neighbor, currentHop + 1);
      parentBySlug.set(neighbor, current);
      queue.push(neighbor);
    }
  }
  const focusSlugs = new Set(hops.keys());
  const branchBySlug = new Map([[normalizedFocusSlug, normalizedFocusSlug]]);
  for (const slug of focusSlugs) {
    if (slug === normalizedFocusSlug) continue;
    let branch = slug;
    let parent = parentBySlug.get(slug);
    while (parent && parent !== normalizedFocusSlug) {
      branch = parent;
      parent = parentBySlug.get(parent);
    }
    branchBySlug.set(slug, branch);
  }
  const sourceNodeBySlug = new Map();
  for (const node of sourceNodes) {
    const slug = normalizeFocusedGraphSlug(node?.slug);
    if (slug && !sourceNodeBySlug.has(slug)) sourceNodeBySlug.set(slug, { ...node, slug });
  }
  const lineageDates = new Map();
  for (const event of historicalEdges) {
    const timestamp = event?.timestamp;
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) continue;
    for (const slug of [event.source, event.target]) {
      if (!slug) continue;
      const current = lineageDates.get(slug);
      if (!current || Date.parse(timestamp) < Date.parse(current)) lineageDates.set(slug, timestamp);
    }
  }

  const nodes = [...focusSlugs].map((slug) => {
    const sourceNode = sourceNodeBySlug.get(slug);
    const summary = summaries.get(slug);
    const lineageAt = lineageDates.get(slug);
    return {
      ...(sourceNode || {}),
      slug,
      title: sourceNode?.title || summary?.title || labelFromSlug(slug),
      type: sourceNode?.type || summary?.type || slug.split('/')[0] || 'unknown',
      degree: sourceNode?.degree || 1,
      focus_hop: hops.get(slug) ?? 0,
      focus_parent: parentBySlug.get(slug) || null,
      focus_branch: branchBySlug.get(slug) || normalizedFocusSlug,
      network_at: lineageAt || sourceNode?.created_at || sourceNode?.updated_at || null,
      lineage_at: lineageAt || sourceNode?.created_at || sourceNode?.updated_at || null,
      created_at: sourceNode?.created_at || lineageAt || sourceNode?.updated_at || null,
      updated_at: sourceNode?.updated_at || lineageAt || null,
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.slug));
  const edges = allEdges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
    const sourceHop = hops.get(edge.source);
    const targetHop = hops.get(edge.target);
    return Number.isFinite(sourceHop) && Number.isFinite(targetHop) && Math.abs(sourceHop - targetHop) === 1;
  });
  return {
    ...graph,
    nodes,
    edges,
    inputs: [],
    activity: [],
    meta: {
      ...graph?.meta,
      page_count: nodes.length,
      node_count: nodes.length,
      edge_count: edges.length,
      input_count: 0,
      focused_hops: maxHops,
      focused_slug: normalizedFocusSlug,
    },
  };
}

function labelFromSlug(slug) {
  const leaf = String(slug || '').split('/').filter(Boolean).pop() || '';
  return leaf
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
