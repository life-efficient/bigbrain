import React, { memo, useEffect, useEffectEvent, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { TYPE_ORDER } from './graph/colors.js';
import { GRAPH_CONTROL_LABELS, graphVisualizers } from './graph/registry.jsx';
import { GRAPH_THEME_MODES, resolveThemeMode } from './graph/theme.js';
import { GraphThemeProvider } from './graph/visualizer-core.jsx';
import { MarkdownDocument } from './markdown.jsx';

function DashboardApp() {
  const [state, setState] = useState({ status: 'loading', error: null, data: null });
  const [view, setView] = useState('inbox');
  const [visualizerId, setVisualizerId] = useState(graphVisualizers[0].id);
  const [themeMode, setThemeMode] = useState('auto');
  const [prefersDark, setPrefersDark] = useState(false);
  const [preview, setPreview] = useState(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const visualizerRef = useRef(null);
  const healthMenuRef = useRef(null);

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
    if (!healthOpen) return undefined;

    function handlePointerDown(event) {
      if (healthMenuRef.current && !healthMenuRef.current.contains(event.target)) {
        setHealthOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setHealthOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [healthOpen]);

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
            <div className="topline-brand">
              <h1>bigbrain</h1>
            </div>
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
              <div className="health-menu" ref={healthMenuRef}>
                <button
                  type="button"
                  className={`health-button severity-${healthSeverity} ${healthFindingCount ? 'has-findings' : ''} ${healthOpen ? 'open' : ''}`}
                  aria-label={healthFindingCount ? `${healthFindingCount} health findings` : 'No health findings'}
                  aria-expanded={healthOpen}
                  onClick={() => setHealthOpen((value) => !value)}
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
                themeMode={themeMode}
                setThemeMode={setThemeMode}
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
  themeMode,
  setThemeMode,
  visualizerRef,
  onNodeOpen,
}) {
  const visualizer = graphVisualizers.find((item) => item.id === visualizerId) || graphVisualizers[0];
  const VisualizerComponent = visualizer.Component;
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const presentTypes = new Set(graphNodes.map((node) => node.type));
  const legendTypes = TYPE_ORDER.filter((type) => presentTypes.has(type));

  return (
    <section className="card hero-card">
      <div className="section-head">
        <div>
          <div className="graph-stats">
            <span className="pill"><strong>{Number.isFinite(graph?.meta?.page_count) ? graph.meta.page_count : 0}</strong> pages</span>
            <span className="pill"><strong>{Number.isFinite(graph?.meta?.edge_count) ? graph.meta.edge_count : 0}</strong> edges</span>
          </div>
          <div className="legend">
            {legendTypes.map((type) => (
              <span key={type}>{type}</span>
            ))}
          </div>
        </div>
        <div className="graph-toolbar">
          <label className="graph-select-shell">
            <span>Style</span>
            <select value={visualizerId} onChange={(event) => setVisualizerId(event.target.value)}>
              {graphVisualizers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="graph-select-shell">
            <span>Theme</span>
            <select value={themeMode} onChange={(event) => setThemeMode(event.target.value)}>
              {GRAPH_THEME_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode[0].toUpperCase() + mode.slice(1)}
                </option>
              ))}
            </select>
          </label>
          {visualizer.controls?.length ? (
            <div className="graph-controls graph-controls-inline">
              {visualizer.controls.map((control) => (
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
      <div className="graph-wrap graph-wrap-expanded">
        <VisualizerComponent ref={visualizerRef} graph={graph} onNodeOpen={onNodeOpen} />
      </div>
    </section>
  );
});

function stripSourceReferences(value) {
  return value.replace(/\s*\[Source:[^\]]+\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

const root = createRoot(document.getElementById('root'));
root.render(<DashboardApp />);
