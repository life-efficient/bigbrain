import React, { memo, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { TYPE_ORDER } from './graph/colors.js';
import {
  GRAPH_ARC_STYLES,
  GRAPH_CONTROL_LABELS,
  GRAPH_DEFAULTS,
  GRAPH_LABEL_STYLES,
  GRAPH_LAYOUT_STYLES,
  GRAPH_NODE_STYLES,
  graphVisualizers,
} from './graph/registry.jsx';
import { GRAPH_THEME_MODES, resolveThemeMode } from './graph/theme.js';
import { GraphThemeProvider } from './graph/visualizer-core.jsx';
import { MarkdownDocument } from './markdown.jsx';

class DashboardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Dashboard render failure', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <main>
          <section className="card loading-card error-card">
            <h1>bigbrain</h1>
            <p>The dashboard hit a frontend error.</p>
            <div className="error-actions">
              <button
                type="button"
                className="graph-button"
                onClick={() => window.location.reload()}
              >
                Reload dashboard
              </button>
            </div>
            <pre className="error-details">{String(this.state.error?.stack || this.state.error)}</pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function DashboardApp() {
  const [state, setState] = useState({ status: 'loading', error: null, data: null });
  const [view, setView] = useState('graph');
  const [visualizerId, setVisualizerId] = useState(GRAPH_DEFAULTS.visualizerId);
  const [nodeStyle, setNodeStyle] = useState(GRAPH_DEFAULTS.nodeStyle);
  const [arcStyle, setArcStyle] = useState(GRAPH_DEFAULTS.arcStyle);
  const [layoutStyle, setLayoutStyle] = useState(GRAPH_DEFAULTS.layoutStyle);
  const [labelStyle, setLabelStyle] = useState(GRAPH_DEFAULTS.labelStyle);
  const [themeMode, setThemeMode] = useState('auto');
  const [prefersDark, setPrefersDark] = useState(false);
  const [preview, setPreview] = useState(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const visualizerRef = useRef(null);
  const healthMenuRef = useRef(null);
  const settingsMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [schema, tasks, inbox, recent, health, graph] = await Promise.all([
          fetchJson('/api/schema'),
          fetchJson('/api/tasks'),
          fetchJson('/api/inbox'),
          fetchJson('/api/recent'),
          fetchJson('/api/health'),
          fetchJson('/api/graph'),
        ]);
        if (cancelled) return;
        setState({
          status: 'ready',
          error: null,
          data: { schema, tasks, inbox, recent, health, graph },
        });
      } catch (error) {
        if (cancelled) return;
        setState({ status: 'error', error: String(error), data: null });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncPreference = () => setPrefersDark(media.matches);
    syncPreference();
    media.addEventListener('change', syncPreference);
    return () => {
      media.removeEventListener('change', syncPreference);
    };
  }, []);

  useEffect(() => {
    if (!healthOpen && !settingsOpen) return undefined;

    function handlePointerDown(event) {
      if (healthMenuRef.current && !healthMenuRef.current.contains(event.target)) {
        setHealthOpen(false);
      }
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target)) {
        setSettingsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setHealthOpen(false);
        setSettingsOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [healthOpen, settingsOpen]);

  useEffect(() => {
    if (!preview || healthOpen) return undefined;

    function handleEscape(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key !== 'Escape') {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setPreview(null);
    }

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [preview, healthOpen]);

  useEffect(() => {
    function handleKeydown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'i') {
        event.preventDefault();
        setView('inbox');
      } else if (key === 't') {
        event.preventDefault();
        setView('tasks');
      } else if (key === 'g') {
        event.preventDefault();
        setView('graph');
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  const handleGraphNodeOpen = useEffectEvent(async (slug) => {
    setPreview({ status: 'loading', slug });
    try {
      const params = new URLSearchParams({ slug });
      const data = await fetchJson(`/api/page?${params.toString()}`);
      setPreview({ status: 'ready', ...data });
    } catch (error) {
      setPreview({
        status: 'error',
        slug,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  if (state.status === 'loading') {
    return (
      <main>
        <section className="card loading-card">
          <h1>bigbrain</h1>
          <p>Loading dashboard data…</p>
        </section>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main>
        <section className="card loading-card">
          <h1>bigbrain</h1>
          <p>{state.error}</p>
        </section>
      </main>
    );
  }

  const { schema, tasks, inbox, recent, health, graph } = state.data;
  const inboxItems = Array.isArray(inbox?.items) ? inbox.items : [];
  const taskSections = Array.isArray(tasks?.sections) ? tasks.sections : [];
  const healthFindingCount = Number.isFinite(health?.finding_count) ? health.finding_count : 0;
  const healthFindings = Array.isArray(health?.findings)
    ? health.findings
    : Array.isArray(health?.top_findings)
      ? health.top_findings
      : [];
  const healthSeverity = deriveHealthSeverity(healthFindings);

  const views = [
    { id: 'inbox', label: 'Inbox', count: inboxItems.length, shortcut: 'I' },
    { id: 'tasks', label: 'Tasks', count: Number.isFinite(tasks?.meta?.open_tasks) ? tasks.meta.open_tasks : 0, shortcut: 'T' },
    { id: 'graph', label: 'Graph', shortcut: 'G' },
  ];

  async function openPreview({ href, sourceSlug }) {
    setPreview({ status: 'loading', href, sourceSlug });
    try {
      const params = new URLSearchParams({ from: sourceSlug, target: href });
      const data = await fetchJson(`/api/preview?${params.toString()}`);
      setPreview({ status: 'ready', href, sourceSlug, ...data });
    } catch (error) {
      setPreview({
        status: 'error',
        href,
        sourceSlug,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function openInboxItem(item) {
    setPreview({
      status: 'ready',
      slug: item.slug,
      title: item.title,
      markdown: item.markdown,
    });
  }

  const resolvedTheme = resolveThemeMode(themeMode, prefersDark);

  return (
    <GraphThemeProvider resolvedTheme={resolvedTheme}>
      <div className={`page-shell theme-${resolvedTheme} ${preview ? 'preview-open' : ''}`} data-theme-mode={themeMode}>
        <main>
          <div className="topline">
            <div className="topline-brand" aria-hidden="true" />
            <div className="view-nav view-nav-header">
              {views.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`view-chip ${view === item.id ? 'active' : ''}`}
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                  {typeof item.count === 'number' ? <span className="view-chip-count">{item.count}</span> : null}
                  <kbd className="view-chip-kbd">{item.shortcut}</kbd>
                </button>
              ))}
            </div>
            <div className="topline-actions">
              <div className="settings-menu" ref={settingsMenuRef}>
                <button
                  type="button"
                  className={`settings-button ${settingsOpen ? 'open' : ''}`}
                  aria-label="Open settings"
                  aria-expanded={settingsOpen}
                  onClick={() => {
                    setHealthOpen(false);
                    setSettingsOpen((value) => !value);
                  }}
                >
                  <SettingsIcon />
                </button>
                {settingsOpen ? (
                  <div className="settings-dropdown" role="menu">
                    <div className="settings-dropdown-head">
                      <strong>Settings</strong>
                      <span className="meta">Appearance</span>
                    </div>
                    <div className="settings-field">
                      <span className="settings-label">Theme</span>
                      <ThemeModeToggle themeMode={themeMode} onChange={setThemeMode} />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="health-menu" ref={healthMenuRef}>
                <button
                  type="button"
                  className={`health-button severity-${healthSeverity} ${healthFindingCount ? 'has-findings' : ''} ${healthOpen ? 'open' : ''}`}
                  aria-label={healthFindingCount ? `${healthFindingCount} health findings` : 'No health findings'}
                  aria-expanded={healthOpen}
                  onClick={() => {
                    setSettingsOpen(false);
                    setHealthOpen((value) => !value);
                  }}
                >
                  <span className="health-icon" aria-hidden="true">{healthSeverity === 'high' ? '●' : '◌'}</span>
                  {healthFindingCount ? <span className="health-badge">{healthFindingCount}</span> : null}
                </button>
                {healthOpen ? (
                  <div className="health-dropdown" role="menu">
                    <div className="health-dropdown-head">
                      <strong>Health</strong>
                      <span className="meta">
                        {healthFindingCount ? `${healthFindingCount} item${healthFindingCount === 1 ? '' : 's'} to review` : 'All clear'}
                      </span>
                    </div>
                    {healthFindings.length ? (
                      <div className="health-dropdown-list">
                        {healthFindings.map((item, index) => (
                          <div key={`${item.page_slug || item.finding_type}:${index}`} className={`health-dropdown-item ${item.severity}`}>
                            <div className="health-dropdown-copy">{formatHealthMessage(item)}</div>
                            <div className="meta">{formatHealthMeta(item)}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-copy">No current health warnings.</div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className={`view-stage ${view === 'graph' ? 'view-stage-graph' : 'view-stage-list'}`}>
            {view === 'inbox' ? (
              <div className="list-page-card standalone-list-region">
                <div className="task-section">
                  {inboxItems.map((item) => (
                    <button
                      key={item.slug}
                      type="button"
                      className="task inbox-task-button"
                      onClick={() => openInboxItem(item)}
                    >
                      <div className="inbox-card-head">
                        <strong>{item.title}</strong>
                        <span className="meta">{item.slug}</span>
                      </div>
                      <div className="inbox-card-summary">
                        <MarkdownDocument
                          markdown={stripSourceReferences(item.summary || '')}
                          sourceSlug={item.slug}
                          onRelativeLinkClick={openPreview}
                          emptyLabel="Open to inspect full detail."
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {view === 'tasks' ? (
              <div className="list-page-card standalone-list-region">
                <div className="task-section">
                  {taskSections.map((section) => (
                    <div key={section.heading} className="task-group">
                      <h3>{section.heading}</h3>
                      {section.items.map((item, index) => (
                        <div key={`${section.heading}:${index}`} className={`task ${item.completed ? 'done' : ''}`}>
                          <MarkdownDocument
                            markdown={stripSourceReferences(item.markdown)}
                            sourceSlug={tasks.slug}
                            onRelativeLinkClick={openPreview}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {view === 'graph' ? (
              <GraphPanel
                graph={graph}
                visualizerId={visualizerId}
                setVisualizerId={setVisualizerId}
                nodeStyle={nodeStyle}
                setNodeStyle={setNodeStyle}
                arcStyle={arcStyle}
                setArcStyle={setArcStyle}
                layoutStyle={layoutStyle}
                setLayoutStyle={setLayoutStyle}
                labelStyle={labelStyle}
                setLabelStyle={setLabelStyle}
                visualizerRef={visualizerRef}
                onNodeOpen={handleGraphNodeOpen}
              />
            ) : null}
          </div>

        </main>

        <aside className="sidecar-shell" aria-hidden={!preview}>
          <div className="sidecar-panel">
            <div className="sidecar-head">
              <div>
                <h2>{preview?.title || 'Linked File'}</h2>
                <div className="meta">{preview?.slug || preview?.href || ''}</div>
              </div>
              <button type="button" className="graph-button" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            {preview?.status === 'loading' && <div className="empty-copy">Loading linked file…</div>}
            {preview?.status === 'error' && <div className="empty-copy">{preview.message}</div>}
            {preview?.status === 'ready' && (
              <MarkdownDocument
                markdown={preview.markdown}
                sourceSlug={preview.slug}
                onRelativeLinkClick={openPreview}
                emptyLabel="This file is empty."
              />
            )}
          </div>
        </aside>
      </div>
    </GraphThemeProvider>
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }
  return response.json();
}

function formatHealthMeta(item) {
  const parts = [];
  if (item.page_slug) parts.push(item.page_slug);
  if (item.finding_type) parts.push(item.finding_type.replaceAll('_', ' '));
  return parts.join(' · ');
}

function formatHealthMessage(item) {
  if (typeof item.message === 'string' && item.message.trim()) {
    return item.message;
  }

  switch (item.finding_type) {
    case 'git_status':
      return item.details?.clean === false ? 'Working tree has local changes.' : 'Git status needs review.';
    case 'missing_separator':
      return 'Missing required separator in page body.';
    case 'invalid_meeting_prep_heading':
      return 'Meeting prep has unexpected headings.';
    default:
      return item.finding_type ? item.finding_type.replaceAll('_', ' ') : 'Health finding';
  }
}

function deriveHealthSeverity(findings) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return 'clear';
  }
  if (findings.some((item) => item?.severity === 'high')) {
    return 'high';
  }
  if (findings.some((item) => item?.severity === 'medium')) {
    return 'medium';
  }
  return 'low';
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName;
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

const GraphPanel = memo(function GraphPanel({
  graph,
  visualizerId,
  setVisualizerId,
  nodeStyle,
  setNodeStyle,
  arcStyle,
  setArcStyle,
  layoutStyle,
  setLayoutStyle,
  labelStyle,
  setLabelStyle,
  visualizerRef,
  onNodeOpen,
}) {
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [selectedPageTypes, setSelectedPageTypes] = useState([]);
  const styleMenuRef = useRef(null);
  const filterMenuRef = useRef(null);
  const visualizer = graphVisualizers.find((item) => item.id === visualizerId) || graphVisualizers[0];
  const VisualizerComponent = visualizer.Component;
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const presentTypes = new Set(graphNodes.map((node) => node.type));
  const pageTypes = [
    ...TYPE_ORDER.filter((type) => presentTypes.has(type)),
    ...[...presentTypes].filter((type) => !TYPE_ORDER.includes(type)).sort(),
  ];
  const selectedTypeSet = useMemo(() => new Set(selectedPageTypes), [selectedPageTypes]);
  const filteredGraph = useMemo(() => {
    if (!selectedPageTypes.length) {
      return graph;
    }

    const nodes = graphNodes.filter((node) => selectedTypeSet.has(node.type));
    const slugs = new Set(nodes.map((node) => node.slug));
    const edges = (Array.isArray(graph?.edges) ? graph.edges : []).filter((edge) => {
      return slugs.has(edge.source) && slugs.has(edge.target);
    });

    return {
      ...graph,
      nodes,
      edges,
      meta: {
        ...graph?.meta,
        page_count: nodes.length,
        edge_count: edges.length,
      },
    };
  }, [graph, graphNodes, selectedPageTypes.length, selectedTypeSet]);
  const isCustomRenderer = visualizerId === 'custom';
  const visibleControls = Array.isArray(visualizer.controls)
    ? visualizer.controls.filter((control) => !['zoomIn', 'zoomOut', 'resetView'].includes(control))
    : [];

  useEffect(() => {
    if (!styleMenuOpen && !filterMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (styleMenuRef.current && !styleMenuRef.current.contains(event.target)) {
        setStyleMenuOpen(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
        setFilterMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setStyleMenuOpen(false);
        setFilterMenuOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [styleMenuOpen, filterMenuOpen]);

  function togglePageType(type) {
    setSelectedPageTypes((current) => (
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type]
    ));
  }

  return (
    <section className="card hero-card">
      <div className="graph-wrap graph-wrap-expanded">
        <VisualizerComponent
          ref={visualizerRef}
          graph={filteredGraph}
          onNodeOpen={onNodeOpen}
          nodeStyle={nodeStyle}
          arcStyle={arcStyle}
          layoutStyle={layoutStyle}
          labelStyle={labelStyle}
        />
      </div>
      <div className="graph-footer">
        <div>
          <div className="graph-stats">
            <span className="graph-stat"><strong>{Number.isFinite(filteredGraph?.meta?.page_count) ? filteredGraph.meta.page_count : 0}</strong> pages</span>
            <span className="graph-stat"><strong>{Number.isFinite(filteredGraph?.meta?.edge_count) ? filteredGraph.meta.edge_count : 0}</strong> edges</span>
          </div>
        </div>
        <div className="graph-toolbar">
          <div className="graph-filter-menu-shell" ref={filterMenuRef}>
            <button
              type="button"
              className={`icon-button graph-icon-button ${filterMenuOpen ? 'graph-button-active' : ''}`}
              aria-label="Filter page types"
              aria-expanded={filterMenuOpen}
              onClick={() => {
                setStyleMenuOpen(false);
                setFilterMenuOpen((value) => !value);
              }}
            >
              <FilterIcon />
            </button>
            {filterMenuOpen ? (
              <div className="graph-filter-menu" role="menu">
                <button
                  type="button"
                  className={`menu-item ${selectedPageTypes.length === 0 ? 'selected' : ''}`}
                  onClick={() => setSelectedPageTypes([])}
                  role="menuitemcheckbox"
                  aria-checked={selectedPageTypes.length === 0}
                >
                  <span>All page types</span>
                  <span className="menu-item-check" aria-hidden="true">{selectedPageTypes.length === 0 ? '✓' : ''}</span>
                </button>
                {pageTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`menu-item ${selectedTypeSet.has(type) ? 'selected' : ''}`}
                    onClick={() => togglePageType(type)}
                    role="menuitemcheckbox"
                    aria-checked={selectedTypeSet.has(type)}
                  >
                    <span>{type}</span>
                    <span className="menu-item-check" aria-hidden="true">{selectedTypeSet.has(type) ? '✓' : ''}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="graph-style-menu-shell" ref={styleMenuRef}>
            <button
              type="button"
              className={`graph-button ${styleMenuOpen ? 'graph-button-active' : ''}`}
              aria-expanded={styleMenuOpen}
              onClick={() => {
                setFilterMenuOpen(false);
                setStyleMenuOpen((value) => !value);
              }}
            >
              Graph style
            </button>
            {styleMenuOpen ? (
              <div className="graph-style-menu">
                <GraphStyleOptionGroup
                  label="Renderer"
                  value={visualizerId}
                  options={graphVisualizers}
                  onSelect={setVisualizerId}
                />
                <GraphStyleOptionGroup
                  label="Node"
                  value={nodeStyle}
                  options={GRAPH_NODE_STYLES}
                  onSelect={setNodeStyle}
                  disabled={!isCustomRenderer}
                />
                <GraphStyleOptionGroup
                  label="Arc"
                  value={arcStyle}
                  options={GRAPH_ARC_STYLES}
                  onSelect={setArcStyle}
                  disabled={!isCustomRenderer}
                />
                <GraphStyleOptionGroup
                  label="Spacing"
                  value={layoutStyle}
                  options={GRAPH_LAYOUT_STYLES}
                  onSelect={setLayoutStyle}
                  disabled={!isCustomRenderer}
                />
                <GraphStyleOptionGroup
                  label="Labels"
                  value={labelStyle}
                  options={GRAPH_LABEL_STYLES}
                  onSelect={setLabelStyle}
                  disabled={!isCustomRenderer}
                />
              </div>
            ) : null}
          </div>
          {visibleControls.length ? (
            <div className="graph-controls graph-controls-inline">
              {visibleControls.map((control) => (
                <button
                  key={control}
                  type="button"
                  className="graph-button"
                  onClick={() => visualizerRef.current?.[control]?.()}
                >
                  {GRAPH_CONTROL_LABELS[control] || control}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
});

function GraphStyleOptionGroup({ label, value, options, onSelect, disabled = false }) {
  return (
    <div className={`graph-menu-field ${disabled ? 'disabled' : ''}`}>
      <span>{label}</span>
      <div className="graph-option-grid">
        {options.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`graph-option-button ${value === item.id ? 'selected' : ''}`}
            onClick={() => onSelect(item.id)}
            disabled={disabled}
            aria-pressed={value === item.id}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeModeToggle({ themeMode, onChange }) {
  return (
    <div className="theme-toggle" role="group" aria-label="Theme mode">
      {GRAPH_THEME_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={`theme-toggle-button ${themeMode === mode ? 'active' : ''}`}
          onClick={() => onChange(mode)}
          aria-pressed={themeMode === mode}
        >
          {mode[0].toUpperCase() + mode.slice(1)}
        </button>
      ))}
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="settings-icon">
      <path
        d="M10 3h4l.45 2.23a7.78 7.78 0 0 1 1.53.63l1.96-1.12 2.83 2.83-1.12 1.96c.25.49.46 1 .63 1.53L23 11v4l-2.23.45a7.78 7.78 0 0 1-.63 1.53l1.12 1.96-2.83 2.83-1.96-1.12c-.49.25-1 .46-1.53.63L14 23h-4l-.45-2.23a7.78 7.78 0 0 1-1.53-.63l-1.96 1.12-2.83-2.83 1.12-1.96a7.78 7.78 0 0 1-.63-1.53L1 15v-4l2.23-.45c.17-.53.38-1.04.63-1.53L2.74 7.06l2.83-2.83 1.96 1.12c.49-.25 1-.46 1.53-.63L10 3Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M10.81 3h2.38l.4 1.97.31.08c.57.14 1.11.37 1.61.67l.28.17 1.73-.99 1.68 1.68-.99 1.73.17.28c.3.5.53 1.04.67 1.61l.08.31 1.97.4v2.38l-1.97.4-.08.31c-.14.57-.37 1.11-.67 1.61l-.17.28.99 1.73-1.68 1.68-1.73-.99-.28.17c-.5.3-1.04.53-1.61.67l-.31.08-.4 1.97h-2.38l-.4-1.97-.31-.08a6.9 6.9 0 0 1-1.61-.67l-.28-.17-1.73.99-1.68-1.68.99-1.73-.17-.28a6.9 6.9 0 0 1-.67-1.61l-.08-.31-1.97-.4v-2.38l1.97-.4.08-.31c.14-.57.37-1.11.67-1.61l.17-.28-.99-1.73 1.68-1.68 1.73.99.28-.17c.5-.3 1.04-.53 1.61-.67l.31-.08.4-1.97ZM12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="settings-icon">
      <path
        d="M4 5h16l-6.5 7.38V19l-3 1.5v-8.12L4 5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function stripSourceReferences(value) {
  return value.replace(/\s*\[Source:[^\]]+\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

const root = createRoot(document.getElementById('root'));
root.render(
  <DashboardErrorBoundary>
    <DashboardApp />
  </DashboardErrorBoundary>,
);
