import { normalizeFocusedGraphSlug } from './focused-network-data.js';

export function buildFocusedSubgraphGraph(graph, lineage, focusSlug) {
  const normalizedFocusSlug = normalizeFocusedGraphSlug(focusSlug);
  if (!normalizedFocusSlug) return graph;

  const sourceNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const sourceEdges = (Array.isArray(graph?.edges) ? graph.edges : [])
    .map(normalizeSubgraphEdge)
    .filter(Boolean);
  const events = Array.isArray(lineage?.link_events) ? lineage.link_events : [];
  const outgoingLinks = usableOutgoingLinks(lineage?.outgoing);
  const backlinkLinks = usableBacklinkLinks(lineage?.backlinks);
  const outgoingPages = outgoingLinks.map((link) => normalizeFocusedGraphSlug(link.to_slug)).filter(Boolean);
  const incomingPages = backlinkLinks.map((link) => normalizeFocusedGraphSlug(link.from_slug)).filter(Boolean);
  const graphOutgoingPages = sourceEdges
    .filter((edge) => edge.source === normalizedFocusSlug)
    .map((edge) => edge.target);
  const graphIncomingPages = sourceEdges
    .filter((edge) => edge.target === normalizedFocusSlug)
    .map((edge) => edge.source);
  const relevantEvents = events.filter((event) => {
    const fromSlug = normalizeFocusedGraphSlug(event?.from_page);
    const toSlug = normalizeFocusedGraphSlug(event?.to_page);
    return fromSlug === normalizedFocusSlug || toSlug === normalizedFocusSlug;
  });
  const eventPages = relevantEvents.flatMap((event) => [event?.from_page, event?.to_page]);
  const focusSlugs = new Set([
    normalizedFocusSlug,
    ...outgoingPages,
    ...incomingPages,
    ...graphOutgoingPages,
    ...graphIncomingPages,
    ...eventPages.map(normalizeFocusedGraphSlug).filter(Boolean),
  ]);

  const summaries = new Map();
  if (lineage?.page?.slug) {
    const slug = normalizeFocusedGraphSlug(lineage.page.slug);
    if (slug) summaries.set(slug, { ...lineage.page, slug });
  }
  for (const link of [...outgoingLinks, ...backlinkLinks]) {
    const relatedPage = link?.page;
    const slug = normalizeFocusedGraphSlug(relatedPage?.slug || link?.to_slug || link?.from_slug);
    if (slug && relatedPage) summaries.set(slug, { ...relatedPage, slug });
  }
  for (const event of events) {
    const fromSlug = normalizeFocusedGraphSlug(event?.from?.slug);
    const toSlug = normalizeFocusedGraphSlug(event?.to?.slug);
    if (fromSlug) summaries.set(fromSlug, { ...event.from, slug: fromSlug });
    if (toSlug) summaries.set(toSlug, { ...event.to, slug: toSlug });
  }

  const sourceNodeBySlug = new Map();
  for (const node of sourceNodes) {
    const slug = normalizeFocusedGraphSlug(node?.slug);
    if (slug && !sourceNodeBySlug.has(slug)) sourceNodeBySlug.set(slug, { ...node, slug });
  }
  const lineageDates = new Map();
  for (const event of relevantEvents) {
    const timestamp = event?.timestamp;
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) continue;
    for (const slug of [event.from_page, event.to_page].map(normalizeFocusedGraphSlug)) {
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
      lineage_at: lineageAt || sourceNode?.created_at || sourceNode?.updated_at || null,
      created_at: sourceNode?.created_at || lineageAt || sourceNode?.updated_at || null,
      updated_at: sourceNode?.updated_at || lineageAt || null,
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.slug));
  const edges = sourceEdges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const edgeKeys = new Set(edges.map((edge) => `${edge.source}:${edge.target}`));
  const fallbackEdges = [
    ...outgoingLinks.map((link, index) => ({
      id: `outgoing:${index}:${normalizedFocusSlug}:${link.to_slug}`,
      source: normalizedFocusSlug,
      target: normalizeFocusedGraphSlug(link.to_slug),
      link_text: link.link_text || null,
      link_kind: link.link_kind || null,
    })),
    ...backlinkLinks.map((link, index) => ({
      id: `backlink:${index}:${link.from_slug}:${normalizedFocusSlug}`,
      source: normalizeFocusedGraphSlug(link.from_slug),
      target: normalizedFocusSlug,
      link_text: link.link_text || null,
      link_kind: link.link_kind || null,
    })),
    ...relevantEvents.map((event, index) => ({
      id: `lineage:${event.commit_sha || index}:${event.from_page}:${event.to_page}`,
      source: normalizeFocusedGraphSlug(event.from_page),
      target: normalizeFocusedGraphSlug(event.to_page),
      created_at: event.timestamp || null,
      updated_at: event.timestamp || null,
      lineage_event: true,
      type: event.type,
    })),
  ];
  for (const edge of fallbackEdges) {
    if (!edge.source || !edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const key = `${edge.source}:${edge.target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push(edge);
  }

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
    },
  };
}

function normalizeSubgraphEdge(edge) {
  const source = normalizeFocusedGraphSlug(edge?.source);
  const target = normalizeFocusedGraphSlug(edge?.target);
  if (!source || !target || source === target) return null;
  return { ...edge, source, target };
}

function usableOutgoingLinks(links) {
  return (Array.isArray(links) ? links : [])
    .filter((link) => link?.to_slug && link.is_resolved !== 0 && link.is_resolved !== false);
}

function usableBacklinkLinks(links) {
  return (Array.isArray(links) ? links : []).filter((link) => link?.from_slug);
}

function labelFromSlug(slug) {
  const leaf = String(slug || '').split('/').filter(Boolean).pop() || '';
  return leaf
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
