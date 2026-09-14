import React, { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getGraphNodeColor } from './colors.js';
import { useGraphTheme } from './visualizer-core.jsx';

const NETWORK_HOP_COLUMN_GAP = 320;
const NETWORK_NODE_X_GAP = 142;
const NETWORK_COLUMN_START = 118;
const NETWORK_TOP = 66;
const NETWORK_ROW_GAP = 56;
const NETWORK_LABEL_LINE_HEIGHT = 13;
const NETWORK_LABEL_CHARS_PER_LINE = 20;
const NETWORK_FOCUSED_LABEL_CHARS_PER_LINE = 40;
const NETWORK_BRANCH_GAP = 10;
const NETWORK_MIN_HEIGHT = 360;
const NETWORK_VISIBLE_CONTRIBUTORS = 5;
const COLLAPSED_NODE_PREFIX = '__bigbrain_focused_collapsed__';

export const FocusedNetworkVisualizer = memo(function FocusedNetworkVisualizer({
  graph,
  focusSlug,
  onNodeOpen,
  colorMode = 'updated',
  typeColors,
}) {
  const theme = useGraphTheme();
  const markerId = useId().replace(/:/g, '-');
  const scrollRef = useRef(null);
  const [expandedContributorGroups, setExpandedContributorGroups] = useState(() => new Set());
  const layout = useMemo(
    () => buildFocusedNetworkLayout(graph, focusSlug, expandedContributorGroups),
    [expandedContributorGroups, focusSlug, graph],
  );

  useEffect(() => {
    setExpandedContributorGroups(new Set());
  }, [focusSlug, graph]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const scrollToFocusedNode = () => {
      scroll.scrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const focusedNode = layout.nodes.find((node) => node.slug === focusSlug);
      const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      scroll.scrollTop = focusedNode
        ? Math.min(maxScrollTop, Math.max(0, focusedNode.y - scroll.clientHeight / 2))
        : 0;
    };
    scrollToFocusedNode();
    const frame = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(scrollToFocusedNode)
      : null;
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        if (frame !== null) window.cancelAnimationFrame(frame);
      };
    }
    const observer = new ResizeObserver(scrollToFocusedNode);
    observer.observe(scroll);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [focusSlug, graph, layout.height, layout.nodes, layout.width]);

  if (!layout.nodes.length) {
    return (
      <div className="focused-view-empty" role="status">
        No connected pages found for this focus.
      </div>
    );
  }

  return (
    <div className="focused-view focused-network-view" aria-label="Focused page network">
      <div ref={scrollRef} className="focused-network-scroll">
        <svg
          className="focused-network-svg"
          width={layout.width}
          height={layout.height}
          style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Pages leading into the focused page, arranged by graph distance"
        >
          <defs>
            <marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L7,3.5 L0,7 z" fill={theme.graphEdgeStrong} />
            </marker>
          </defs>
          {layout.columns.map((column) => (
            <g key={column.key} className="focused-network-column">
              <line x1={column.centerX} y1="42" x2={column.centerX} y2={layout.height - 24} stroke={theme.graphGrid} strokeDasharray="3 8" />
              <text x={column.centerX} y="24" textAnchor="middle" fill={theme.graphLabel} className="focused-network-hop">
                {column.label}
              </text>
            </g>
          ))}
          <g className="focused-network-branches" aria-hidden="true">
            {layout.branches.map((branch) => (
              <g key={branch.key}>
                <line x1="18" y1={branch.y - 28} x2={layout.width - 24} y2={branch.y - 28} stroke={theme.graphGrid} strokeDasharray="1 9" />
                {branch.label ? (
                  <text x="18" y={branch.y - 36} fill={theme.graphMutedLabel} className="focused-network-branch">
                    {branch.label}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
          <g className="focused-network-edges" aria-hidden="true">
            {layout.edges.map((edge) => (
              <path
                key={edge.key}
                d={networkEdgePath(edge.source, edge.target)}
                className={`focused-network-edge ${edge.lineage_event ? 'historical' : ''} ${edge.type === 'link-removed' ? 'removed' : ''}`}
                markerEnd={`url(#${markerId})`}
              />
            ))}
          </g>
          <g className="focused-network-nodes">
            {layout.nodes.map((node) => {
              const collapsed = Boolean(node.collapsed);
              const nodeColor = collapsed
                ? theme.graphMutedLabel
                : (getGraphNodeColor(node, colorMode, typeColors) || theme.graphNode);
              const focused = !collapsed && node.slug === focusSlug;
              const title = collapsed
                ? (node.collapsed_expanded ? '… show fewer contributors' : `… +${node.collapsed_count} more nodes`)
                : (node.title || node.slug);
              const titleLines = networkNodeTitleLines(title, focused);
              const metaY = -2 + titleLines.length * NETWORK_LABEL_LINE_HEIGHT + 5;
              return (
                <g
                  key={node.slug}
                  className={`focused-network-node ${focused ? 'focused' : ''} ${collapsed ? 'collapsed' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                  role="button"
                  tabIndex="0"
                  aria-label={collapsed
                    ? (node.collapsed_expanded ? 'Collapse contributors' : `Expand ${node.collapsed_count} hidden contributors`)
                    : `Open ${node.title || node.slug}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (collapsed) {
                      setExpandedContributorGroups((current) => {
                        const next = new Set(current);
                        if (next.has(node.collapsed_group_key)) next.delete(node.collapsed_group_key);
                        else next.add(node.collapsed_group_key);
                        return next;
                      });
                      return;
                    }
                    onNodeOpen?.(node.slug);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (collapsed) {
                      setExpandedContributorGroups((current) => {
                        const next = new Set(current);
                        if (next.has(node.collapsed_group_key)) next.delete(node.collapsed_group_key);
                        else next.add(node.collapsed_group_key);
                        return next;
                      });
                      return;
                    }
                    onNodeOpen?.(node.slug);
                  }}
                >
                  <title>{`${title} · ${collapsed ? 'contributors' : (node.type || 'page')}`}</title>
                  <circle r={focused ? 14 : 11} fill={theme.graphBase} stroke={focused ? theme.graphLabel : theme.graphEdgeStrong} strokeWidth={focused ? 2 : 1} />
                  <circle r={focused ? 8 : collapsed ? 5 : 6} fill={nodeColor} fillOpacity="0.9" />
                  <text x="19" y="-2" fill={theme.graphLabel} className="focused-network-title">
                    {titleLines.map((line, index) => (
                      <tspan key={`${line}:${index}`} x="19" dy={index === 0 ? 0 : NETWORK_LABEL_LINE_HEIGHT}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <text x="19" y={metaY} fill={theme.graphMutedLabel} className="focused-network-meta">
                    {collapsed ? 'contributors' : (node.type || 'page')}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
});

export const FocusedTimelineView = memo(function FocusedTimelineView({ lineage, updates: providedUpdates, onNodeOpen }) {
  const updates = Array.isArray(providedUpdates)
    ? providedUpdates
    : Array.isArray(lineage?.timeline_updates)
      ? lineage.timeline_updates
      : [];

  return (
    <div className="focused-view focused-timeline-view" aria-label="Focused page timeline">
      {lineage?.status === 'loading' ? <div className="focused-view-empty" role="status">Loading page history…</div> : null}
      {lineage?.status === 'error' ? <div className="focused-view-empty" role="status">{lineage.message || 'Timeline is unavailable.'}</div> : null}
      {lineage?.status === 'ready' && !updates.length ? (
        <div className="focused-view-empty" role="status">No structured timeline updates were recorded for these pages.</div>
      ) : null}
      {lineage?.status === 'ready' && updates.length ? (
        <div className="focused-timeline-list">
          {updates.map((update, index) => {
            const page = update.page || {};
            const slug = page.slug || update.page_slug;
            const title = page.title || update.page_title || slug || 'Untitled page';
            const provenance = update.provenance || {};
            const sourceLabel = provenance.source_label || provenance.source_type || 'Source not recorded';
            const sourceMessage = provenance.source_message && provenance.source_message !== update.text
              ? provenance.source_message
              : '';
            return (
              <article className="focused-timeline-entry" key={`${slug || 'page'}:${update.entry_id || index}`}>
                <div className="focused-timeline-marker" aria-hidden="true" />
                <div className="focused-timeline-entry-body">
                  <div className="focused-timeline-entry-meta">
                    <time dateTime={update.occurred_at || update.recorded_at || undefined}>
                      {formatTimelineUpdateDate(update)}
                    </time>
                    <span className="focused-timeline-source">Source: {sourceLabel}</span>
                  </div>
                  {slug ? (
                    <button type="button" className="focused-timeline-page" onClick={() => onNodeOpen?.(slug)}>
                      <strong>{title}</strong>
                      <span>{slug}</span>
                    </button>
                  ) : <strong className="focused-timeline-page-label">{title}</strong>}
                  <p>{update.text || 'Timeline update without visible text.'}</p>
                  {sourceMessage ? <div className="focused-timeline-source-message">{sourceMessage}</div> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

function buildFocusedNetworkLayout(graph, focusSlug, expandedContributorGroups = new Set()) {
  const sourceNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const sourceEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const rawNodes = sourceNodes.filter((node) => node?.slug);
  const sourceNodeBySlug = new Map(rawNodes.map((node) => [node.slug, node]));
  const contributorsByParent = new Map();
  for (const node of rawNodes) {
    const parentSlug = node.focus_parent;
    if (!parentSlug || node.slug === focusSlug || !sourceNodeBySlug.has(parentSlug)) continue;
    if (!contributorsByParent.has(parentSlug)) contributorsByParent.set(parentSlug, []);
    contributorsByParent.get(parentSlug).push(node);
  }

  const hiddenNodeSlugs = new Set();
  const collapsedSlugByHiddenSlug = new Map();
  const collapsedNodes = [];
  const contributorGroups = [...contributorsByParent.entries()].sort(([, left], [, right]) => (
    (Number(left[0]?.focus_hop) || 0) - (Number(right[0]?.focus_hop) || 0)
  ));
  for (const [parentSlug, contributors] of contributorGroups) {
    if (hiddenNodeSlugs.has(parentSlug)) continue;
    const orderedContributors = [...contributors].sort(sortFocusedNetworkNodes);
    if (orderedContributors.length <= NETWORK_VISIBLE_CONTRIBUTORS) continue;
    const parent = sourceNodeBySlug.get(parentSlug);
    const expanded = expandedContributorGroups.has(parentSlug);
    const hiddenContributors = expanded ? [] : orderedContributors.slice(NETWORK_VISIBLE_CONTRIBUTORS);
    const collapsedSlug = `${COLLAPSED_NODE_PREFIX}${parentSlug}`;
    hiddenContributors.forEach((node) => {
      hiddenNodeSlugs.add(node.slug);
      collapsedSlugByHiddenSlug.set(node.slug, collapsedSlug);
    });
    collapsedNodes.push({
      slug: collapsedSlug,
      title: expanded ? '… show fewer contributors' : `… +${hiddenContributors.length} more nodes`,
      type: 'contributors',
      focus_hop: orderedContributors[0]?.focus_hop ?? 1,
      focus_parent: parentSlug,
      focus_branch: parent?.focus_branch || parentSlug,
      collapsed: true,
      collapsed_expanded: expanded,
      collapsed_group_key: parentSlug,
      collapsed_count: orderedContributors.length - NETWORK_VISIBLE_CONTRIBUTORS,
    });
  }

  const nodes = rawNodes.filter((node) => !hiddenNodeSlugs.has(node.slug)).concat(collapsedNodes);
  const hopKeys = [...new Set(nodes.map((node) => {
    const hop = Number(node.focus_hop);
    return Number.isFinite(hop) ? Math.max(0, hop) : 0;
  }))].sort((left, right) => right - left);
  if (!hopKeys.length) hopKeys.push(0);
  const columns = hopKeys.map((hop, index) => {
    const startX = NETWORK_COLUMN_START + index * NETWORK_HOP_COLUMN_GAP;
    return {
      key: `hop-${hop}`,
      hop,
      startX,
      centerX: startX + ((NETWORK_NODES_PER_ROW - 1) * NETWORK_NODE_X_GAP) / 2,
      label: hop === 0 ? 'Focused page' : `${hop} hop${hop === 1 ? '' : 's'} back`,
    };
  });
  const columnByHop = new Map(columns.map((column) => [column.hop, column]));
  const branchKeys = [...new Set(nodes.map((node) => node.slug === focusSlug ? focusSlug : (node.focus_branch || node.slug)))].filter(Boolean);
  branchKeys.sort((left, right) => {
    if (left === focusSlug) return -1;
    if (right === focusSlug) return 1;
    return left.localeCompare(right);
  });
  const groups = new Map();
  for (const node of nodes) {
    const hop = Number.isFinite(Number(node.focus_hop)) ? Math.max(0, Number(node.focus_hop)) : 0;
    const branch = node.slug === focusSlug ? focusSlug : (node.focus_branch || node.slug);
    const key = `${branch}\0${hop}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  const branchBaseY = new Map();
  const branchRowGapByKey = new Map();
  const branches = [];
  let nextBranchY = NETWORK_TOP;
  const nonFocusBranches = branchKeys.filter((branch) => branch !== focusSlug);
  for (const branch of nonFocusBranches) {
    const branchGroups = [...groups.entries()].filter(([key]) => key.startsWith(`${branch}\0`));
    const maxRows = Math.max(...branchGroups.map(([, group]) => group.length), 1);
    const labelHeight = Math.max(...branchGroups
      .flatMap(([, group]) => group)
      .map((node) => networkNodeLabelHeight(node, focusSlug)), 0);
    const rowGap = Math.max(NETWORK_ROW_GAP, labelHeight);
    branchBaseY.set(branch, nextBranchY);
    branchRowGapByKey.set(branch, rowGap);
    branches.push({ key: `branch:${branch}`, y: nextBranchY, label: null });
    nextBranchY += maxRows * rowGap + NETWORK_BRANCH_GAP;
  }
  const contentHeight = Math.max(NETWORK_ROW_GAP, nextBranchY - NETWORK_BRANCH_GAP - NETWORK_TOP);
  if (focusSlug) {
    branchBaseY.set(focusSlug, NETWORK_TOP + Math.max(0, (contentHeight - NETWORK_ROW_GAP) / 2));
    branches.unshift({ key: 'focused-branch', y: branchBaseY.get(focusSlug), label: null });
  }
  const slotBySlug = new Map();
  for (const group of groups.values()) {
    group.sort(sortFocusedNetworkNodes);
    group.forEach((node, index) => slotBySlug.set(node.slug, index));
  }
  const laidOutNodes = [...nodes]
    .sort((left, right) => (
      (Number(right.focus_hop) || 0) - (Number(left.focus_hop) || 0)
      || String(left.focus_branch || left.slug).localeCompare(String(right.focus_branch || right.slug))
      || left.slug.localeCompare(right.slug)
    ))
    .map((node) => {
      const hop = Number.isFinite(Number(node.focus_hop)) ? Math.max(0, Number(node.focus_hop)) : 0;
      const column = columnByHop.get(hop) || columns.at(-1);
      const branch = node.slug === focusSlug ? focusSlug : (node.focus_branch || node.slug);
      const slot = slotBySlug.get(node.slug) || 0;
      return {
        ...node,
        x: column.centerX,
        y: (branchBaseY.get(branch) || NETWORK_TOP) + slot * (branchRowGapByKey.get(branch) || NETWORK_ROW_GAP),
      };
    });
  const nodeBySlug = new Map(laidOutNodes.map((node) => [node.slug, node]));
  const edgeKeys = new Set();
  const edges = sourceEdges.flatMap((edge, index) => {
    const sourceSlug = collapsedSlugByHiddenSlug.get(edge?.source) || edge?.source;
    const targetSlug = collapsedSlugByHiddenSlug.get(edge?.target) || edge?.target;
    const source = nodeBySlug.get(sourceSlug);
    const target = nodeBySlug.get(targetSlug);
    if (!source || !target || source.slug === target.slug) return [];
    const edgeKey = `${source.slug}:${target.slug}`;
    if (edgeKeys.has(edgeKey)) return [];
    edgeKeys.add(edgeKey);
    return [{
      ...edge,
      key: `${edgeKey}:${edge.id || index}`,
      source,
      target,
    }];
  });
  return {
    nodes: laidOutNodes,
    edges,
    columns,
    branches,
    width: Math.max(920, columns.at(-1).startX + (NETWORK_NODES_PER_ROW - 1) * NETWORK_NODE_X_GAP + 280),
    height: Math.max(NETWORK_MIN_HEIGHT, nextBranchY + 38),
  };
}

function sortFocusedNetworkNodes(left, right) {
  return (
    (left.collapsed_expanded ? 1 : 0) - (right.collapsed_expanded ? 1 : 0)
    || String(left.focus_parent || '').localeCompare(String(right.focus_parent || ''))
    || String(left.title || left.slug).localeCompare(String(right.title || right.slug))
    || left.slug.localeCompare(right.slug)
  );
}

function networkNodeTitleLines(value, focused = false) {
  const title = String(value || '').trim() || 'Untitled page';
  const maxCharsPerLine = focused ? NETWORK_FOCUSED_LABEL_CHARS_PER_LINE : NETWORK_LABEL_CHARS_PER_LINE;
  const lines = [];
  let current = '';
  for (const word of title.split(/\s+/)) {
    if (!word) continue;
    if (word.length > maxCharsPerLine) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let index = 0; index < word.length; index += maxCharsPerLine) {
        lines.push(word.slice(index, index + maxCharsPerLine));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maxCharsPerLine) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['Untitled page'];
}

function networkNodeLabelHeight(node, focusSlug) {
  const focused = node.slug === focusSlug;
  const titleLines = networkNodeTitleLines(node.title || node.slug, focused);
  return titleLines.length * NETWORK_LABEL_LINE_HEIGHT + 18;
}

function networkEdgePath(source, target) {
  const direction = target.x >= source.x ? 1 : -1;
  const distance = Math.max(56, Math.abs(target.x - source.x) * 0.36);
  return `M ${source.x} ${source.y} C ${source.x + direction * distance} ${source.y}, ${target.x - direction * distance} ${target.y}, ${target.x} ${target.y}`;
}

function dayKey(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function formatTimelineUpdateDate(update) {
  if (update.occurred_label) return update.occurred_label;
  const day = dayKey(update.occurred_at || update.recorded_at);
  return day || 'Undated update';
}
