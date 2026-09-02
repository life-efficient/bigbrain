import React, { memo, useId, useMemo } from 'react';

import { getGraphNodeColor } from './colors.js';
import { useGraphTheme } from './visualizer-core.jsx';

const NETWORK_COLUMN_GAP = 190;
const NETWORK_COLUMN_START = 118;
const NETWORK_TOP = 72;
const NETWORK_ROW_GAP = 92;
const NETWORK_MIN_HEIGHT = 420;

export const FocusedNetworkVisualizer = memo(function FocusedNetworkVisualizer({
  graph,
  focusSlug,
  onNodeOpen,
  colorMode = 'updated',
  typeColors,
}) {
  const theme = useGraphTheme();
  const markerId = useId().replace(/:/g, '-');
  const layout = useMemo(() => buildFocusedNetworkLayout(graph), [graph]);

  if (!layout.nodes.length) {
    return (
      <div className="focused-view-empty" role="status">
        No connected pages found for this focus.
      </div>
    );
  }

  return (
    <div className="focused-view focused-network-view" aria-label="Focused page network">
      <div className="focused-view-heading">
        <div>
          <span className="focused-view-kicker">Network</span>
          <strong>Related pages by update order</strong>
        </div>
        <span className="focused-view-hint">Older updates → newer updates</span>
      </div>
      <div className="focused-network-scroll">
        <svg
          className="focused-network-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Pages connected to the focused page, ordered by update date"
        >
          <defs>
            <marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L7,3.5 L0,7 z" fill={theme.graphEdgeStrong} />
            </marker>
          </defs>
          {layout.columns.map((column) => (
            <g key={column.key} className="focused-network-column">
              <line x1={column.x} y1="42" x2={column.x} y2={layout.height - 24} stroke={theme.graphGrid} strokeDasharray="3 8" />
              <text x={column.x} y="24" textAnchor="middle" fill={theme.graphLabel} className="focused-network-date">
                {column.label}
              </text>
            </g>
          ))}
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
                  <circle r={focused ? 14 : 11} fill={theme.graphBase} stroke={focused ? theme.graphLabel : theme.graphEdgeStrong} strokeWidth={focused ? 2 : 1} />
                  <circle r={focused ? 8 : 6} fill={nodeColor} fillOpacity="0.9" />
                  <text x="19" y="-2" fill={theme.graphLabel} className="focused-network-title">
                    {node.title || node.slug}
                  </text>
                  <text x="19" y="14" fill={theme.graphMutedLabel} className="focused-network-meta">
                    {node.type || 'page'} · hop {node.focus_hop || 0}
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

function buildFocusedNetworkLayout(graph) {
  const sourceNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const sourceEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const dateKeys = [...new Set(sourceNodes.map((node) => dayKey(node.network_at || node.updated_at || node.created_at)).filter(Boolean))].sort();
  if (!dateKeys.length) dateKeys.push('undated');
  const columnByDate = new Map(dateKeys.map((key, index) => [key, index]));
  const columns = dateKeys.map((key, index) => ({
    key,
    x: NETWORK_COLUMN_START + index * NETWORK_COLUMN_GAP,
    label: key === 'undated' ? 'Undated' : key,
  }));
  const nodes = [...sourceNodes]
    .filter((node) => node?.slug)
    .sort((left, right) => (
      (Number(left.focus_hop) || 0) - (Number(right.focus_hop) || 0)
      || String(left.network_at || '').localeCompare(String(right.network_at || ''))
      || String(left.title || left.slug).localeCompare(String(right.title || right.slug))
    ));
  const rowsByColumn = new Map();
  const laidOutNodes = nodes.map((node) => {
    const date = dayKey(node.network_at || node.updated_at || node.created_at) || 'undated';
    const column = columnByDate.get(date) ?? 0;
    const row = rowsByColumn.get(column) || 0;
    rowsByColumn.set(column, row + 1);
    return {
      ...node,
      x: columns[column].x,
      y: NETWORK_TOP + row * NETWORK_ROW_GAP,
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
  const maxRows = Math.max(...rowsByColumn.values(), 1);
  return {
    nodes: laidOutNodes,
    edges,
    columns,
    width: Math.max(920, columns.at(-1).x + 280),
    height: Math.max(NETWORK_MIN_HEIGHT, NETWORK_TOP + maxRows * NETWORK_ROW_GAP + 96),
  };
}

function networkEdgePath(source, target) {
  const distance = Math.max(56, Math.abs(target.x - source.x) * 0.36);
  return `M ${source.x} ${source.y} C ${source.x + distance} ${source.y}, ${target.x - distance} ${target.y}, ${target.x} ${target.y}`;
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
