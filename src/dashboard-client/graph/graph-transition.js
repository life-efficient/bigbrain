export const GRAPH_MEMBERSHIP_TRANSITION_MS = 520;

export function beginGraphTransition(item, from, to = 1, startedAt = performance.now()) {
  if (!item) return;
  item.__bigBrainTransition = {
    startedAt,
    duration: GRAPH_MEMBERSHIP_TRANSITION_MS,
    from: clamp(from),
    to: clamp(to),
  };
}

export function graphTransitionTarget(item) {
  return item?.__bigBrainTransition?.to ?? 1;
}

export function graphTransitionProgress(item, now = performance.now()) {
  const transition = item?.__bigBrainTransition;
  if (!transition) return 1;
  const elapsed = Math.max(0, now - transition.startedAt);
  const linear = Math.min(1, elapsed / transition.duration);
  const eased = 1 - ((1 - linear) ** 3);
  return transition.from + (transition.to - transition.from) * eased;
}

export function graphTransitionActive(item, now = performance.now()) {
  const transition = item?.__bigBrainTransition;
  return Boolean(transition && now - transition.startedAt < transition.duration);
}

export function finishGraphTransition(item) {
  if (item?.__bigBrainTransition) delete item.__bigBrainTransition;
}

export function prepareGraphTransitionData(previousData, targetData, now = performance.now()) {
  const previousNodes = new Map((previousData?.nodes || []).map((node) => [node.id, node]));
  const previousLinks = new Map((previousData?.links || []).map((link) => [link.id, link]));
  const targetNodeIds = new Set((targetData?.nodes || []).map((node) => node.id));
  const targetLinkIds = new Set((targetData?.links || []).map((link) => link.id));
  const nodes = [...(targetData?.nodes || [])];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = [...(targetData?.links || [])];

  for (const node of nodes) {
    const previous = previousNodes.get(node.id);
    if (!previous) {
      beginGraphTransition(node, 0, 1, now);
    } else if (graphTransitionTarget(previous) === 0) {
      beginGraphTransition(node, graphTransitionProgress(previous, now), 1, now);
    }
  }

  for (const node of previousData?.nodes || []) {
    if (targetNodeIds.has(node.id) || graphTransitionProgress(node, now) <= 0) continue;
    if (!node.__bigBrainTransition || graphTransitionTarget(node) !== 0) {
      beginGraphTransition(node, graphTransitionProgress(node, now), 0, now);
    }
    nodes.push(node);
    nodeIds.add(node.id);
  }

  for (const link of links) {
    const previous = previousLinks.get(link.id);
    if (!previous) {
      beginGraphTransition(link, 0, 1, now);
    } else if (graphTransitionTarget(previous) === 0) {
      beginGraphTransition(link, graphTransitionProgress(previous, now), 1, now);
    }
  }

  for (const link of previousData?.links || []) {
    if (targetLinkIds.has(link.id) || graphTransitionProgress(link, now) <= 0) continue;
    const sourceId = graphEndpointId(link.source);
    const targetId = graphEndpointId(link.target);
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) continue;
    if (!link.__bigBrainTransition || graphTransitionTarget(link) !== 0) {
      beginGraphTransition(link, graphTransitionProgress(link, now), 0, now);
    }
    links.push(link);
  }

  return {
    displayData: { ...targetData, nodes, links },
    transitionItems: [...nodes, ...links].filter((item) => item.__bigBrainTransition),
  };
}

export function startGraphTransitionLoop(forceGraph, { items, onFrame, onComplete }) {
  cancelGraphTransitionLoop(forceGraph);
  if (!items?.length) return;

  const state = { frame: 0 };
  forceGraph.__bigBrainTransitionLoop = state;
  const tick = () => {
    if (forceGraph.__bigBrainTransitionLoop !== state) return;
    const now = performance.now();
    const active = items.some((item) => graphTransitionActive(item, now));
    onFrame?.(now);
    forceGraph.refresh?.();
    if (active) {
      state.frame = window.requestAnimationFrame(tick);
      return;
    }

    items.forEach(finishGraphTransition);
    forceGraph.__bigBrainTransitionLoop = null;
    onComplete?.();
  };

  state.frame = window.requestAnimationFrame(tick);
}

export function cancelGraphTransitionLoop(forceGraph) {
  const state = forceGraph?.__bigBrainTransitionLoop;
  if (!state) return;
  window.cancelAnimationFrame(state.frame);
  forceGraph.__bigBrainTransitionLoop = null;
}

function graphEndpointId(endpoint) {
  return typeof endpoint === 'object' ? endpoint?.id : endpoint;
}

function clamp(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}
