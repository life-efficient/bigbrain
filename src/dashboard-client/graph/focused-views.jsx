import React, { memo, useId, useLayoutEffect, useMemo, useRef } from 'react';

import { getGraphNodeColor } from './colors.js';
import { useGraphTheme } from './visualizer-core.jsx';

const NETWORK_HOP_COLUMN_GAP = 560;
const NETWORK_NODE_X_GAP = 142;
const NETWORK_NODES_PER_ROW = 4;
const NETWORK_COLUMN_START = 118;
const NETWORK_TOP = 66;
const NETWORK_ROW_GAP = 48;
const NETWORK_BRANCH_GAP = 10;
const NETWORK_MIN_HEIGHT = 360;

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
  const layout = useMemo(() => buildFocusedNetworkLayout(graph, focusSlug), [focusSlug, graph]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const scrollToRight = () => {
      scroll.scrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    };
    scrollToRight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(scrollToRight);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [focusSlug, graph, layout.height, layout.width]);

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
                <text x="18" y={branch.y - 36} fill={theme.graphMutedLabel} className="focused-network-branch">
                  {branch.label}
                </text>
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
              const nodeColor = getGraphNodeColor(node, colorMode, typeColors) || theme.graphNode;
              const focused = node.slug === focusSlug;
              const title = node.title || node.slug;
              const showLabel = focused || Number(node.focus_hop) <= 1;
              return (
                <g
                  key={node.slug}
                  className={`focused-network-node ${focused ? 'focused' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                  role="button"
                  tabIndex="0"
                  aria-label={`Open ${node.title || node.slug}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNodeOpen?.(node.slug);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    onNodeOpen?.(node.slug);
                  }}
                >
                  <title>{`${title} · ${node.type || 'page'} · hop ${node.focus_hop || 0}`}</title>
                  <circle r={focused ? 14 : 11} fill={theme.graphBase} stroke={focused ? theme.graphLabel : theme.graphEdgeStrong} strokeWidth={focused ? 2 : 1} />
                  <circle r={focused ? 8 : 6} fill={nodeColor} fillOpacity="0.9" />
                  {showLabel ? (
                    <>
                      <text x="19" y="-2" fill={theme.graphLabel} className="focused-network-title">
                        {compactNodeTitle(title, focused ? 44 : 22)}
                      </text>
                      <text x="19" y="14" fill={theme.graphMutedLabel} className="focused-network-meta">
                        {node.type || 'page'} · hop {node.focus_hop || 0}
                      </text>
                    </>
                  ) : null}
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
      <div className="focused-view-heading">
        <div>
          <span className="focused-view-kicker">Timeline</span>
          <strong>Page updates and their sources</strong>
        </div>
        <span className="focused-view-hint">Structured timeline entries</span>
      </div>
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

function buildFocusedNetworkLayout(graph, focusSlug) {
  const sourceNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const sourceEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodes = sourceNodes.filter((node) => node?.slug);
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
  const branchSlotByKey = new Map();
  const branches = [];
  let nextBranchY = NETWORK_TOP;
  const nonFocusBranches = branchKeys.filter((branch) => branch !== focusSlug);
  for (let index = 0; index < nonFocusBranches.length; index += NETWORK_NODES_PER_ROW) {
    const pack = nonFocusBranches.slice(index, index + NETWORK_NODES_PER_ROW);
    const maxRows = Math.max(...pack.map((branch) => {
      const branchGroups = [...groups.entries()].filter(([key]) => key.startsWith(`${branch}\0`));
      return Math.max(...branchGroups.map(([, group]) => group.length), 1);
    }), 1);
    const packKey = `branch-pack-${index / NETWORK_NODES_PER_ROW}`;
    pack.forEach((branch, slot) => {
      branchBaseY.set(branch, nextBranchY);
      branchSlotByKey.set(branch, slot);
    });
    branches.push({ key: packKey, y: nextBranchY, label: null });
    nextBranchY += maxRows * NETWORK_ROW_GAP + NETWORK_BRANCH_GAP;
  }
  const contentHeight = Math.max(NETWORK_ROW_GAP, nextBranchY - NETWORK_BRANCH_GAP - NETWORK_TOP);
  if (focusSlug) {
    branchBaseY.set(focusSlug, NETWORK_TOP + Math.max(0, (contentHeight - NETWORK_ROW_GAP) / 2));
    branchSlotByKey.set(focusSlug, Math.floor(NETWORK_NODES_PER_ROW / 2));
    branches.unshift({ key: 'focused-branch', y: branchBaseY.get(focusSlug), label: 'Focused page' });
  }
  const slotBySlug = new Map();
  for (const group of groups.values()) {
    group.sort((left, right) => (
      String(left.focus_parent || '').localeCompare(String(right.focus_parent || ''))
      || String(left.title || left.slug).localeCompare(String(right.title || right.slug))
      || left.slug.localeCompare(right.slug)
    ));
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
      const branchSlot = branchSlotByKey.get(branch) || 0;
      const slot = slotBySlug.get(node.slug) || 0;
      return {
        ...node,
        x: column.startX + branchSlot * NETWORK_NODE_X_GAP,
        y: (branchBaseY.get(branch) || NETWORK_TOP) + slot * NETWORK_ROW_GAP,
      };
    });
  const nodeBySlug = new Map(laidOutNodes.map((node) => [node.slug, node]));
  const edges = sourceEdges.flatMap((edge, index) => {
    const source = nodeBySlug.get(edge?.source);
    const target = nodeBySlug.get(edge?.target);
    if (!source || !target || source.slug === target.slug) return [];
    return [{
      ...edge,
      key: `${edge.source}:${edge.target}:${edge.id || index}`,
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

function compactNodeTitle(value, maxLength) {
  const title = String(value || '').trim();
  if (title.length <= maxLength) return title;
  return `${title.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
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
