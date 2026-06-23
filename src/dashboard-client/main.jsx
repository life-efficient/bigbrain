import React, { memo, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as SelectPrimitive from '@radix-ui/react-select';

import { TYPE_ORDER } from './graph/colors.js';
import {
  GRAPH_ARC_STYLES,
  GRAPH_COLOR_MODES,
  GRAPH_CONTROL_LABELS,
  GRAPH_DEFAULTS,
  GRAPH_LABEL_STYLES,
  GRAPH_LAYOUT_STYLES,
  GRAPH_NODE_STYLES,
  graphVisualizers,
} from './graph/registry.jsx';
import { GRAPH_THEME_MODES, resolveThemeMode } from './graph/theme.js';
import { GraphThemeProvider } from './graph/visualizer-core.jsx';
import { resolveExplorerLinkPath } from './explorer-links.js';
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
        <main className="fallback-main">
          <section className="card loading-card error-card">
            <h1>Dashboard unavailable</h1>
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
  const [colorMode, setColorMode] = useState(GRAPH_DEFAULTS.colorMode);
  const [themeMode, setThemeMode] = useState('auto');
  const [prefersDark, setPrefersDark] = useState(false);
  const [preview, setPreview] = useState(null);
  const [activeGraphSlug, setActiveGraphSlug] = useState(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [assigneeLoading, setAssigneeLoading] = useState(false);
  const defaultAssigneeAppliedRef = useRef(false);
  const visualizerRef = useRef(null);
  const healthMenuRef = useRef(null);
  const settingsMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setAssigneeLoading(true);
      try {
        const assigneeQuery = assigneeFilter ? `?${new URLSearchParams({ assignee: assigneeFilter }).toString()}` : '';
        const [schema, tasks, inbox, recent, health, graph, explorer, explorerRecent] = await Promise.all([
          fetchJson('/api/schema'),
          fetchJson(`/api/tasks${assigneeQuery}`),
          fetchJson(`/api/inbox${assigneeQuery}`),
          fetchJson('/api/recent'),
          fetchJson('/api/health'),
          fetchJson('/api/graph'),
          fetchJson('/api/explorer/tree'),
          fetchJson('/api/explorer/recent'),
        ]);
        if (cancelled) return;
        const currentMemberSlug = tasks?.filters?.current_member?.person_slug || inbox?.filters?.current_member?.person_slug || '';
        if (!defaultAssigneeAppliedRef.current && !assigneeFilter && currentMemberSlug) {
          defaultAssigneeAppliedRef.current = true;
          setAssigneeFilter(currentMemberSlug);
          return;
        }
        defaultAssigneeAppliedRef.current = true;
        setAssigneeLoading(false);
        setState({
          status: 'ready',
          error: null,
          data: { schema, tasks, inbox, recent, health, graph, explorer: { ...explorer, recent: explorerRecent } },
        });
      } catch (error) {
        if (cancelled) return;
        setAssigneeLoading(false);
        setState({ status: 'error', error: String(error), data: null });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [assigneeFilter]);

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
      setActiveGraphSlug(null);
    }

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [preview, healthOpen]);

  useEffect(() => {
    if (!preview) return undefined;

    function handlePointerDown(event) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.sidecar-panel')) return;
      setPreview(null);
      setActiveGraphSlug(null);
    }

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [preview]);

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
      } else if (key === 'e') {
        event.preventDefault();
        setView('explorer');
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  const handleGraphNodeOpen = useEffectEvent(async (slug) => {
    setActiveGraphSlug(slug || null);
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

  const openPageBySlug = useEffectEvent((slug) => {
    if (!slug) return;
    handleGraphNodeOpen(slug);
  });

  if (state.status === 'loading') {
    return (
      <LoadingSplash />
    );
  }

  if (state.status === 'error') {
    return (
      <main className="fallback-main">
        <section className="card loading-card error-card">
          <h1>Dashboard unavailable</h1>
          <p>{state.error}</p>
        </section>
      </main>
    );
  }

  const { schema, tasks, inbox, recent, health, graph, explorer } = state.data;
  const inboxItems = Array.isArray(inbox?.items) ? inbox.items : [];
  const taskSections = Array.isArray(tasks?.sections) ? tasks.sections : [];
  const members = Array.isArray(tasks?.members) ? tasks.members : Array.isArray(inbox?.members) ? inbox.members : [];
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
    { id: 'explorer', label: 'Explorer', shortcut: 'E' },
  ];

  async function openPreview({ href, sourceSlug }) {
    setPreview({ status: 'loading', href, sourceSlug });
    try {
      const params = new URLSearchParams({ from: sourceSlug, target: href });
      const data = await fetchJson(`/api/preview?${params.toString()}`);
      setActiveGraphSlug(data.slug || null);
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
    if (item?.slug) {
      openPageBySlug(item.slug);
      return;
    }
    setPreview({ status: 'ready', title: item?.title, markdown: item?.markdown });
  }

  function handlePreviewCardKeyDown(event, callback) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    callback();
  }

  function handleAssigneeFilterChange(nextAssignee) {
    if (nextAssignee === assigneeFilter) return;
    setAssigneeLoading(true);
    setAssigneeFilter(nextAssignee);
  }

  const resolvedTheme = resolveThemeMode(themeMode, prefersDark);

  return (
    <GraphThemeProvider resolvedTheme={resolvedTheme}>
      <div className={`page-shell theme-${resolvedTheme} view-${view} ${preview ? 'preview-open' : ''}`} data-theme-mode={themeMode}>
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

          <div className={`view-stage ${view === 'graph' || view === 'explorer' ? 'view-stage-graph' : 'view-stage-list'}`}>
            {view === 'inbox' ? (
              <div className="list-page-card standalone-list-region">
                <AssigneeFilter members={members} value={assigneeFilter} onChange={handleAssigneeFilterChange} disabled={assigneeLoading} />
                <div className="task-section">
                  {assigneeLoading ? <ListLoadingState label="Loading inbox" /> : inboxItems.map((item) => (
                    <div
                      key={item.slug}
                      className="task inbox-task-button"
                      role="button"
                      tabIndex={0}
                      onClick={() => openInboxItem(item)}
                      onKeyDown={(event) => handlePreviewCardKeyDown(event, () => openInboxItem(item))}
                    >
                      <div className="inbox-card-head">
                        <strong>{item.title}</strong>
                        <span className="meta">{item.slug}</span>
                      </div>
                      <AssigneePills assignees={item.assignees} invalidAssignees={item.invalid_assignees} />
                      <div className="inbox-card-summary">
                        <MarkdownDocument
                          markdown={stripSourceReferences(item.summary || '')}
                          sourceSlug={item.slug}
                          onRelativeLinkClick={openPreview}
                          emptyLabel="Open to inspect full detail."
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {view === 'tasks' ? (
              <div className="list-page-card standalone-list-region">
                <AssigneeFilter members={members} value={assigneeFilter} onChange={handleAssigneeFilterChange} disabled={assigneeLoading} />
                <div className="task-section">
                  {assigneeLoading ? <ListLoadingState label="Loading tasks" /> : taskSections.map((section) => (
                    <div key={section.heading} className="task-group">
                      <h3>{section.heading}</h3>
                      {section.items.map((item, index) => (
                        <div
                          key={`${section.heading}:${index}`}
                          className={`task ${item.slug ? 'task-preview-button' : ''} ${item.completed ? 'done' : ''}`}
                          role={item.slug ? 'button' : undefined}
                          tabIndex={item.slug ? 0 : undefined}
                          onClick={item.slug ? () => openPageBySlug(item.slug) : undefined}
                          onKeyDown={item.slug ? (event) => handlePreviewCardKeyDown(event, () => openPageBySlug(item.slug)) : undefined}
                        >
                          <AssigneePills assignees={item.assignees} invalidAssignees={item.invalid_assignees} />
                          <MarkdownDocument
                            markdown={stripSourceReferences(item.markdown)}
                            sourceSlug={item.slug || tasks.slug}
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
                colorMode={colorMode}
                setColorMode={setColorMode}
                visualizerRef={visualizerRef}
                activeSlug={activeGraphSlug}
                onActiveSlugChange={setActiveGraphSlug}
                onNodeOpen={handleGraphNodeOpen}
              />
            ) : null}

            {view === 'explorer' ? (
              <ExplorerPanel
                explorer={explorer}
              />
            ) : null}
          </div>

        </main>

        <PageSidecar
          preview={preview}
          onClose={() => {
            setPreview(null);
            setActiveGraphSlug(null);
          }}
          onRelativeLinkClick={openPreview}
          onPageOpen={openPageBySlug}
        />
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

function LoadingSplash() {
  const nodes = useMemo(() => [
    { x: 23, y: 42, r: 3 },
    { x: 35, y: 28, r: 2.4 },
    { x: 43, y: 54, r: 2.8 },
    { x: 55, y: 35, r: 3.2 },
    { x: 66, y: 49, r: 2.5 },
    { x: 76, y: 31, r: 2.2 },
  ], []);
  const edges = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 4],
    [4, 5],
  ];

  return (
    <main className="splash-main" aria-busy="true">
      <section className="splash-stage" aria-label="Loading dashboard">
        <div className="splash-mark" aria-hidden="true">
          <img src="/assets/apple-touch-icon.png" alt="" />
          <svg viewBox="0 0 100 76" className="splash-graph">
            <rect x="1" y="1" width="98" height="74" rx="18" />
            {edges.map(([from, to]) => (
              <line
                key={`${from}:${to}`}
                x1={nodes[from].x}
                y1={nodes[from].y}
                x2={nodes[to].x}
                y2={nodes[to].y}
              />
            ))}
            {nodes.map((node, index) => (
              <circle
                key={index}
                cx={node.x}
                cy={node.y}
                r={node.r}
                style={{ animationDelay: `${index * 120}ms` }}
              />
            ))}
          </svg>
        </div>
        <div className="splash-copy">
          <div className="splash-kicker">Opening brain</div>
          <div className="splash-status">Loading graph, tasks, and recent changes</div>
        </div>
        <div className="splash-progress" aria-hidden="true">
          <span />
        </div>
      </section>
    </main>
  );
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

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName;
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

const ALL_MEMBERS_VALUE = '__all_members__';

function AssigneeFilter({ members, value, onChange, disabled = false }) {
  const selectedValue = value || ALL_MEMBERS_VALUE;
  return (
    <div className="filter-bar" aria-label="Assignee filter">
      <span className="filter-label" id="assignee-filter-label">Member</span>
      <SelectPrimitive.Root
        value={selectedValue}
        onValueChange={(nextValue) => onChange(nextValue === ALL_MEMBERS_VALUE ? '' : nextValue)}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          className="shadcn-select-trigger"
          aria-labelledby="assignee-filter-label"
        >
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon className="shadcn-select-icon" aria-hidden="true">⌄</SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="shadcn-select-content" position="popper" sideOffset={6}>
            <SelectPrimitive.Viewport className="shadcn-select-viewport">
              <SelectItem value={ALL_MEMBERS_VALUE}>All members</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.person_slug} value={member.person_slug}>
                  {member.name || member.person_slug}
                </SelectItem>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

function SelectItem({ value, children }) {
  return (
    <SelectPrimitive.Item className="shadcn-select-item" value={value}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="shadcn-select-check" aria-hidden="true">✓</SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function ListLoadingState({ label }) {
  return (
    <div className="list-loading-state" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function AssigneePills({ assignees, invalidAssignees }) {
  const valid = Array.isArray(assignees) ? assignees : [];
  const invalid = Array.isArray(invalidAssignees) ? invalidAssignees : [];
  if (!valid.length && !invalid.length) return null;
  return (
    <div className="assignee-row">
      {valid.map((member) => (
        <span key={member.person_slug} className="assignee-pill">{member.name || member.person_slug}</span>
      ))}
      {invalid.map((slug) => (
        <span key={slug} className="assignee-pill invalid">{slug}</span>
      ))}
    </div>
  );
}

function PageSidecar({ preview, onClose, onRelativeLinkClick, onPageOpen }) {
  const type = preview?.type || preview?.slug?.split('/')[0] || 'page';
  const updatedLabel = formatDateTime(preview?.updated_at);
  const pathLabel = preview?.path || preview?.slug || preview?.href || '';
  const summary = typeof preview?.summary === 'string' ? preview.summary.trim() : '';
  const outgoing = Array.isArray(preview?.links?.outgoing) ? preview.links.outgoing : [];
  const backlinks = Array.isArray(preview?.links?.backlinks) ? preview.links.backlinks : [];
  const hasLinks = outgoing.length || backlinks.length;

  return (
    <aside className="sidecar-shell" aria-hidden={!preview}>
      <div className="sidecar-panel">
        <div className="sidecar-head">
          <div className="sidecar-title-row">
            <div className="sidecar-title-copy">
              <div className="sidecar-meta-row">
                <span className="sidecar-chip strong">{type}</span>
                {updatedLabel ? <span className="sidecar-chip">{updatedLabel}</span> : null}
              </div>
              {pathLabel ? <div className="meta">{pathLabel}</div> : null}
            </div>
            <button type="button" className="graph-button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="sidecar-body">
          {preview?.status === 'loading' && <div className="empty-copy">Loading page…</div>}
          {preview?.status === 'error' && <div className="empty-copy">{preview.message}</div>}
          {preview?.status === 'ready' ? (
            <>
              {summary ? (
                <div className="sidecar-summary">
                  <MarkdownDocument
                    markdown={summary}
                    sourceSlug={preview.slug}
                    onRelativeLinkClick={onRelativeLinkClick}
                  />
                </div>
              ) : null}
              <div className={`sidecar-document ${hasLinks ? 'has-link-sections' : ''}`}>
                <MarkdownDocument
                  markdown={preview.markdown}
                  sourceSlug={preview.slug}
                  onRelativeLinkClick={onRelativeLinkClick}
                  emptyLabel="This file is empty."
                />
              </div>
              <PageLinkSection title="Links out" links={outgoing} onPageOpen={onPageOpen} />
              <PageLinkSection title="Backlinks" links={backlinks} onPageOpen={onPageOpen} />
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function PageLinkSection({ title, links, onPageOpen }) {
  if (!links.length) return null;
  return (
    <div className="sidecar-section">
      <h3>{title}</h3>
      <div className="sidecar-link-grid">
        {links.map((link) => (
          <button
            key={`${title}:${link.slug}`}
            type="button"
            className="sidecar-link-button"
            onClick={() => onPageOpen(link.slug)}
          >
            <span className="sidecar-link-title">{link.label || link.slug}</span>
            <span className="sidecar-link-meta">{link.slug}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExplorerPanel({ explorer }) {
  const root = explorer?.root;
  const recentFiles = Array.isArray(explorer?.recent?.files) ? explorer.recent.files : [];
  const [explorerView, setExplorerView] = useState('folders');
  const [openPaths, setOpenPaths] = useState(() => new Set(['']));
  const [selectedPath, setSelectedPath] = useState('');
  const [fileState, setFileState] = useState({ status: 'idle', file: null, error: null });
  const [treeWidth, setTreeWidth] = useState(310);
  const shellRef = useRef(null);

  const openFilePath = useEffectEvent(async (filePath, fallback = {}) => {
    if (!filePath) return;
    const name = fallback.name || filePath.split('/').pop() || filePath;
    setSelectedPath(filePath);
    expandParentDirectories(filePath);
    setFileState({ status: 'loading', file: { path: filePath, name, kind: fallback.kind }, error: null });
    try {
      const data = await fetchJson(`/api/explorer/file?${new URLSearchParams({ path: filePath }).toString()}`);
      setFileState({ status: 'ready', file: data, error: null });
    } catch (error) {
      setFileState({ status: 'error', file: { path: filePath, name }, error: error instanceof Error ? error.message : String(error) });
    }
  });

  const openFile = useEffectEvent((entry) => {
    if (!entry?.path || entry.type !== 'file') return;
    openFilePath(entry.path, { name: entry.name, kind: entry.kind });
  });

  const openExplorerLink = useEffectEvent(({ href, sourcePath }) => {
    const filePath = resolveExplorerLinkPath(sourcePath, href);
    if (!filePath) return;
    openFilePath(filePath);
  });

  function expandParentDirectories(filePath) {
    const parts = filePath.split('/').filter(Boolean);
    setOpenPaths((current) => {
      const next = new Set(current);
      next.add('');
      for (let index = 1; index < parts.length; index += 1) {
        next.add(parts.slice(0, index).join('/'));
      }
      return next;
    });
  }

  function toggleDirectory(pathValue) {
    setOpenPaths((current) => {
      const next = new Set(current);
      if (next.has(pathValue)) {
        next.delete(pathValue);
      } else {
        next.add(pathValue);
      }
      return next;
    });
  }

  function resizeExplorerTree(event) {
    event.preventDefault();
    const shell = shellRef.current;
    const bounds = shell?.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = treeWidth;
    const maxWidth = bounds ? Math.max(220, Math.min(560, bounds.width - 360)) : 560;

    function handlePointerMove(moveEvent) {
      const nextWidth = clamp(startWidth + moveEvent.clientX - startX, 220, maxWidth);
      setTreeWidth(nextWidth);
    }

    function handlePointerUp() {
      document.body.classList.remove('explorer-resizing');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    }

    document.body.classList.add('explorer-resizing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  if (!root) {
    return (
      <section className="explorer-shell">
        <div className="empty-copy">Explorer unavailable.</div>
      </section>
    );
  }

  return (
    <section
      className="explorer-shell"
      ref={shellRef}
      style={{ '--explorer-tree-width': `${treeWidth}px` }}
    >
      <div className="explorer-tree" aria-label="Brain file explorer">
        <div className="explorer-tree-head">
          <span className="explorer-tree-title">Explorer</span>
          <div className="explorer-view-toggle" role="group" aria-label="Explorer view">
            {[
              ['folders', 'Folders'],
              ['recents', 'Recents'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`explorer-toggle-button ${explorerView === id ? 'active' : ''}`}
                aria-pressed={explorerView === id}
                onClick={() => setExplorerView(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {explorerView === 'folders' ? (
          <ExplorerTreeNode
            node={root}
            depth={0}
            openPaths={openPaths}
            selectedPath={selectedPath}
            onToggle={toggleDirectory}
            onOpenFile={openFile}
          />
        ) : (
          <ExplorerRecentList
            files={recentFiles}
            selectedPath={selectedPath}
            onOpenFile={openFile}
          />
        )}
      </div>
      <div
        className="explorer-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file list"
        tabIndex={0}
        onPointerDown={resizeExplorerTree}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setTreeWidth((current) => clamp(current + (event.key === 'ArrowRight' ? 24 : -24), 220, 560));
        }}
      />
      <ExplorerViewer
        fileState={fileState}
        onRelativeLinkClick={openExplorerLink}
      />
    </section>
  );
}

function ExplorerRecentList({ files, selectedPath, onOpenFile }) {
  if (!files.length) {
    return <div className="empty-copy">No recent files.</div>;
  }
  return (
    <div className="explorer-recents">
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          className={`explorer-recent-row ${selectedPath === file.path ? 'selected' : ''}`}
          onClick={() => onOpenFile(file)}
        >
          <span className="explorer-glyph">{fileGlyph(file)}</span>
          <span className="explorer-recent-copy">
            <span className="explorer-recent-name">{file.name || file.path}</span>
            <span className="explorer-recent-path">{file.path}</span>
            <span className="explorer-recent-meta">{formatDateTime(file.updated_at)} | {formatFileSize(file.size)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ExplorerTreeNode({ node, depth, openPaths, selectedPath, onToggle, onOpenFile }) {
  const isDirectory = node.type === 'directory';
  const isOpen = isDirectory && openPaths.has(node.path || '');
  const isSelected = !isDirectory && selectedPath === node.path;
  const children = Array.isArray(node.children) ? node.children : [];
  const label = node.path ? node.name : 'brain';
  return (
    <div className="explorer-node">
      <button
        type="button"
        className={`explorer-row ${isSelected ? 'selected' : ''}`}
        style={{ '--depth': depth }}
        onClick={() => {
          if (isDirectory) {
            onToggle(node.path || '');
          } else {
            onOpenFile(node);
          }
        }}
      >
        <span className="explorer-twist">{isDirectory ? (isOpen ? '⌄' : '›') : ''}</span>
        <span className={`explorer-glyph ${isDirectory ? 'folder' : ''}`}>{isDirectory ? '▣' : fileGlyph(node)}</span>
        <span className="explorer-label">{label}</span>
      </button>
      {isDirectory && isOpen ? (
        <div className="explorer-children">
          {children.map((child) => (
            <ExplorerTreeNode
              key={child.path || child.name}
              node={child}
              depth={depth + 1}
              openPaths={openPaths}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ExplorerViewer({ fileState, onRelativeLinkClick }) {
  const file = fileState.file;
  const [copiedPath, setCopiedPath] = useState(false);
  const copyResetTimerRef = useRef(null);
  useEffect(() => {
    setCopiedPath(false);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, [file?.path]);
  async function copyFilePath() {
    if (!file?.path) return;
    try {
      await copyTextToClipboard(file.path);
      setCopiedPath(true);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedPath(false);
        copyResetTimerRef.current = null;
      }, 1200);
    } catch (error) {
      console.warn('Unable to copy file path', error);
    }
  }
  if (fileState.status === 'idle') {
    return (
      <div className="explorer-viewer empty">
        <div className="empty-copy">Select a file to preview.</div>
      </div>
    );
  }
  if (fileState.status === 'loading') {
    return (
      <div className="explorer-viewer empty">
        <div className="empty-copy">Opening {file?.path}…</div>
      </div>
    );
  }
  if (fileState.status === 'error') {
    return (
      <div className="explorer-viewer empty">
        <div className="empty-copy">{fileState.error}</div>
      </div>
    );
  }
  const sourceSlug = file.path?.endsWith('.md') ? file.path.replace(/\.md$/i, '') : '';
  return (
    <div className="explorer-viewer">
      <div className="explorer-viewer-head">
        <strong>{file.name || file.path}</strong>
        <div className="explorer-viewer-path-row">
          <span className="meta">{file.path}</span>
          <div className="explorer-viewer-actions" aria-label="File actions">
            <button
              type="button"
              className={`icon-button explorer-header-button ${copiedPath ? 'copied' : ''}`}
              onClick={copyFilePath}
              aria-label="Copy file path"
              title={copiedPath ? 'Copied' : 'Copy file path'}
            >
              <CopyIcon />
            </button>
            <a
              className="icon-button explorer-header-button"
              href={file.blob_url}
              download={file.name || ''}
              aria-label="Download file"
              title="Download file"
            >
              <DownloadIcon />
            </a>
          </div>
        </div>
      </div>
      <div className="explorer-viewer-body">
        {file.kind === 'markdown' ? (
          <ExplorerMarkdownPreview
            markdown={file.text || ''}
            sourceSlug={sourceSlug}
            onRelativeLinkClick={({ href }) => onRelativeLinkClick?.({ href, sourcePath: file.path })}
            emptyLabel="This file is empty."
          />
        ) : null}
        {file.kind === 'text' ? (
          <pre className="explorer-text-preview">{file.text || ''}</pre>
        ) : null}
        {file.kind === 'image' ? (
          <div className="explorer-media-frame">
            <img src={file.blob_url} alt={file.name || file.path} />
          </div>
        ) : null}
        {file.kind === 'pdf' ? (
          <iframe className="explorer-pdf-frame" title={file.name || file.path} src={file.blob_url} />
        ) : null}
        {file.kind === 'presentation' ? (
          <div className="explorer-document-preview">
            <div className="explorer-document-icon">PPT</div>
            <div className="explorer-document-copy">
              <h3>Presentation file</h3>
              <p>Inline slide rendering is not available in the explorer yet. Open or download the presentation to view the slides.</p>
              <p>{formatFileSize(file.size)} · {file.mime_type}</p>
            </div>
            <a className="graph-button explorer-open-blob" href={file.blob_url} target="_blank" rel="noreferrer">Open presentation</a>
          </div>
        ) : null}
        {file.kind === 'unsupported' ? (
          <div className="explorer-unsupported">
            <div className="empty-copy">{file.reason || 'No inline preview is available for this file type.'}</div>
            <a className="graph-button explorer-open-blob" href={file.blob_url} target="_blank" rel="noreferrer">Open file</a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExplorerMarkdownPreview({ markdown, sourceSlug, onRelativeLinkClick, emptyLabel }) {
  const parsed = useMemo(() => splitMarkdownFrontmatter(markdown), [markdown]);
  if (!markdown?.trim()) {
    return emptyLabel ? <div className="empty-copy">{emptyLabel}</div> : null;
  }
  return (
    <div className="explorer-markdown-preview">
      {parsed.frontmatter ? (
        <details className="explorer-frontmatter">
          <summary>
            <span className="explorer-frontmatter-title">Frontmatter</span>
            <span className="explorer-frontmatter-meta">{parsed.lineCount} {parsed.lineCount === 1 ? 'line' : 'lines'}</span>
            {parsed.summaryFields.map((field) => (
              <span className="explorer-frontmatter-chip" key={field.key}>
                <span>{field.key}</span>
                <strong>{field.value}</strong>
              </span>
            ))}
          </summary>
          <pre>{parsed.frontmatter}</pre>
        </details>
      ) : null}
      <MarkdownDocument
        markdown={parsed.body}
        sourceSlug={sourceSlug}
        onRelativeLinkClick={onRelativeLinkClick}
        emptyLabel={emptyLabel}
      />
    </div>
  );
}

function splitMarkdownFrontmatter(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  if (!text.startsWith('---\n')) {
    return { body: text, frontmatter: '', lineCount: 0, summaryFields: [] };
  }
  const end = text.indexOf('\n---', 4);
  if (end < 0) {
    return { body: text, frontmatter: '', lineCount: 0, summaryFields: [] };
  }
  const frontmatter = text.slice(4, end).trim();
  const bodyStart = text[end + 4] === '\n' ? end + 5 : end + 4;
  return {
    body: text.slice(bodyStart).replace(/^\n+/, ''),
    frontmatter,
    lineCount: frontmatter ? frontmatter.split('\n').length : 0,
    summaryFields: summarizeFrontmatter(frontmatter),
  };
}

function summarizeFrontmatter(frontmatter) {
  const parsed = new Map();
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
    if (!match) continue;
    parsed.set(match[1], match[2].replace(/^['"]|['"]$/g, ''));
  }
  return ['type', 'status', 'priority', 'created']
    .filter((key) => parsed.has(key))
    .map((key) => ({ key, value: parsed.get(key) }))
    .slice(0, 4);
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  try {
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

function fileGlyph(node) {
  if (node.kind === 'markdown') return 'M';
  if (node.kind === 'pdf') return 'P';
  if (node.kind === 'presentation') return 'S';
  if (node.kind === 'image') return 'I';
  if (node.kind === 'text') return 'T';
  return '•';
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size < 0) return 'Unknown size';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
  colorMode,
  setColorMode,
  visualizerRef,
  activeSlug,
  onActiveSlugChange,
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
    ? visualizer.controls.filter((control) => control === 'resetView')
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
          colorMode={colorMode}
          activeSlug={activeSlug}
          onActiveSlugChange={onActiveSlugChange}
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
                  label="Color"
                  value={colorMode}
                  options={GRAPH_COLOR_MODES}
                  onSelect={setColorMode}
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
