import React, { memo, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as SelectPrimitive from '@radix-ui/react-select';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  CalendarDays,
  CircleHelp,
  FilePenLine,
  Mail,
  MessageCircle,
  MessagesSquare,
  Rss,
  Slack,
  Square,
  SquareCheckBig,
  Terminal,
  UserRound,
  Webhook,
  X,
  Youtube,
} from 'lucide-react';

import {
  GRAPH_COLOR_PALETTE_OPTIONS,
  GRAPH_DOMAIN_UNASSIGNED_COLOR,
  getGraphColorPalette,
  getGraphDomainColor,
  isGraphHexColor,
  sanitizeGraphTypeColors,
  TYPE_ORDER,
} from './graph/colors.js';
import {
  GRAPH_ARC_STYLES,
  GRAPH_ARC_ANIMATIONS,
  GRAPH_COLOR_MODES,
  GRAPH_CONTROL_LABELS,
  GRAPH_DEFAULTS,
  GRAPH_PREFERENCES_VERSION,
  GRAPH_AUTO_ROTATION_OPTIONS,
  GRAPH_FLOW_VISIBILITY_OPTIONS,
  GRAPH_LABEL_STYLES,
  GRAPH_LAYOUT_STYLES,
  GRAPH_NODE_FILLS,
  GRAPH_NODE_ICONS,
  GRAPH_NODE_SHAPES,
  GRAPH_NODE_SIZES,
  GRAPH_NODE_SIZE_MODES,
  graphVisualizers,
  migrateGraphPreferences,
} from './graph/registry.jsx';
import { GRAPH_THEME_MODES, resolveThemeMode } from './graph/theme.js';
import { PageTypeIcon } from './graph/graph-type-icon.jsx';
import { GraphThemeProvider } from './graph/visualizer-core.jsx';
import { GraphDesignLabApp } from './graph/graph-design-lab.jsx';
import { FocusedNetworkVisualizer, FocusedTimelineView } from './graph/focused-views.jsx';
import {
  buildFocusedNetworkGraph,
  FOCUSED_NETWORK_MAX_HOPS,
  normalizeFocusedGraphSlug,
} from './graph/focused-network-data.js';
import { buildFocusedSubgraphGraph } from './graph/focused-subgraph-data.js';
import { deriveGraphMotion, graphPayloadsEqual } from './graph/live-graph.js';
import { nextGraphDomainFilter, nextGraphStyleOption } from './graph/style-shortcuts.js';
import { graphNodeDomains, graphNodeMatchesFilters } from './graph/scope.js';
import { OverlaysController } from './overlays/shell.jsx';
import {
  buildDemoExplorer,
  buildDemoExplorerFile,
  buildDemoGraph,
  buildDemoGraphFlowInputs,
  buildDemoPagePreview,
  buildDemoTaskSections,
  buildDemoTasks,
  createDemoSeed,
} from './demo-mode.js';
import { resolveExplorerLinkPath } from './explorer-links.js';
import { MarkdownDocument } from './markdown.jsx';
import {
  dashboardRootHrefFromBasePath,
  privatePageHrefFromMarkdown,
  privatePageRouteFromPath,
} from './page-links.js';
import { recordDashboardError } from './error-reporting.js';
import { appendUniqueRecentItems, createBottomReachGate, orderStreamSourceTypes } from './stream-pagination.js';
import { dashboardNavigationFromUrl, dashboardNavigationHref, updateDashboardNavigation } from './navigation.js';

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
    recordDashboardError({ source: 'react-boundary', error, errorInfo });
  }

  render() {
    if (this.state.error) {
      return <DashboardFatalError error={this.state.error} />;
    }

    return this.props.children;
  }
}

function DashboardFatalError({ error }) {
  const report = useMemo(() => recordDashboardError({ source: 'fatal-screen', error }), [error]);
  const [copyState, setCopyState] = useState('idle');
  const errorDetails = formatErrorDetails(error);

  async function copyErrorDetails() {
    setCopyState('copying');
    try {
      await copyTextToClipboard(errorDetails);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <main className="fallback-main">
      <section className="card loading-card error-card">
        <h1>Dashboard unavailable</h1>
        <p>The dashboard hit a frontend error.</p>
        <p className="error-report-status">Diagnostic report saved locally as {report.id}.</p>
        <div className="error-actions">
          <button
            type="button"
            className="graph-button error-reload-button"
            onClick={() => window.location.reload()}
          >
            Reload dashboard
          </button>
          <button
            type="button"
            className="graph-button error-copy-button"
            onClick={copyErrorDetails}
            disabled={copyState === 'copying'}
          >
            <CopyIcon />
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy error'}
          </button>
        </div>
        <pre className="error-details">{errorDetails}</pre>
      </section>
    </main>
  );
}

function formatErrorDetails(error) {
  if (error instanceof Error) return String(error.stack || error.message);
  if (error && typeof error === 'object' && 'reason' in error) {
    return formatErrorDetails(error.reason);
  }
  return String(error);
}

function loadGraphPreferences() {
  const defaults = {
    ...GRAPH_DEFAULTS,
    typeColors: sanitizeGraphTypeColors(getGraphColorPalette(GRAPH_DEFAULTS.colorPaletteId)),
  };
  try {
    const saved = migrateGraphPreferences(JSON.parse(window.localStorage.getItem('bigbrain:graph-preferences') || '{}'));
    if (saved.visualizerId === 'vis-network') saved.visualizerId = 'network-constellation';
    const allowed = {
      visualizerId: new Set(graphVisualizers.map((item) => item.id)),
      nodeShape: new Set(GRAPH_NODE_SHAPES.map((item) => item.id)),
      nodeFill: new Set(GRAPH_NODE_FILLS.map((item) => item.id)),
      nodeIcon: new Set(GRAPH_NODE_ICONS.map((item) => item.id)),
      nodeSize: new Set(GRAPH_NODE_SIZES.map((item) => item.id)),
      nodeSizeMode: new Set(GRAPH_NODE_SIZE_MODES.map((item) => item.id)),
      arcStyle: new Set(GRAPH_ARC_STYLES.map((item) => item.id)),
      arcAnimation: new Set(GRAPH_ARC_ANIMATIONS.map((item) => item.id)),
      layoutStyle: new Set(GRAPH_LAYOUT_STYLES.map((item) => item.id)),
      labelStyle: new Set(GRAPH_LABEL_STYLES.map((item) => item.id)),
      colorMode: new Set(GRAPH_COLOR_MODES.map((item) => item.id)),
      colorPaletteId: new Set(GRAPH_COLOR_PALETTE_OPTIONS.map((item) => item.id)),
    };
    for (const [key, values] of Object.entries(allowed)) {
      if (values.has(saved[key])) defaults[key] = saved[key];
    }
    defaults.typeColors = sanitizeGraphTypeColors(saved.typeColors, getGraphColorPalette(defaults.colorPaletteId));
    if (typeof saved.flowVisible === 'boolean') defaults.flowVisible = saved.flowVisible;
    if (typeof saved.autoRotate === 'boolean') defaults.autoRotate = saved.autoRotate;
    if (typeof saved.demoMode === 'boolean') defaults.demoMode = saved.demoMode;
  } catch {
    // Invalid or unavailable storage falls back to the registry defaults.
  }
  return defaults;
}

function DashboardApp() {
  const dashboardBasePath = document.body?.dataset?.dashboardBasePath || '';
  const [navigation, setNavigation] = useState(() => dashboardNavigationFromUrl(window.location.href, dashboardBasePath));
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const historyEndRef = useRef(0);
  const historyEndKey = `bigbrain:history-end:${dashboardBasePath}`;
  const [historyPosition, setHistoryPosition] = useState({ index: 0, end: 0 });
  const loadedNavigationRef = useRef(null);
  function navigate(patch) {
    const next = updateDashboardNavigation(navigationRef.current, patch);
    const href = dashboardNavigationHref(next, dashboardBasePath);
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (href === currentHref) return;
    const index = (window.history.state?.bigbrainNavigationIndex ?? 0) + 1;
    window.history.pushState({ ...window.history.state, bigbrainNavigationIndex: index }, '', href);
    historyEndRef.current = index;
    try { window.sessionStorage.setItem(historyEndKey, String(index)); } catch { /* Browser storage may be unavailable. */ }
    setHistoryPosition({ index, end: index });
    navigationRef.current = next;
    setNavigation(next);
  }
  useEffect(() => {
    const initial = dashboardNavigationHref(navigationRef.current, dashboardBasePath);
    const index = Number.isInteger(window.history.state?.bigbrainNavigationIndex) ? window.history.state.bigbrainNavigationIndex : 0;
    let savedEnd = index;
    try { savedEnd = Number(window.sessionStorage.getItem(historyEndKey)) || index; } catch { /* Browser storage may be unavailable. */ }
    historyEndRef.current = Math.max(index, savedEnd);
    window.history.replaceState({ ...window.history.state, bigbrainNavigationIndex: index }, '', initial);
    setHistoryPosition({ index, end: historyEndRef.current });
    function onPopState(event) {
      const next = dashboardNavigationFromUrl(window.location.href, dashboardBasePath);
      const nextIndex = Number.isInteger(event.state?.bigbrainNavigationIndex) ? event.state.bigbrainNavigationIndex : 0;
      historyEndRef.current = Math.max(historyEndRef.current, nextIndex);
      navigationRef.current = next;
      setNavigation(next);
      setHistoryPosition({ index: nextIndex, end: historyEndRef.current });
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dashboardBasePath, historyEndKey]);
  useEffect(() => {
    function handleHistoryShortcut(event) {
      if (event.defaultPrevented || event.repeat || event.isComposing || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTypingTarget(event.target)) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') window.history.back();
      else window.history.forward();
    }
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, []);
  const savedGraphPreferences = useMemo(() => loadGraphPreferences(), []);
  const [state, setState] = useState({ status: 'loading', error: null, data: null });
  const view = navigation.view;
  const setView = (nextView) => navigate({ view: nextView });
  const [visualizerId, setVisualizerId] = useState(savedGraphPreferences.visualizerId);
  const [nodeShape, setNodeShape] = useState(savedGraphPreferences.nodeShape);
  const [nodeFill, setNodeFill] = useState(savedGraphPreferences.nodeFill);
  const [nodeIcon, setNodeIcon] = useState(savedGraphPreferences.nodeIcon);
  const [nodeSize, setNodeSize] = useState(savedGraphPreferences.nodeSize);
  const [nodeSizeMode, setNodeSizeMode] = useState(savedGraphPreferences.nodeSizeMode);
  const [arcStyle, setArcStyle] = useState(savedGraphPreferences.arcStyle);
  const [arcAnimation, setArcAnimation] = useState(savedGraphPreferences.arcAnimation);
  const [layoutStyle] = useState(savedGraphPreferences.layoutStyle);
  const [labelStyle, setLabelStyle] = useState(savedGraphPreferences.labelStyle);
  const [colorMode, setColorMode] = useState(savedGraphPreferences.colorMode);
  const [colorPaletteId, setColorPaletteId] = useState(savedGraphPreferences.colorPaletteId);
  const [typeColors, setTypeColors] = useState(savedGraphPreferences.typeColors);
  const [flowVisible, setFlowVisible] = useState(savedGraphPreferences.flowVisible);
  const [autoRotate, setAutoRotate] = useState(savedGraphPreferences.autoRotate);
  const [demoMode, setDemoMode] = useState(savedGraphPreferences.demoMode);
  const [demoSeed, setDemoSeed] = useState(() => createDemoSeed());
  const [themeMode, setThemeMode] = useState('auto');
  const [prefersDark, setPrefersDark] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sidecarWidth, setSidecarWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem('bigbrain:sidecar-width'));
      return Number.isFinite(saved) ? Math.min(760, Math.max(360, saved)) : 560;
    } catch {
      return 560;
    }
  });
  const [sidecarResizing, setSidecarResizing] = useState(false);
  const activeDomainScope = navigation.domain ? [navigation.domain] : [];
  const [activeGraphSlug, setActiveGraphSlug] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [graphMotion, setGraphMotion] = useState(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analytics, setAnalytics] = useState({ status: 'idle', data: null, error: null });
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [assigneeLoading, setAssigneeLoading] = useState(false);
  const demoModeRef = useRef(demoMode);
  const demoSeedRef = useRef(demoSeed);
  const previewRequestRef = useRef(0);
  const lineageRequestRef = useRef(0);
  const defaultAssigneeAppliedRef = useRef(false);
  const visualizerRef = useRef(null);
  const healthMenuRef = useRef(null);
  const settingsMenuRef = useRef(null);
  const sidecarResizeRef = useRef(null);
  const latestGraphRef = useRef(null);
  const graphMotionEligibleRef = useRef(false);
  latestGraphRef.current = state.data?.graph || latestGraphRef.current;
  graphMotionEligibleRef.current = view === 'graph' && !preview && !lineage;
  demoModeRef.current = demoMode;
  demoSeedRef.current = demoSeed;
  const filesystemExplorerEnabled = state.data?.about?.capabilities?.filesystem_explorer === true;

  useEffect(() => {
    try {
      window.localStorage.setItem('bigbrain:sidecar-width', String(sidecarWidth));
    } catch {
      // Storage can be unavailable; the current width remains usable.
    }
  }, [sidecarWidth]);

  useEffect(() => {
    if (!sidecarResizing) return undefined;
    const handlePointerMove = (event) => {
      const start = sidecarResizeRef.current;
      if (!start) return;
      const next = start.width + (start.x - event.clientX);
      setSidecarWidth(Math.min(760, Math.max(360, next)));
    };
    const stopResize = () => {
      sidecarResizeRef.current = null;
      setSidecarResizing(false);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [sidecarResizing]);

  function startSidecarResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    sidecarResizeRef.current = { x: event.clientX, width: sidecarWidth };
    setSidecarResizing(true);
  }

  const resetGraphFocus = useEffectEvent(() => {
    previewRequestRef.current += 1;
    lineageRequestRef.current += 1;
    setLineage(null);
    setActiveGraphSlug(null);
    setPreview(null);
  });
  const clearGraphFocus = useEffectEvent(() => {
    navigate({ slug: null, focus: false, image: null });
    resetGraphFocus();
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('bigbrain:graph-preferences', JSON.stringify({
        graphPreferencesVersion: GRAPH_PREFERENCES_VERSION, visualizerId, nodeShape, nodeFill, nodeIcon, nodeSize, nodeSizeMode, arcStyle, arcAnimation, layoutStyle, labelStyle, colorMode, colorPaletteId, typeColors, flowVisible, autoRotate, demoMode,
      }));
    } catch {
      // Storage can be unavailable in restricted browser contexts; defaults remain usable.
    }
  }, [arcAnimation, arcStyle, autoRotate, colorMode, colorPaletteId, demoMode, flowVisible, labelStyle, layoutStyle, nodeFill, nodeIcon, nodeShape, nodeSize, nodeSizeMode, typeColors, visualizerId]);

  useEffect(() => {
    if (window.parent === window) return;
    window.parent.postMessage({ type: 'bigbrain-dashboard-status', status: state.status }, '*');
  }, [state.status]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setAssigneeLoading(true);
      try {
        const assigneeQuery = assigneeFilter ? `?${new URLSearchParams({ assignee: assigneeFilter }).toString()}` : '';
        const about = await fetchJson('/api/about');
        const [schema, tasks, recent, health, graph, explorer, explorerRecent] = await Promise.all([
          fetchJson('/api/schema'),
          fetchJson(`/api/tasks${assigneeQuery}`),
          fetchJson('/api/recent'),
          fetchJson('/api/health'),
          fetchJson('/api/graph'),
          about?.capabilities?.filesystem_explorer === true
            ? fetchJson('/api/explorer/tree')
            : Promise.resolve(null),
          about?.capabilities?.filesystem_explorer === true
            ? fetchJson('/api/explorer/recent')
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const currentMemberSlug = tasks?.filters?.current_member?.person_slug || '';
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
          data: {
            about,
            schema,
            tasks,
            recent,
            health,
            graph,
            explorer: explorer ? { ...explorer, recent: explorerRecent } : null,
          },
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
    if (state.status !== 'ready' || typeof EventSource === 'undefined') return undefined;
    let cancelled = false;
    let refreshTimer = 0;
    let refreshInFlight = false;
    const pendingEvents = [];
    const source = new EventSource('/api/graph/events');

    const refreshGraph = async ({ animate = true } = {}) => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      const sourceEvents = pendingEvents.splice(0);
      try {
        const nextGraph = await fetchJson('/api/graph', { cache: 'no-store' });
        if (cancelled) return;
        const previousGraph = latestGraphRef.current;
        const motion = deriveGraphMotion(previousGraph, nextGraph, sourceEvents);
        latestGraphRef.current = nextGraph;
        if (!graphPayloadsEqual(previousGraph, nextGraph)) {
          setState((current) => current.status === 'ready'
            ? { ...current, data: { ...current.data, graph: nextGraph } }
            : current);
        }
        if (animate && motion.changes.length && graphMotionEligibleRef.current) setGraphMotion(motion);
      } catch {
        // EventSource reconnects automatically; the next ready event heals missed graph state.
      } finally {
        refreshInFlight = false;
        if (!cancelled && pendingEvents.length) scheduleRefresh();
      }
    };
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => refreshGraph({ animate: true }), 180);
    };
    source.addEventListener('ready', () => refreshGraph({ animate: false }));
    source.addEventListener('graph-change', (event) => {
      try {
        pendingEvents.push(JSON.parse(event.data));
      } catch {
        pendingEvents.push({ id: event.lastEventId || `${Date.now()}` });
      }
      scheduleRefresh();
    });
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      source.close();
    };
  }, [state.status]);

  useEffect(() => {
    if (view === 'graph' && !preview && !lineage) return;
    setGraphMotion(null);
  }, [lineage, preview, view]);

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
    if (!preview || lineage || healthOpen) return undefined;

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
      clearGraphFocus();
    }

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [clearGraphFocus, healthOpen, lineage, preview]);

  useEffect(() => {
    if (!lineage) return undefined;

    function handleEscape(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      clearGraphFocus();
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [clearGraphFocus, lineage]);

  useEffect(() => {
    if (view !== 'graph' || preview || lineage || healthOpen || settingsOpen) return undefined;

    function handleGraphResetKeyDown(event) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="menu"], [role="dialog"], [role="listbox"], .graph-style-menu')) return;
      event.preventDefault();
      visualizerRef.current?.resetView?.();
    }

    window.addEventListener('keydown', handleGraphResetKeyDown);
    return () => window.removeEventListener('keydown', handleGraphResetKeyDown);
  }, [healthOpen, lineage, preview, settingsOpen, view]);

  useEffect(() => {
    function handleKeydown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.isComposing) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'g') {
        event.preventDefault();
        setView('graph');
      } else if (key === 'e' && filesystemExplorerEnabled) {
        event.preventDefault();
        setView('explorer');
      } else if (key === 'r') {
        event.preventDefault();
        setView('recents');
      } else if (key === 'd' && event.shiftKey) {
        event.preventDefault();
        handleDemoModeChange(!demoModeRef.current);
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [filesystemExplorerEnabled]);

  const taskSections = Array.isArray(state.data?.tasks?.sections) ? state.data.tasks.sections : [];
  const displayTaskSections = useMemo(() => (
    demoMode ? buildDemoTaskSections(taskSections, demoSeed) : taskSections
  ), [demoMode, demoSeed, taskSections]);
  const graphTaskNodes = useMemo(() => {
    const nodes = Array.isArray(state.data?.graph?.nodes) ? state.data.graph.nodes : [];
    return nodes
      .filter((node) => node?.type === 'tasks' && node?.slug)
      .sort((left, right) => {
        const leftTime = Date.parse(left.updated_at || '') || 0;
        const rightTime = Date.parse(right.updated_at || '') || 0;
        return rightTime - leftTime || String(left.slug).localeCompare(String(right.slug));
      })
      .slice(0, 6)
      .map((node) => ({ ...node, status: 'open', completed: false }));
  }, [state.data?.graph]);
  const rawGraphFlowTasks = useMemo(() => {
    const taskItems = taskSections
      .flatMap((section) => section.items || [])
      .filter((item) => !item.completed)
      .slice(0, 6);
    return taskItems.length || !demoMode ? taskItems : graphTaskNodes;
  }, [demoMode, graphTaskNodes, taskSections]);
  const graphFlowTasks = useMemo(() => (
    demoMode ? buildDemoTasks(rawGraphFlowTasks, demoSeed) : rawGraphFlowTasks
  ), [demoMode, demoSeed, rawGraphFlowTasks]);
  const displayGraph = useMemo(() => (
    demoMode ? buildDemoGraph(state.data?.graph, demoSeed) : state.data?.graph
  ), [demoMode, demoSeed, state.data?.graph]);
  const displayExplorer = useMemo(() => (
    demoMode ? buildDemoExplorer(state.data?.explorer, demoSeed) : state.data?.explorer
  ), [demoMode, demoSeed, state.data?.explorer]);

  const handleGraphNodeOpen = useEffectEvent(async (slug, record = true) => {
    if (!slug) return;
    loadedNavigationRef.current = `${navigationRef.current.view}|${slug}|false`;
    if (record) navigate({ slug, focus: false, image: null });
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    lineageRequestRef.current += 1;
    setActiveGraphSlug(slug || null);
    const sourceNode = latestGraphRef.current?.nodes?.find((node) => node.slug === slug) || { slug };
    if (demoModeRef.current) {
      setLineage(null);
      setPreview(buildDemoPagePreview(sourceNode, demoSeedRef.current));
      return;
    }
    setLineage(null);
    setPreview({ status: 'loading', slug });
    try {
      const params = new URLSearchParams({ slug });
      if (activeDomainScope.length) params.set('domains', activeDomainScope.join(','));
      const data = await fetchJson(`/api/page?${params.toString()}`);
      if (requestId !== previewRequestRef.current || demoModeRef.current) return;
      setPreview({ status: 'ready', ...data });
    } catch (error) {
      if (requestId !== previewRequestRef.current || demoModeRef.current) return;
      setPreview({
        status: 'error',
        slug,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const handleGraphNodeSelect = useEffectEvent(async (slug, record = true) => {
    if (!slug) return;
    loadedNavigationRef.current = `graph|${slug}|true`;
    if (record) navigate({ view: 'graph', slug, focus: true, image: null });
    const previewRequestId = previewRequestRef.current + 1;
    const focusRequestId = lineageRequestRef.current + 1;
    previewRequestRef.current = previewRequestId;
    lineageRequestRef.current = focusRequestId;
    setActiveGraphSlug(slug);
    const sourceNode = latestGraphRef.current?.nodes?.find((node) => node.slug === slug) || { slug };
    const page = { slug, title: sourceNode.title || labelFromSlug(slug), type: sourceNode.type || slug.split('/')[0] || 'unknown' };
    if (demoModeRef.current) {
      setPreview(buildDemoPagePreview(sourceNode, demoSeedRef.current));
      setLineage({
        status: 'ready',
        slug,
        page,
        link_events: [],
        provenance: [],
        outgoing: [],
        backlinks: [],
        timeline_updates: [],
      });
      return;
    }
    setPreview({ status: 'loading', slug });
    setLineage({ status: 'loading', slug, page });
    const pageParams = new URLSearchParams({ slug });
    if (activeDomainScope.length) pageParams.set('domains', activeDomainScope.join(','));
    const lineageParams = new URLSearchParams({ slug });
    const [pageResult, lineageResult] = await Promise.allSettled([
      fetchJson(`/api/page?${pageParams.toString()}`),
      fetchJson(`/api/graph/lineage?${lineageParams.toString()}`),
    ]);
    if (demoModeRef.current || previewRequestId !== previewRequestRef.current || focusRequestId !== lineageRequestRef.current) return;
    if (pageResult.status === 'fulfilled') {
      setPreview({ status: 'ready', ...pageResult.value });
    } else {
      setPreview({
        status: 'error',
        slug,
        message: pageResult.reason instanceof Error ? pageResult.reason.message : String(pageResult.reason),
      });
    }
    if (lineageResult.status === 'fulfilled') {
      setLineage({ status: 'ready', slug, ...lineageResult.value });
    } else {
      setLineage({
        status: 'error',
        slug,
        page,
        message: lineageResult.reason instanceof Error ? lineageResult.reason.message : String(lineageResult.reason),
      });
    }
  });

  const openPageBySlug = useEffectEvent((slug) => {
    if (!slug) return;
    handleGraphNodeOpen(slug);
  });

  const focusGraphNode = useEffectEvent((slug) => {
    if (!slug) return;
    handleGraphNodeSelect(slug);
  });

  useEffect(() => {
    const key = `${navigation.view}|${navigation.slug || ''}|${navigation.focus}`;
    if (loadedNavigationRef.current === key) return;
    loadedNavigationRef.current = key;
    if (navigation.slug) {
      if (navigation.view === 'graph' && navigation.focus) handleGraphNodeSelect(navigation.slug, false);
      else handleGraphNodeOpen(navigation.slug, false);
    } else {
      resetGraphFocus();
    }
  }, [navigation.view, navigation.slug, navigation.focus]);

  function handleDemoModeChange(nextDemoMode) {
    demoModeRef.current = nextDemoMode;
    const nextNavigation = updateDashboardNavigation(navigationRef.current, { slug: null, focus: false, image: null });
    window.history.replaceState(window.history.state, '', dashboardNavigationHref(nextNavigation, dashboardBasePath));
    navigationRef.current = nextNavigation;
    setNavigation(nextNavigation);
    previewRequestRef.current += 1;
    lineageRequestRef.current += 1;
    setPreview(null);
    setActiveGraphSlug(null);
    setLineage(null);
    if (nextDemoMode) {
      const nextSeed = createDemoSeed();
      demoSeedRef.current = nextSeed;
      setDemoSeed(nextSeed);
    }
    setDemoMode(nextDemoMode);
  }

  const openAnalytics = useEffectEvent(async () => {
    setSettingsOpen(false);
    setView('analytics');
    if (analytics.status === 'ready' || analytics.status === 'loading') return;
    setAnalytics({ status: 'loading', data: null, error: null });
    try {
      setAnalytics({ status: 'ready', data: await fetchJson('/api/analytics'), error: null });
    } catch (error) {
      setAnalytics({ status: 'error', data: null, error: error instanceof Error ? error.message : String(error) });
    }
  });

  useEffect(() => {
    if (view === 'analytics' && analytics.status === 'idle') openAnalytics();
  }, [view, analytics.status]);

  const changePageVisibility = useEffectEvent(async (slug, visibility) => {
    if (!slug || demoModeRef.current) return;
    setPreview((current) => current?.slug === slug ? { ...current, visibility_status: 'saving' } : current);
    try {
      const data = await fetchJson('/api/page/visibility', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, visibility }),
      });
      setPreview({ status: 'ready', ...data });
    } catch (error) {
      setPreview((current) => current?.slug === slug
        ? { ...current, visibility_status: 'error', visibility_error: error instanceof Error ? error.message : String(error) }
        : current);
    }
  });

  if (state.status === 'loading') {
    return (
      <LoadingSplash />
    );
  }

  if (state.status === 'error') {
    return <DashboardFatalError error={new Error(state.error)} />;
  }

  const { about, schema, tasks, recent, health, graph, explorer } = state.data;
  const members = Array.isArray(tasks?.members) ? tasks.members : [];
  const healthFindingCount = Number.isFinite(health?.finding_count) ? health.finding_count : 0;
  const healthFindings = Array.isArray(health?.findings)
    ? health.findings
    : Array.isArray(health?.top_findings)
      ? health.top_findings
      : [];
  const healthSeverity = deriveHealthSeverity(healthFindings);

  const views = [
    { id: 'graph', label: 'Graph', shortcut: 'G' },
    ...(filesystemExplorerEnabled ? [{ id: 'explorer', label: 'Explorer', shortcut: 'E' }] : []),
    { id: 'recents', label: 'Stream', shortcut: 'R' },
  ];

  async function openPreview({ href, sourceSlug }) {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    if (demoModeRef.current) {
      const demoSlug = sourceSlug || href || 'demo/page';
      setActiveGraphSlug(sourceSlug || null);
      setPreview(buildDemoPagePreview({
        slug: demoSlug,
        type: String(demoSlug).split('/')[0] || 'page',
      }, demoSeedRef.current));
      return;
    }
    setPreview({ status: 'loading', href, sourceSlug });
    try {
      const params = new URLSearchParams({ from: sourceSlug, target: href });
      if (activeDomainScope.length) params.set('domains', activeDomainScope.join(','));
      const data = await fetchJson(`/api/preview?${params.toString()}`);
      if (requestId !== previewRequestRef.current || demoModeRef.current) return;
      setActiveGraphSlug(data.slug || null);
      setPreview({ status: 'ready', href, sourceSlug, ...data });
      if (data.slug) {
        loadedNavigationRef.current = `${navigationRef.current.view}|${data.slug}|false`;
        navigate({ slug: data.slug, focus: false });
      }
    } catch (error) {
      if (requestId !== previewRequestRef.current || demoModeRef.current) return;
      setPreview({
        status: 'error',
        href,
        sourceSlug,
        message: error instanceof Error ? error.message : String(error),
      });
    }
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
  const searchableNodes = Array.isArray(displayGraph?.nodes) ? displayGraph.nodes : [];

  return (
    <OverlaysController
      brainId={about?.brain_id || 'current'}
      brainName={about?.brain_name}
      activeView={view}
      onActiveViewChange={setView}
      onOpenPage={openPageBySlug}
      onBeforeToggle={() => {
        setHealthOpen(false);
        setSettingsOpen(false);
      }}
    >
      {({ menu, content, menuOpen }) => (
        <GraphThemeProvider resolvedTheme={resolvedTheme}>
      <div className={`page-shell theme-${resolvedTheme} view-${view} ${preview ? 'preview-open' : ''} ${sidecarResizing ? 'sidecar-resizing' : ''}`} style={{ '--sidecar-resized-width': preview ? `${sidecarWidth}px` : undefined }} data-theme-mode={themeMode}>
        <main>
          <div className="desktop-drag-strip" aria-hidden="true" />
          <div className="topline">
            <div className="topline-brand">
              <div className="history-nav" role="group" aria-label="Browser navigation">
                <IconButton aria-label="Back" title="Back" disabled={historyPosition.index <= 0} onClick={() => window.history.back()}><ArrowLeft size={16} strokeWidth={2} aria-hidden="true" /></IconButton>
                <IconButton aria-label="Forward" title="Forward" disabled={historyPosition.index >= historyPosition.end} onClick={() => window.history.forward()}><ArrowRight size={16} strokeWidth={2} aria-hidden="true" /></IconButton>
              </div>
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
              <DashboardSearch nodes={searchableNodes} onSelectPage={focusGraphNode} />
            </div>
            <div className="topline-actions">
              {demoMode ? <span className="demo-mode-badge">Demo mode</span> : null}
              {menu}
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
                    <div className="settings-field">
                      <span className="settings-label">Demo mode</span>
                      <button
                        type="button"
                        className={`settings-link settings-demo-toggle ${demoMode ? 'selected' : ''}`}
                        role="switch"
                        aria-label="Demo mode"
                        aria-checked={demoMode}
                        onClick={() => handleDemoModeChange(!demoMode)}
                      >
                        <span>Safe example data <kbd className="settings-shortcut">Shift+D</kbd></span>
                        <strong>{demoMode ? 'On' : 'Off'}</strong>
                      </button>
                    </div>
                    <button type="button" className="settings-link" role="menuitem" onClick={openAnalytics}>
                      <span>Analytics</span>
                      <span className="meta">MCP activity →</span>
                    </button>
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

          <div className={`view-stage ${view === 'graph' || view === 'explorer' || view === 'recents' ? 'view-stage-graph' : 'view-stage-list'}`}>
            {view === 'tasks' ? (
              <div className="list-page-card standalone-list-region">
                <AssigneeFilter members={members} value={assigneeFilter} onChange={handleAssigneeFilterChange} disabled={assigneeLoading} />
                <div className="task-section">
                  {assigneeLoading ? <ListLoadingState label="Loading tasks" /> : displayTaskSections.map((section) => (
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
                graph={displayGraph}
                motionEvent={graphMotion}
                demoMode={demoMode}
                demoSeed={demoSeed}
                visualizerId={visualizerId}
                setVisualizerId={setVisualizerId}
                nodeShape={nodeShape}
                setNodeShape={setNodeShape}
                nodeFill={nodeFill}
                setNodeFill={setNodeFill}
                nodeIcon={nodeIcon}
                setNodeIcon={setNodeIcon}
                nodeSize={nodeSize}
                setNodeSize={setNodeSize}
                nodeSizeMode={nodeSizeMode}
                setNodeSizeMode={setNodeSizeMode}
                arcStyle={arcStyle}
                setArcStyle={setArcStyle}
                arcAnimation={arcAnimation}
                setArcAnimation={setArcAnimation}
                layoutStyle={layoutStyle}
                labelStyle={labelStyle}
                setLabelStyle={setLabelStyle}
                colorMode={colorMode}
                setColorMode={setColorMode}
                colorPaletteId={colorPaletteId}
                setColorPaletteId={setColorPaletteId}
                typeColors={typeColors}
                setTypeColors={setTypeColors}
                flowVisible={flowVisible}
                setFlowVisible={setFlowVisible}
                autoRotate={autoRotate}
                setAutoRotate={setAutoRotate}
                flowTasks={graphFlowTasks}
                visualizerRef={visualizerRef}
                shortcutsEnabled={!healthOpen && !settingsOpen && !menuOpen}
                activeSlug={activeGraphSlug}
                initialDomains={activeDomainScope}
                onDomainScopeChange={(domains) => navigate({ domain: domains[0] || '' })}
                onActiveSlugChange={setActiveGraphSlug}
                onNodeOpen={handleGraphNodeOpen}
                onGraphNodeSelect={handleGraphNodeSelect}
                lineage={lineage}
                onLineageClose={clearGraphFocus}
              />
            ) : null}

            {view === 'explorer' && filesystemExplorerEnabled ? (
              <ExplorerPanel
                explorer={displayExplorer}
                demoMode={demoMode}
                demoSeed={demoSeed}
              />
            ) : null}

            {view === 'recents' ? (
              <RecentsPanel onOpenPage={handleGraphNodeOpen} selectedSlug={preview?.slug} demoMode={demoMode} typeColors={typeColors} shortcutsEnabled={!healthOpen && !settingsOpen && !menuOpen} />
            ) : null}

            {content}

            {view === 'analytics' ? <AnalyticsPanel analytics={analytics} /> : null}
          </div>

        </main>

        <PageSidecar
          preview={preview}
          onResizeStart={startSidecarResize}
          onClose={clearGraphFocus}
          onRelativeLinkClick={openPreview}
          onRawLinkClick={openRawFile}
          onPageOpen={openPageBySlug}
          onVisibilityChange={changePageVisibility}
        />
      </div>
        </GraphThemeProvider>
      )}
    </OverlaysController>
  );
}

function DashboardSearch({ nodes, onSelectPage }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const shellRef = useRef(null);
  const inputRef = useRef(null);
  const results = useMemo(() => searchGraphNodes(nodes, query), [nodes, query]);

  useEffect(() => {
    setFocusedIndex((current) => (current >= 0 && current < results.length ? current : -1));
  }, [results.length, query]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!shellRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    function focusSearch(event) {
      if (event.key !== '/' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  function selectResult(node) {
    if (!node?.slug) return;
    setOpen(false);
    setQuery('');
    onSelectPage(node.slug);
  }

  function handleSubmit(event) {
    event.preventDefault();
    selectResult(results[focusedIndex] || results[0]);
  }

  function handleInputKeyDown(event) {
    if (!query.trim() || !results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setFocusedIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setFocusedIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
    } else if (event.key === 'Enter' && focusedIndex >= 0) {
      event.preventDefault();
      selectResult(results[focusedIndex]);
    }
  }

  return (
    <div className="dashboard-search" ref={shellRef}>
      <form className="dashboard-search-form" role="search" onSubmit={handleSubmit}>
        <SearchIcon />
        <input
          ref={inputRef}
          className="dashboard-search-input"
          type="search"
          value={query}
          placeholder="Search"
          aria-label="Search"
            aria-controls="dashboard-search-results"
            aria-expanded={open && Boolean(query.trim())}
          aria-activedescendant={focusedIndex >= 0 ? `dashboard-search-result-${focusedIndex}` : undefined}
          onKeyDown={handleInputKeyDown}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        {query ? (
          <button
            type="button"
            className="dashboard-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </form>
      {open && query.trim() ? (
        <div id="dashboard-search-results" className="dashboard-search-results" role="listbox" aria-label="Search results">
          {results.length ? results.map((node, index) => (
            <button
              key={node.slug}
              type="button"
              id={`dashboard-search-result-${index}`}
              className={`dashboard-search-result ${focusedIndex === index ? 'focused' : ''}`}
              role="option"
              aria-selected={focusedIndex === index}
              onMouseEnter={() => setFocusedIndex(index)}
              onClick={() => selectResult(node)}
            >
              <strong className="dashboard-search-result-title">{node.title || labelFromSlug(node.slug)}</strong>
              <span className="dashboard-search-result-meta">{node.type || 'page'} · {node.slug}</span>
            </button>
          )) : (
            <div className="dashboard-search-empty">No matching pages</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function searchGraphNodes(nodes, query, limit = 8) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      const title = String(node?.title || '').toLocaleLowerCase();
      const slug = String(node?.slug || '').toLocaleLowerCase();
      const type = String(node?.type || '').toLocaleLowerCase();
      const haystack = `${title} ${slug} ${type}`;
      if (!node?.slug || !terms.every((term) => haystack.includes(term))) return null;
      const exactMatch = title === normalizedQuery || slug === normalizedQuery;
      const startsMatch = title.startsWith(normalizedQuery) || slug.startsWith(normalizedQuery);
      return { node, score: exactMatch ? 0 : startsMatch ? 1 : 2 };
    })
    .filter(Boolean)
    .sort((left, right) => left.score - right.score || String(left.node.title || left.node.slug).localeCompare(String(right.node.title || right.node.slug)))
    .slice(0, limit)
    .map(({ node }) => node);
}

function AnalyticsPanel({ analytics }) {
  const data = analytics.data;
  const summary = data?.summary || {};
  return (
    <section className="analytics-page">
      <div className="analytics-head">
        <div>
          <span className="eyebrow">Operations</span>
          <h1>Analytics</h1>
          <p>Meaningful MCP writes, maintenance actions, admin access, and security denials.</p>
        </div>
        <div className="retention-pill">{data?.retention_days || 360}-day window</div>
      </div>
      {analytics.status === 'loading' ? <ListLoadingState label="Loading analytics" /> : null}
      {analytics.status === 'error' ? <div className="empty-copy">Analytics unavailable: {analytics.error}</div> : null}
      {analytics.status === 'ready' ? (
        <>
          <div className="analytics-metrics">
            <MetricCard label="Audit events" value={summary.total_events || 0} />
            <MetricCard label="Distinct actors" value={summary.distinct_actors || 0} />
            <MetricCard label="Latest event" value={formatAnalyticsTime(summary.last_event_at)} compact />
          </div>
          <div className="analytics-grid">
            <AnalyticsBreakdown title="Top actions" rows={data.actions} labelKey="action" />
            <AnalyticsBreakdown title="Outcomes" rows={data.outcomes} labelKey="outcome" />
            <AnalyticsBreakdown title="Resources" rows={data.resources} labelKey="resource_type" />
          </div>
          <div className="analytics-recent card">
            <div className="analytics-section-head"><h2>Recent events</h2><span className="meta">Bounded metadata only</span></div>
            {(data.recent || []).map((event) => (
              <div className="analytics-event" key={event.event_id || `${event.action}:${event.created_at}`}>
                <div><strong>{event.action}</strong><span className="meta">{event.resource_type || 'No resource'}{event.resource_id ? ` · ${event.resource_id}` : ''}</span></div>
                <div className="analytics-event-tail"><span className={`outcome outcome-${event.outcome || 'legacy'}`}>{event.outcome || 'legacy'}</span><span className="meta">{formatAnalyticsTime(event.created_at)}</span></div>
              </div>
            ))}
            {data.recent?.length ? null : <div className="empty-copy">No audit events in this retention window yet.</div>}
          </div>
          <p className="analytics-privacy">{data.privacy_note}</p>
        </>
      ) : null}
    </section>
  );
}

function MetricCard({ label, value, compact = false }) {
  return <div className="metric-card"><span className="settings-label">{label}</span><strong className={compact ? 'compact' : ''}>{value}</strong></div>;
}

function AnalyticsBreakdown({ title, rows = [], labelKey }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.count || 0)));
  return <div className="analytics-breakdown card"><h2>{title}</h2>{rows.map((row) => <div className="breakdown-row" key={row[labelKey]}><div><span>{row[labelKey]}</span><strong>{row.count}</strong></div><i style={{ width: `${Math.max(4, Number(row.count || 0) / max * 100)}%` }} /></div>)}</div>;
}

function formatAnalyticsTime(value) {
  if (!value) return 'No events';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function openRawFile({ href, sourceSlug }) {
  const rawPath = resolveMetadataTarget(sourceSlug, href);
  if (!isMetadataRawFile(rawPath)) return;
  const rawHref = `/api/explorer/blob?path=${encodeURIComponent(rawPath)}`;
  window.open(rawHref, '_blank', 'noopener,noreferrer');
}

function PrivatePageApp({ route }) {
  const [state, setState] = useState({ status: 'loading', error: null, page: null });
  const [imageViewerIndex, setImageViewerIndex] = useState(null);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      )) return;
      event.preventDefault();
      window.location.assign(dashboardRootHrefFromBasePath(document.body?.dataset?.dashboardBasePath));
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function privatePageHref(href, sourceSlug) {
    return privatePageHrefFromMarkdown({
      pathname: window.location.pathname,
      brainId: route.brainId,
      sourceSlug,
      href,
    });
  }

  function openPrivatePageLink({ href, sourceSlug }) {
    const destination = privatePageHref(href, sourceSlug);
    if (destination) window.location.assign(destination);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const params = new URLSearchParams({ slug: route.slug });
        const page = await fetchJson(`/api/page?${params.toString()}`);
        if (!cancelled) setState({ status: 'ready', error: null, page });
      } catch {
        if (!cancelled) setState({ status: 'error', error: 'Page not found.', page: null });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [route.slug]);

  useEffect(() => {
    setImageViewerIndex(null);
  }, [route.slug]);

  if (state.status === 'loading') {
    return (
      <main className="public-main">
        <article className="public-document private-document">
          <header className="public-document-head private-document-head">
            <PrivatePageBackLink />
          </header>
          <div className="empty-copy">Loading page…</div>
        </article>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="public-main">
        <article className="public-document private-document">
          <header className="public-document-head private-document-head">
            <PrivatePageBackLink />
          </header>
          <h1>Page not found</h1>
          <p className="empty-copy">{state.error}</p>
        </article>
      </main>
    );
  }

  return (
    <main className="public-main">
      <article className="public-document private-document">
        <header className="public-document-head private-document-head">
          <div>
            <div className="meta">{state.page.path}</div>
            <h1>{state.page.title}</h1>
          </div>
          <PrivatePageBackLink />
        </header>
        <PageDetails
          page={state.page}
          onImageOpen={setImageViewerIndex}
          onRelativeLinkClick={openPrivatePageLink}
          onRawLinkClick={openRawFile}
          onPageOpen={(slug) => openPrivatePageLink({ href: `${slug}.md`, sourceSlug: state.page.slug })}
        />
      </article>
      <PageImageLightbox
        images={state.page.images}
        activeIndex={imageViewerIndex}
        onClose={() => setImageViewerIndex(null)}
        onIndexChange={setImageViewerIndex}
      />
    </main>
  );
}

function PageSummary({ summary }) {
  if (!summary) return null;
  return <p className="page-summary">{summary}</p>;
}

function PageImageCarousel({ images, compact = false, onImageOpen }) {
  const items = Array.isArray(images) ? images.filter((image) => image?.url) : [];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (!items.length) return null;

  if (compact) {
    return (
      <section className="page-images page-images-strip" aria-label="Attached images">
        <div className="page-image-strip" role="list" aria-label="Article image strip">
          {items.map((image, index) => {
            const label = image.caption || image.alt_text || image.filename || `Attached image ${index + 1}`;
            return (
              <div className="page-image-strip-item" role="listitem" key={`${image.path}:${index}`}>
                <button
                  className="page-image-strip-button"
                  type="button"
                  aria-label={`Open attached image ${index + 1}: ${label}`}
                  onClick={() => onImageOpen?.(index)}
                >
                  <img src={image.url} alt={image.alt_text || label} loading={index < 4 ? 'eager' : 'lazy'} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  const safeActiveIndex = Math.min(activeIndex, items.length - 1);
  const activeItem = items[safeActiveIndex];
  const activeLabel = activeItem.caption || activeItem.alt_text || activeItem.filename || `Attached image ${safeActiveIndex + 1}`;

  function moveTo(index) {
    setActiveIndex((index + items.length) % items.length);
  }

  function handleKeyDown(event) {
    if (items.length < 2) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTo(safeActiveIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveTo(safeActiveIndex + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(items.length - 1);
    }
  }

  return (
    <section className="page-images" aria-label="Attached images">
      <div className="page-images-heading">
        <h2>Images</h2>
        <span className="meta" aria-live="polite">{safeActiveIndex + 1} of {items.length}</span>
      </div>
      <div
        className="page-image-carousel"
        role="region"
        aria-roledescription="carousel"
        aria-label="Attached images carousel"
        tabIndex={items.length > 1 ? 0 : undefined}
        onKeyDown={handleKeyDown}
      >
        <div className="page-image-stage">
          {items.length > 1 ? (
            <button
              className="page-image-control page-image-control-previous"
              type="button"
              aria-label="Previous attached image"
              onClick={() => moveTo(safeActiveIndex - 1)}
            >
              <span aria-hidden="true">‹</span>
            </button>
          ) : null}
          <button
            className="page-image-link"
            type="button"
            aria-label={`Open attached image ${safeActiveIndex + 1}: ${activeLabel}`}
            onClick={() => onImageOpen?.(safeActiveIndex)}
          >
            <img src={activeItem.url} alt={activeItem.alt_text || activeLabel} loading="eager" />
          </button>
          {items.length > 1 ? (
            <button
              className="page-image-control page-image-control-next"
              type="button"
              aria-label="Next attached image"
              onClick={() => moveTo(safeActiveIndex + 1)}
            >
              <span aria-hidden="true">›</span>
            </button>
          ) : null}
        </div>
        <div className="page-image-caption" aria-live="polite">
          <span>{activeItem.caption || activeLabel}</span>
          {activeItem.timestamp || activeItem.source ? (
            <small>{[activeItem.timestamp, activeItem.source].filter(Boolean).join(' · ')}</small>
          ) : null}
        </div>
        {items.length > 1 ? (
          <div className="page-image-dots" role="tablist" aria-label="Choose attached image">
            {items.map((image, index) => {
              const label = image.caption || image.alt_text || image.filename || `Attached image ${index + 1}`;
              return (
                <button
                  className={`page-image-dot ${index === safeActiveIndex ? 'active' : ''}`}
                  key={`${image.path}:${index}`}
                  type="button"
                  role="tab"
                  aria-label={`Show attached image ${index + 1}: ${label}`}
                  aria-selected={index === safeActiveIndex}
                  onClick={() => moveTo(index)}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PageImageLightbox({ images, activeIndex, onClose, onIndexChange, onOpenPage }) {
  const items = Array.isArray(images) ? images.filter((image) => image?.url) : [];
  const closeButtonRef = useRef(null);
  const imageViewportRef = useRef(null);
  const imagePanRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const compareResizeRef = useRef(null);
  const activeIndexRef = useRef(activeIndex);
  const onCloseRef = useRef(onClose);
  const onIndexChangeRef = useRef(onIndexChange);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [compareIndex, setCompareIndex] = useState(null);
  const [comparePickerOpen, setComparePickerOpen] = useState(false);
  const [compareSplit, setCompareSplit] = useState(50);
  const safeActiveIndex = Math.min(Math.max(Number.isInteger(activeIndex) ? activeIndex : 0, 0), Math.max(items.length - 1, 0));
  const isOpen = items.length > 0 && Number.isInteger(activeIndex);
  const activeImageUrl = items[safeActiveIndex]?.url;

  activeIndexRef.current = safeActiveIndex;
  onCloseRef.current = onClose;
  onIndexChangeRef.current = onIndexChange;

  useEffect(() => {
    if (!isOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (items.length < 2) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = activeIndexRef.current;
      const nextIndex = event.key === 'ArrowLeft'
        ? currentIndex - 1
        : event.key === 'ArrowRight'
          ? currentIndex + 1
          : event.key === 'Home'
            ? 0
            : items.length - 1;
      onIndexChangeRef.current?.((nextIndex + items.length) % items.length);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [isOpen, items.length]);

  useEffect(() => {
    setZoom(1);
    imagePanRef.current = null;
    zoomAnchorRef.current = null;
    setIsPanning(false);
    setCompareIndex(null);
    setComparePickerOpen(false);
    setCompareSplit(50);
    const viewport = imageViewportRef.current;
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }, [activeImageUrl, isOpen]);

  useEffect(() => {
    if (compareIndex === safeActiveIndex) setCompareIndex(null);
  }, [compareIndex, safeActiveIndex]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor || anchor.zoom !== zoom) return;
    anchor.viewport.scrollLeft = anchor.imageX * zoom - anchor.viewportX;
    anchor.viewport.scrollTop = anchor.imageY * zoom - anchor.viewportY;
    zoomAnchorRef.current = null;
  }, [zoom]);

  if (!isOpen) return null;

  const activeItem = items[safeActiveIndex];
  const activeLabel = activeItem.caption || activeItem.alt_text || activeItem.filename || `Attached image ${safeActiveIndex + 1}`;
  const comparisonItem = Number.isInteger(compareIndex) ? items[compareIndex] : null;

  function moveTo(index) {
    if (items.length < 2) return;
    onIndexChange?.((index + items.length) % items.length);
  }

  function handleImageWheel(event) {
    if (event.metaKey) {
      event.preventDefault();
      const nextZoom = Math.min(5, Math.max(1, zoom * Math.exp(-event.deltaY * 0.005)));
      if (nextZoom !== zoom) {
        const viewport = event.currentTarget;
        const bounds = viewport.getBoundingClientRect();
        const viewportX = event.clientX - bounds.left;
        const viewportY = event.clientY - bounds.top;
        zoomAnchorRef.current = {
          viewport,
          viewportX,
          viewportY,
          imageX: (viewport.scrollLeft + viewportX) / zoom,
          imageY: (viewport.scrollTop + viewportY) / zoom,
          zoom: nextZoom,
        };
        setZoom(nextZoom);
      }
      return;
    }
    if (zoom <= 1) return;
    event.preventDefault();
    event.currentTarget.scrollBy({ left: event.deltaX, top: event.deltaY });
  }

  function handleImagePointerDown(event) {
    if (zoom <= 1 || event.button !== 0) return;
    const viewport = event.currentTarget;
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    imagePanRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setIsPanning(true);
  }

  function handleImagePointerMove(event) {
    const pan = imagePanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
    event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.clientY);
  }

  function handleImagePointerEnd(event) {
    if (imagePanRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    imagePanRef.current = null;
    setIsPanning(false);
  }

  function handleCompareResizePointerDown(event) {
    const stage = event.currentTarget.parentElement;
    if (!stage || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    compareResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startSplit: compareSplit, width: stage.getBoundingClientRect().width };
  }

  function handleCompareResizePointerMove(event) {
    const resize = compareResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setCompareSplit(Math.min(75, Math.max(25, resize.startSplit + (event.clientX - resize.startX) / resize.width * 100)));
  }

  function handleCompareResizePointerEnd(event) {
    if (compareResizeRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    compareResizeRef.current = null;
  }

  return (
    <div
      className="page-image-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${activeLabel}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="page-image-lightbox" onClick={(event) => event.stopPropagation()}>
        <div className="page-image-lightbox-head">
          <span aria-live="polite">Image {safeActiveIndex + 1} of {items.length}</span>
          <div className="page-image-lightbox-actions">
            {items.length > 1 ? (
              <button
                className="page-image-lightbox-compare"
                type="button"
                aria-expanded={comparePickerOpen}
                aria-controls="page-image-lightbox-compare-picker"
                onClick={() => setComparePickerOpen((open) => !open)}
              >
                Compare
              </button>
            ) : null}
            <button
              ref={closeButtonRef}
              className="page-image-lightbox-close"
              type="button"
              aria-label="Close image viewer"
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
        <div
          className={`page-image-lightbox-stage${comparisonItem ? ' is-comparing' : ''}`}
          style={comparisonItem ? { '--compare-primary': `${compareSplit}fr`, '--compare-secondary': `${100 - compareSplit}fr` } : undefined}
        >
          <div className="page-image-lightbox-nav-slot">{items.length > 1 ? (
            <button
              className="page-image-lightbox-control page-image-lightbox-control-previous"
              type="button"
              aria-label="Previous image"
              onClick={() => moveTo(safeActiveIndex - 1)}
            >
              <span aria-hidden="true">‹</span>
            </button>
          ) : null}</div>
          <div
            ref={imageViewportRef}
            className={`page-image-lightbox-image${zoom > 1 ? ' is-zoomed' : ''}${isPanning ? ' is-panning' : ''}`}
            onWheel={handleImageWheel}
            onPointerDown={handleImagePointerDown}
            onPointerMove={handleImagePointerMove}
            onPointerUp={handleImagePointerEnd}
            onPointerCancel={handleImagePointerEnd}
            aria-label={zoom > 1 ? 'Zoomed image. Scroll to pan.' : 'Image. Hold Command and scroll to zoom.'}
          >
            <div className="page-image-lightbox-image-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              <img src={activeItem.url} alt={activeItem.alt_text || activeLabel} draggable="false" />
            </div>
          </div>
          {comparisonItem ? (
            <div
              className="page-image-lightbox-compare-resizer"
              role="separator"
              aria-label="Resize compared images"
              aria-orientation="vertical"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={Math.round(compareSplit)}
              tabIndex={0}
              onPointerDown={handleCompareResizePointerDown}
              onPointerMove={handleCompareResizePointerMove}
              onPointerUp={handleCompareResizePointerEnd}
              onPointerCancel={handleCompareResizePointerEnd}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault();
                setCompareSplit((split) => Math.min(75, Math.max(25, split + (event.key === 'ArrowLeft' ? -5 : 5))));
              }}
            />
          ) : null}
          {comparisonItem ? (
            <ComparisonImageViewport
              item={comparisonItem}
              label={comparisonItem.caption || comparisonItem.alt_text || comparisonItem.filename || `Attached image ${compareIndex + 1}`}
            />
          ) : null}
          <div className="page-image-lightbox-nav-slot">{items.length > 1 ? (
            <button
              className="page-image-lightbox-control page-image-lightbox-control-next"
              type="button"
              aria-label="Next image"
              onClick={() => moveTo(safeActiveIndex + 1)}
            >
              <span aria-hidden="true">›</span>
            </button>
          ) : null}</div>
        </div>
        {comparePickerOpen ? (
          <aside id="page-image-lightbox-compare-picker" className="page-image-lightbox-compare-picker" aria-label="Choose an image to compare">
            <div className="page-image-lightbox-compare-picker-head">
              <strong>Compare with</strong>
              <button type="button" aria-label="Close comparison picker" onClick={() => setComparePickerOpen(false)}>×</button>
            </div>
            <div className="page-image-lightbox-compare-list">
              {items.map((image, index) => {
                if (index === safeActiveIndex) return null;
                const label = image.caption || image.alt_text || image.filename || `Attached image ${index + 1}`;
                return (
                  <button
                    key={`${image.path || image.url}:${index}`}
                    type="button"
                    className={`page-image-lightbox-compare-option${index === compareIndex ? ' active' : ''}`}
                    aria-pressed={index === compareIndex}
                    aria-label={`Compare ${label}`}
                    onClick={() => {
                      setCompareIndex(index);
                      setComparePickerOpen(false);
                    }}
                  >
                    <img src={image.url} alt="" />
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}
        <div className="page-image-lightbox-caption" aria-live="polite">
          <div className="page-image-lightbox-caption-copy">
            <strong>{activeItem.caption || activeLabel}</strong>
            {activeItem.timestamp || activeItem.source ? (
              <small>{[activeItem.timestamp, activeItem.source].filter(Boolean).join(' · ')}</small>
            ) : null}
          </div>
          {onOpenPage && activeItem.page_slug ? (
            <button type="button" className="page-image-lightbox-open-page" onClick={() => onOpenPage(activeItem.page_slug)}>
              Open page <span aria-hidden="true">↗</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ComparisonImageViewport({ item, label }) {
  const viewportRef = useRef(null);
  const panRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    setZoom(1);
    panRef.current = null;
    zoomAnchorRef.current = null;
    setIsPanning(false);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }, [item.url]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor || anchor.zoom !== zoom) return;
    anchor.viewport.scrollLeft = anchor.imageX * zoom - anchor.viewportX;
    anchor.viewport.scrollTop = anchor.imageY * zoom - anchor.viewportY;
    zoomAnchorRef.current = null;
  }, [zoom]);

  function handleWheel(event) {
    if (event.metaKey) {
      event.preventDefault();
      const nextZoom = Math.min(5, Math.max(1, zoom * Math.exp(-event.deltaY * 0.005)));
      if (nextZoom !== zoom) {
        const viewport = event.currentTarget;
        const bounds = viewport.getBoundingClientRect();
        const viewportX = event.clientX - bounds.left;
        const viewportY = event.clientY - bounds.top;
        zoomAnchorRef.current = {
          viewport,
          viewportX,
          viewportY,
          imageX: (viewport.scrollLeft + viewportX) / zoom,
          imageY: (viewport.scrollTop + viewportY) / zoom,
          zoom: nextZoom,
        };
        setZoom(nextZoom);
      }
      return;
    }
    if (zoom <= 1) return;
    event.preventDefault();
    event.currentTarget.scrollBy({ left: event.deltaX, top: event.deltaY });
  }

  function handlePointerDown(event) {
    if (zoom <= 1 || event.button !== 0) return;
    const viewport = event.currentTarget;
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    setIsPanning(true);
  }

  function handlePointerMove(event) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
    event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.clientY);
  }

  function handlePointerEnd(event) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panRef.current = null;
    setIsPanning(false);
  }

  return (
    <div
      ref={viewportRef}
      className={`page-image-lightbox-image${zoom > 1 ? ' is-zoomed' : ''}${isPanning ? ' is-panning' : ''}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      aria-label={zoom > 1 ? `Zoomed comparison image: ${label}. Scroll or drag to pan.` : `Comparison image: ${label}. Hold Command and scroll to zoom.`}
    >
      <div className="page-image-lightbox-image-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
        <img src={item.url} alt={item.alt_text || label} draggable="false" />
      </div>
    </div>
  );
}

function PrivatePageBackLink() {
  return (
    <a
      className="private-page-back-link"
      href={dashboardRootHrefFromBasePath(document.body?.dataset?.dashboardBasePath)}
    >
      Back to dashboard
    </a>
  );
}

function PublicPageApp() {
  const [state, setState] = useState({ status: 'loading', error: null, page: null });
  const [rawFileView, setRawFileView] = useState('list');
  const [imageViewerIndex, setImageViewerIndex] = useState(null);
  const slug = useMemo(() => publicSlugFromPath(window.location.pathname), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!slug) throw new Error('Public page not found.');
        const params = new URLSearchParams({ slug });
        const page = await fetchJson(`/api/public/page?${params.toString()}`);
        if (page.redirect_to && window.location.pathname !== page.redirect_to) {
          window.history.replaceState(null, '', page.redirect_to);
        }
        if (!cancelled) setState({ status: 'ready', error: null, page });
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', error: 'Public page not found.', page: null });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    setImageViewerIndex(null);
  }, [slug]);

  if (state.status === 'loading') {
    return (
      <main className="public-main">
        <article className="public-document">
          <div className="empty-copy">Loading public page…</div>
        </article>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="public-main">
        <article className="public-document">
          <h1>Page not found</h1>
          <p className="empty-copy">{state.error}</p>
        </article>
      </main>
    );
  }

  return (
    <main className="public-main">
      <article className={`public-document raw-file-view-${rawFileView}`}>
        <header className="public-document-head">
          <h1>{state.page.title}</h1>
          {Array.isArray(state.page.raw_files) && state.page.raw_files.length ? (
            <div className="public-view-toggle" role="group" aria-label="Raw file layout">
              <button
                type="button"
                className={`public-view-button ${rawFileView === 'list' ? 'active' : ''}`}
                aria-label="Show raw files as a list"
                aria-pressed={rawFileView === 'list'}
                onClick={() => setRawFileView('list')}
              >
                <span aria-hidden="true">☰</span>
              </button>
              <button
                type="button"
                className={`public-view-button ${rawFileView === 'grid' ? 'active' : ''}`}
                aria-label="Show raw files as a grid"
                aria-pressed={rawFileView === 'grid'}
                onClick={() => setRawFileView('grid')}
              >
                <span aria-hidden="true">▦</span>
              </button>
            </div>
          ) : null}
        </header>
        <PageImageCarousel images={state.page.images} onImageOpen={setImageViewerIndex} />
        <PageSummary summary={state.page.summary} />
        <MarkdownDocument
          markdown={state.page.markdown}
          sourceSlug={state.page.slug}
          images={state.page.images}
          onImageClick={setImageViewerIndex}
          emptyLabel="This public page is empty."
        />
      </article>
      <PageImageLightbox
        images={state.page.images}
        activeIndex={imageViewerIndex}
        onClose={() => setImageViewerIndex(null)}
        onIndexChange={setImageViewerIndex}
      />
    </main>
  );
}

function SharedGroupApp() {
  const [state, setState] = useState({ status: 'loading', error: null, group: null });
  const slug = useMemo(() => sharedSlugFromPath(window.location.pathname), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!slug) throw new Error('Shared collection not found.');
        const params = new URLSearchParams({ slug });
        const group = await fetchJson(`/api/shared/group?${params.toString()}`);
        if (group.redirect_to && window.location.pathname !== group.redirect_to) {
          window.history.replaceState(null, '', group.redirect_to);
        }
        if (!cancelled) setState({ status: 'ready', error: null, group });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', error: 'Shared collection not found.', group: null });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === 'loading') {
    return (
      <main className="public-main">
        <article className="public-document">
          <div className="empty-copy">Loading shared collection…</div>
        </article>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="public-main">
        <article className="public-document">
          <h1>Shared collection not found</h1>
          <p className="empty-copy">{state.error}</p>
        </article>
      </main>
    );
  }

  return (
    <main className="public-main">
      <article className="public-document shared-group-document">
        <header className="public-document-head shared-group-head">
          <div>
            <h1>{state.group.title}</h1>
            {state.group.description ? <p className="empty-copy">{state.group.description}</p> : null}
          </div>
        </header>
        <div className="shared-group-grid">
          {state.group.pages.map((page) => {
            const href = Array.isArray(page.raw_files) && page.raw_files.length ? page.raw_files[0].url : null;
            const Card = href ? 'a' : 'section';
            return (
            <Card className="shared-group-card" href={href || undefined} key={page.slug}>
              <h2>{page.title}</h2>
              {page.summary ? <p>{page.summary}</p> : null}
            </Card>
            );
          })}
        </div>
      </article>
    </main>
  );
}

function RootApp() {
  if (window.location.pathname === '/graph-lab') return <GraphDesignLabApp />;
  if (isSharedGroupLocation(window.location.pathname)) return <SharedGroupApp />;
  if (isPublicPageLocation(window.location.pathname)) return <PublicPageApp />;
  const privatePageRoute = privatePageRouteFromPath(window.location.pathname);
  return privatePageRoute ? <PrivatePageApp route={privatePageRoute} /> : <DashboardApp />;
}

function isPublicPageLocation(pathname) {
  return pathname === '/public' || pathname.startsWith('/public/');
}

function isSharedGroupLocation(pathname) {
  return pathname === '/shared' || pathname.startsWith('/shared/');
}

function publicSlugFromPath(pathname) {
  if (!isPublicPageLocation(pathname)) return '';
  const raw = pathname.replace(/^\/public\/?/, '');
  try {
    return decodeURIComponent(raw).replace(/^\/+/, '').replace(/\/+$/, '');
  } catch (_error) {
    return raw.replace(/^\/+/, '').replace(/\/+$/, '');
  }
}

function sharedSlugFromPath(pathname) {
  if (!isSharedGroupLocation(pathname)) return '';
  const raw = pathname.replace(/^\/shared\/?/, '');
  try {
    return decodeURIComponent(raw).replace(/^\/+/, '').replace(/\/+$/, '');
  } catch (_error) {
    return raw.replace(/^\/+/, '').replace(/\/+$/, '');
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
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
      return formatGitDurabilityMessage(item.details);
    case 'missing_separator':
      return 'Missing required separator in page body.';
    case 'missing_filing_rules':
      return item.details?.expected_path
        ? `Missing ${item.details.expected_path}.`
        : 'Folder is missing FILING.md.';
    case 'inbound_event_failed':
    case 'inbound_event_quarantined':
      return `${item.details?.listener_id || 'Inbound'} event failed: ${item.details?.last_error || 'review required.'}`;
    case 'invalid_meeting_prep_heading':
      return 'Meeting prep has unexpected headings.';
    default:
      return item.finding_type ? item.finding_type.replaceAll('_', ' ') : 'Health finding';
  }
}

function formatGitDurabilityMessage(details = {}) {
  const upstream = [details.canonical_remote, details.canonical_branch].filter(Boolean).join('/');
  const target = upstream ? ` to ${upstream}` : '';
  if (details.sync_status === 'no_repository' || details.sync_status === 'no_upstream') {
    return 'Git backup is not configured. It is optional but recommended.';
  }
  if (details.sync_status === 'dirty') {
    const changeCount = Array.isArray(details.summary)
      ? details.summary.filter((line) => !String(line).startsWith('## ')).length
      : 0;
    return changeCount
      ? `${changeCount} ${changeCount === 1 ? 'change is' : 'changes are'} not backed up${target}.`
      : `Local changes are not backed up${target}.`;
  }
  if (details.sync_status === 'ahead') {
    const count = Number(details.ahead_count) || 0;
    return `${count} ${count === 1 ? 'commit is' : 'commits are'} not backed up${target}.`;
  }
  if (details.sync_status === 'behind') {
    const count = Number(details.behind_count) || 0;
    return `Runtime is ${count} ${count === 1 ? 'commit' : 'commits'} behind${target || ' its upstream'}.`;
  }
  if (details.sync_status === 'diverged') {
    return `Runtime and${target || ' its upstream'} have diverged.`;
  }
  if (details.sync_status === 'error' || details.sync_status === 'unknown') {
    return 'Git backup status could not be verified.';
  }
  return 'Git backup status needs review.';
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
const GRAPH_FLOW_INPUT_LIMIT = 6;
const GRAPH_ACTIVITY_MODES = [
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'cumulative-bars', label: 'Cumulative bars' },
  { id: 'cumulative-line', label: 'Cumulative line' },
];

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

function IconButton({ className = '', children, style, ...props }) {
  const ghostStyle = {
    appearance: 'none',
    WebkitAppearance: 'none',
    background: 'transparent',
    backgroundImage: 'none',
    border: 0,
    boxShadow: 'none',
  };
  return <button type="button" className={`icon-button-ghost ${className}`.trim()} style={{ ...style, ...ghostStyle }} {...props}>{children}</button>;
}

function PageSidecar({ preview, onClose, onRelativeLinkClick, onRawLinkClick, onPageOpen, onVisibilityChange, onResizeStart }) {
  const pathLabel = preview?.path || preview?.slug || preview?.href || '';
  const visibility = preview?.visibility === 'public' ? 'public' : 'internal';
  const isPublic = visibility === 'public';
  const canChangeVisibility = preview?.status === 'ready' && preview?.slug && !preview?.demo && onVisibilityChange;
  const visibilityBusy = preview?.visibility_status === 'saving';
  const publicUrl = preview?.slug ? `${window.location.origin}/public/${preview.slug}` : '';
  const [copiedPublicLink, setCopiedPublicLink] = useState(false);
  const [imageViewerIndex, setImageViewerIndex] = useState(null);

  useEffect(() => {
    setImageViewerIndex(null);
  }, [preview?.slug]);

  async function changeVisibility(nextVisibility) {
    if (!canChangeVisibility || visibilityBusy) return;
    if (nextVisibility === 'public') {
      const confirmed = window.confirm('This makes the body of this page available to anyone with the link. Continue?');
      if (!confirmed) return;
    }
    await onVisibilityChange(preview.slug, nextVisibility);
  }

  async function copyPublicLink() {
    if (!publicUrl) return;
    try {
      await copyTextToClipboard(publicUrl);
      setCopiedPublicLink(true);
      window.setTimeout(() => setCopiedPublicLink(false), 1200);
    } catch (error) {
      console.warn('Unable to copy public link', error);
    }
  }

  return (
    <>
      <aside className="sidecar-shell" aria-hidden={!preview}>
        {preview ? <button type="button" tabIndex={-1} className="sidecar-resize-handle" aria-label="Resize sidecar" onPointerDown={onResizeStart} /> : null}
        <div className="sidecar-panel">
        <div className="sidecar-head">
          <div className="sidecar-title-row">
            <div className="sidecar-title-copy">
              {preview?.title ? <h1 className="sidecar-page-title">{preview.title}</h1> : null}
              <div className="sidecar-path-row">
                {pathLabel ? <span className="meta">{pathLabel}</span> : null}
              </div>
            </div>
            <div className="sidecar-actions">
              {canChangeVisibility ? (
                <>
                  {isPublic ? (
                    <>
                      <button type="button" className="graph-button" onClick={copyPublicLink} disabled={visibilityBusy}>
                        {copiedPublicLink ? 'Copied' : 'Copy public link'}
                      </button>
                      <button type="button" className="graph-button" onClick={() => changeVisibility('internal')} disabled={visibilityBusy} title="Public. Click to make private.">
                        Public
                      </button>
                    </>
                  ) : (
                    <button type="button" className="graph-button" onClick={() => changeVisibility('public')} disabled={visibilityBusy} title="Private. Click to make public.">
                      Private
                    </button>
                  )}
                </>
              ) : null}
              <IconButton className="sidecar-close-button" onClick={onClose} aria-label="Close page preview" title="Close">
                <X size={18} strokeWidth={1.8} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
          {preview?.visibility_status === 'error' ? <div className="sidecar-error">{preview.visibility_error}</div> : null}
        </div>

        <div className="sidecar-body">
          {preview?.status === 'loading' && <div className="empty-copy">Loading page…</div>}
          {preview?.status === 'error' && <div className="empty-copy">{preview.message}</div>}
          {preview?.status === 'ready' ? (
            <PageDetails
              page={preview}
              onImageOpen={setImageViewerIndex}
              onRelativeLinkClick={onRelativeLinkClick}
              onRawLinkClick={onRawLinkClick}
              onPageOpen={onPageOpen}
            />
          ) : null}
        </div>
        </div>
      </aside>
      <PageImageLightbox
        images={preview?.images}
        activeIndex={imageViewerIndex}
        onClose={() => setImageViewerIndex(null)}
        onIndexChange={setImageViewerIndex}
      />
    </>
  );
}

// The node sidecar owns the internal page presentation, shared by direct page links.
function PageDetails({ page, onImageOpen, onRelativeLinkClick, onRawLinkClick, onPageOpen }) {
  const outgoing = Array.isArray(page.links?.outgoing) ? page.links.outgoing : [];
  const backlinks = Array.isArray(page.links?.backlinks) ? page.links.backlinks : [];
  return (
    <>
      <PageContentPreview
        markdown={page.body || page.markdown}
        title={page.title}
        summary={page.summary}
        timelineEntries={page.timeline_entries}
        sourceSlug={page.slug}
        frontmatter={page.frontmatter}
        images={page.images}
        onImageOpen={onImageOpen}
        onRelativeLinkClick={onRelativeLinkClick}
        onRawLinkClick={onRawLinkClick}
        bodyClassName={`sidecar-document ${outgoing.length || backlinks.length ? 'has-link-sections' : ''}`}
        emptyLabel="This file is empty."
      />
      <PageLinkSection title="Links out" links={outgoing} onPageOpen={onPageOpen} />
      <PageLinkSection title="Backlinks" links={backlinks} onPageOpen={onPageOpen} />
    </>
  );
}

function PageContentPreview({
  markdown,
  title,
  summary,
  timelineEntries,
  sourceSlug,
  frontmatter,
  images,
  onImageOpen,
  onRelativeLinkClick,
  onRawLinkClick,
  bodyClassName = '',
  className = '',
  emptyLabel = '',
}) {
  const contentClassName = ['page-content-preview', className].filter(Boolean).join(' ');
  const documentClassName = ['page-content-document', bodyClassName].filter(Boolean).join(' ');
  const pageMarkdown = stripLeadingMarkdownHeading(
    markdown,
    title,
  );

  return (
    <div className={contentClassName}>
      <PageImageCarousel images={images} compact onImageOpen={onImageOpen} />
      <ContactChannelsCard channels={frontmatter?.contact_channels} />
      <PageMetadata
        frontmatter={frontmatter}
        sourceSlug={sourceSlug}
        onRelativeLinkClick={onRelativeLinkClick}
      />
      <PageSummaryCard summary={summary} />
      <section className={`page-body-section ${documentClassName}`} aria-label="Body">
        <span className="page-section-label">Body</span>
        <MarkdownDocument
          markdown={pageMarkdown}
          sourceSlug={sourceSlug}
          images={images}
          onImageClick={onImageOpen}
          onRelativeLinkClick={onRelativeLinkClick}
          onRawLinkClick={onRawLinkClick}
          emptyLabel={emptyLabel}
        />
      </section>
      <PageTimelineCard entries={timelineEntries} />
    </div>
  );
}

function PageSummaryCard({ summary }) {
  if (!summary) return null;
  return (
    <section className="page-summary-card" aria-label="Summary">
      <span className="page-section-label">Summary</span>
      <p>{summary}</p>
    </section>
  );
}

function PageTimelineCard({ entries }) {
  const items = Array.isArray(entries) ? entries : [];
  return (
    <section className="page-timeline-card" aria-label="Timeline">
      <span className="page-section-label">Timeline</span>
      {items.length ? (
        <ol className="page-timeline-list">
          {items.map((entry, index) => {
            const provenance = entry?.provenance || {};
            const sourceType = graphFlowSourceType(provenance.source_type);
            const sourceLabel = provenance.source_label || graphFlowSourceLabel(sourceType);
            const sourceMessage = provenance.source_message || null;
            const occurredAt = entry?.occurred_at || entry?.occurred_label || '';
            return (
              <li className="page-timeline-item" key={entry?.entry_id || `${occurredAt}:${index}`}>
                <span className="page-timeline-node" aria-hidden="true" />
                <div className="page-timeline-item-card">
                  <div className="page-timeline-item-meta">
                    <GraphFlowSourceIcon source={{ type: sourceType, label: sourceLabel }} />
                    {occurredAt ? <time dateTime={entry?.occurred_at || undefined}>{formatTimelineDate(occurredAt)}</time> : null}
                    <span className="page-timeline-source-label">{sourceLabel}</span>
                  </div>
                  <p className="page-timeline-description">{entry?.text}</p>
                  {sourceMessage && sourceMessage !== entry?.text ? (
                    <p className="page-timeline-source-message">{sourceMessage}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="page-timeline-empty">No recorded updates yet.</p>}
    </section>
  );
}

function formatTimelineDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function PageMetadata({ frontmatter, sourceSlug, onRelativeLinkClick }) {
  const entries = Object.entries(frontmatter || {})
    .filter(([key, value]) => !['summary', 'contact_channels'].includes(key) && hasMetadataValue(value));
  if (!entries.length) return null;
  return (
    <details className="sidecar-metadata">
      <summary>Metadata</summary>
      <dl className="sidecar-metadata-records">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{formatMetadataKey(key)}</dt>
            <dd>
              <MetadataValue
                keyName={key}
                value={value}
                sourceSlug={sourceSlug}
                onRelativeLinkClick={onRelativeLinkClick}
              />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ContactChannelsCard({ channels }) {
  const items = Array.isArray(channels)
    ? channels.filter((channel) => channel && typeof channel === 'object' && channel.type && channel.value)
    : [];
  if (!items.length) return null;
  return (
    <section className="page-contact-card" aria-label="Contact channels">
      <span className="page-section-label">Contact channels</span>
      <ul className="page-contact-list">
        {items.map((channel, index) => {
          const link = contactChannelLink(channel.type, channel.value);
          const value = String(channel.value);
          return (
            <li className="page-contact-row" key={channel.id || `${channel.type}:${value}:${index}`}>
              <span className="page-contact-kind">{channel.label || formatMetadataKey(channel.type)}</span>
              {link ? (
                <a
                  className="page-contact-value"
                  href={link.href}
                  target={link.newTab ? '_blank' : undefined}
                  rel={link.newTab ? 'noreferrer' : undefined}
                >
                  {value}
                </a>
              ) : <span className="page-contact-value">{value}</span>}
              <span className="page-contact-badges">
                {channel.primary ? <span className="page-contact-badge">Primary</span> : null}
                {channel.verified_at ? (
                  <time className="page-contact-verified" dateTime={channel.verified_at}>
                    Verified {formatTimelineDate(channel.verified_at)}
                  </time>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function contactChannelLink(typeValue, channelValue) {
  const type = String(typeValue || '').trim().toLowerCase();
  const value = String(channelValue || '').trim();
  if (!value) return null;
  if (type === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { href: `mailto:${value}`, newTab: false };
  }
  if (type === 'phone' && value.replace(/\D/g, '').length >= 3) {
    return { href: `tel:${value.replace(/[^\d+]/g, '')}`, newTab: false };
  }
  if (type === 'whatsapp' && value.replace(/\D/g, '').length >= 3) {
    return { href: `https://wa.me/${value.replace(/\D/g, '')}`, newTab: true };
  }
  if (type === 'telegram') {
    const username = value.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
    if (/^[a-z0-9_]{5,}$/i.test(username)) return { href: `https://t.me/${username}`, newTab: true };
  }
  if (['website', 'linkedin', 'signal'].includes(type) && /^https?:\/\//i.test(value)) {
    return { href: value, newTab: true };
  }
  return null;
}

function MetadataValue({ keyName, value, sourceSlug, onRelativeLinkClick }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="sidecar-metadata-empty">None</span>;
    return (
      <ul className="sidecar-metadata-list">
        {value.map((item, index) => (
          <li key={`${keyName}:${index}`}>
            <MetadataValue
              keyName={keyName}
              value={item}
              sourceSlug={sourceSlug}
              onRelativeLinkClick={onRelativeLinkClick}
            />
          </li>
        ))}
      </ul>
    );
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => hasMetadataValue(item));
    if (!entries.length) return <span className="sidecar-metadata-empty">None</span>;
    return (
      <dl className="sidecar-metadata-object">
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt>{formatMetadataKey(key)}</dt>
            <dd>
              <MetadataValue
                keyName={key}
                value={item}
                sourceSlug={sourceSlug}
                onRelativeLinkClick={onRelativeLinkClick}
              />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const text = formatMetadataScalar(value);
  const link = typeof value === 'string' ? describeMetadataLink(value, sourceSlug, keyName) : null;
  if (!link) {
    return keyName === 'status'
      ? <span className="sidecar-metadata-status" title={text.toLowerCase() === 'approved' ? 'Workflow state. Approved means reviewed and cleared for use; visibility is separate.' : 'Workflow state for this page.'}>{text}</span>
      : <span>{text}</span>;
  }

  return (
    <MetadataLink
      value={text}
      link={link}
      sourceSlug={sourceSlug}
      onRelativeLinkClick={onRelativeLinkClick}
    />
  );
}

function MetadataLink({ value, link, sourceSlug, onRelativeLinkClick }) {
  if (link.kind === 'page' && onRelativeLinkClick) {
    return (
      <a
        href={link.target}
        className="sidecar-metadata-link"
        onClick={(event) => {
          event.preventDefault();
          onRelativeLinkClick({ href: link.target, sourceSlug });
        }}
      >
        {value}
      </a>
    );
  }

  return (
    <a
      href={link.href}
      className="sidecar-metadata-link"
      target={link.newTab ? '_blank' : undefined}
      rel={link.newTab ? 'noreferrer' : undefined}
    >
      {value}
    </a>
  );
}

function hasMetadataValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function formatMetadataKey(key) {
  return String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatMetadataScalar(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function describeMetadataLink(value, sourceSlug, keyName) {
  const target = String(value || '').trim();
  if (!target || !looksLikeMetadataLink(target, keyName)) return null;
  if (/^(?:https?:|mailto:)/i.test(target)) {
    return { kind: 'external', href: target, newTab: true };
  }
  if (target.startsWith('/')) {
    return { kind: 'internal', href: target };
  }

  const resolvedTarget = resolveMetadataTarget(sourceSlug, target);
  if (!resolvedTarget) return null;
  if (isMetadataRawFile(resolvedTarget)) {
    return {
      kind: 'raw',
      href: `/api/explorer/blob?path=${encodeURIComponent(resolvedTarget)}`,
      newTab: true,
    };
  }
  return { kind: 'page', target };
}

function looksLikeMetadataLink(value, keyName) {
  if (/^(?:https?:|mailto:)/i.test(value) || /^\.{0,2}\//.test(value) || value.startsWith('/')) return true;
  if (!/^[a-z0-9_-]+\/[a-z0-9_./-]+(?:#.*)?$/i.test(value)) return false;
  const firstSegment = value.split('/')[0].toLowerCase();
  return METADATA_PAGE_COLLECTIONS.has(firstSegment)
    || isMetadataRawFile(value)
    || METADATA_LINK_KEYS.has(String(keyName || '').toLowerCase());
}

const METADATA_PAGE_COLLECTIONS = new Set([
  'articles',
  'concepts',
  'deals',
  'ideas',
  'meetings',
  'organizations',
  'people',
  'processes',
  'products',
  'projects',
  'protocol',
  'tasks',
  'tools',
  'videos',
  'writing',
]);

const METADATA_LINK_KEYS = new Set([
  'article',
  'article_url',
  'attachment',
  'attachments',
  'canonical_url',
  'file',
  'files',
  'link',
  'links',
  'page',
  'pages',
  'public_url',
  'public_url_path',
  'raw_file',
  'raw_files',
  'related',
  'related_pages',
  'source',
  'source_url',
  'sources',
  'url',
]);

function resolveMetadataTarget(sourceSlug, target) {
  const targetPath = target.split('#')[0].trim().replace(/^\/+/, '');
  if (!targetPath) return '';
  if (/^[a-z0-9_-]+\/[a-z0-9_./-]+$/i.test(targetPath)) return targetPath;
  const baseParts = String(sourceSlug || '').split('/').slice(0, -1);
  const parts = [...baseParts, ...targetPath.split('/')];
  const resolved = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!resolved.length) return '';
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

function isMetadataRawFile(target) {
  if (/\.md$/i.test(target)) return false;
  return target.split('/').includes('.raw')
    || (/\.[a-z0-9]+$/i.test(target) && !/\.md$/i.test(target));
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

function ExplorerPanel({ explorer, demoMode, demoSeed }) {
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
    if (demoMode) {
      setFileState({
        status: 'ready',
        file: buildDemoExplorerFile(filePath, fallback, demoSeed),
        error: null,
      });
      return;
    }
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
              ['recents', 'Recent files'],
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

const STREAM_PAGE_TYPE_LABELS = {
  articles: 'Article', deliverables: 'Deliverable',
  videos: 'Video',
  people: 'Person', organizations: 'Organization', companies: 'Company', deals: 'Deal',
  projects: 'Project', ideas: 'Idea', meetings: 'Meeting', tasks: 'Task',
  concepts: 'Concept', components: 'Component', products: 'Product', processes: 'Process',
  writing: 'Writing', protocol: 'Protocol', archive: 'Archive', sources: 'Source',
  inbox: 'Inbox', ops: 'Operations', health: 'Health', dreams: 'Dream',
  'personal-protocol': 'Personal protocol', 'dream-cycle-summaries': 'Dream cycle summary',
};

function streamPageTypeLabel(type) {
  return STREAM_PAGE_TYPE_LABELS[String(type || '').trim().toLowerCase()] || 'Unknown type';
}

function streamSourceText(item) {
  return item.source_message || item.source_label || 'Source not recorded';
}

const STREAM_PAGE_SIZE = 80;

function RecentsPanel({ onOpenPage, selectedSlug, demoMode, typeColors, shortcutsEnabled = true }) {
  const [activity, setActivity] = useState('updated');
  const [kind, setKind] = useState('pages');
  const [collection, setCollection] = useState('');
  const [domain, setDomain] = useState('');
  const [pageTypes, setPageTypes] = useState([]);
  const [selectedSourceTypes, setSelectedSourceTypes] = useState(null);
  const [imageViewerIndex, setImageViewerIndex] = useState(null);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [domainMenuOpen, setDomainMenuOpen] = useState(false);
  const [pageTypeMenuOpen, setPageTypeMenuOpen] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [result, setResult] = useState({ status: 'loading', items: [], collections: [], domainDefinitions: [], pageTypeDefinitions: [], sourceTypes: [], sourceCounts: [], meta: null, error: '' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const collectionMenuRef = useRef(null);
  const domainMenuRef = useRef(null);
  const pageTypeMenuRef = useRef(null);
  const scrollRef = useRef(null);
  const bottomReachGateRef = useRef(createBottomReachGate());
  const scrollIntentRef = useRef({ at: 0, pointerDown: false });
  const moreControllerRef = useRef(null);
  const completedOffsetsRef = useRef(new Set());
  const requestVersionRef = useRef(0);

  useEffect(() => {
    setImageViewerIndex(null);
    setSelectedSourceTypes(null);
  }, [activity, kind, collection, domain, pageTypes.join('|')]);

  useEffect(() => {
    const endPointerScroll = () => { scrollIntentRef.current.pointerDown = false; };
    window.addEventListener('pointerup', endPointerScroll);
    window.addEventListener('pointercancel', endPointerScroll);
    return () => {
      window.removeEventListener('pointerup', endPointerScroll);
      window.removeEventListener('pointercancel', endPointerScroll);
    };
  }, []);

  useEffect(() => {
    if (!collectionMenuOpen && !domainMenuOpen && !pageTypeMenuOpen) return undefined;
    function handlePointerDown(event) {
      if (!collectionMenuRef.current?.contains(event.target)) setCollectionMenuOpen(false);
      if (!domainMenuRef.current?.contains(event.target)) setDomainMenuOpen(false);
      if (!pageTypeMenuRef.current?.contains(event.target)) setPageTypeMenuOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setCollectionMenuOpen(false);
        setDomainMenuOpen(false);
        setPageTypeMenuOpen(false);
      }
    }
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [collectionMenuOpen, domainMenuOpen, pageTypeMenuOpen]);

  useEffect(() => {
    if (!shortcutsEnabled) return undefined;
    function handleStreamShortcut(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'd') return;
      if (document.querySelector('[role="dialog"], [role="listbox"], .graph-flow-source-filter-menu')) return;
      event.preventDefault();
      setDomain((current) => {
        const next = nextGraphDomainFilter(current ? [current] : [], result.domainDefinitions.map((entry) => entry.id));
        return next[0] || '';
      });
      setDomainMenuOpen(false);
    }
    window.addEventListener('keydown', handleStreamShortcut);
    return () => window.removeEventListener('keydown', handleStreamShortcut);
  }, [result.domainDefinitions, shortcutsEnabled]);

  useEffect(() => {
    requestVersionRef.current += 1;
    completedOffsetsRef.current = new Set();
    bottomReachGateRef.current = createBottomReachGate();
    scrollIntentRef.current = { at: 0, pointerDown: false };
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    moreControllerRef.current?.abort();
    moreControllerRef.current = null;
    setLoadingMore(false);
    setMoreError('');
    if (demoMode) {
      setResult({ status: 'ready', items: [], collections: [], domainDefinitions: [], pageTypeDefinitions: [], sourceTypes: [], sourceCounts: [], meta: null, error: '' });
      return undefined;
    }
    const controller = new AbortController();
    setResult((current) => ({ ...current, status: 'loading', items: [], sourceTypes: [], sourceCounts: [], domainDefinitions: [], pageTypeDefinitions: [], meta: null, error: '' }));
    const params = new URLSearchParams({ activity, kind, limit: String(STREAM_PAGE_SIZE), offset: '0' });
    if (collection) params.set('collection', collection);
    if (domain) params.set('domain', domain);
    if (pageTypes.length) params.set('page_type', pageTypes.join(','));
    fetchJson(`/api/recents?${params}`, { signal: controller.signal })
      .then((data) => setResult({
        status: 'ready',
        items: Array.isArray(data.items) ? data.items : [],
        collections: Array.isArray(data.collections) ? data.collections : [],
        domainDefinitions: Array.isArray(data.domain_definitions) ? data.domain_definitions : [],
        pageTypeDefinitions: Array.isArray(data.page_type_definitions) ? data.page_type_definitions : [],
        sourceTypes: Array.isArray(data.source_types) ? data.source_types : [],
        sourceCounts: Array.isArray(data.source_counts) ? data.source_counts : [],
        meta: data.meta || null,
        error: '',
      }))
      .catch((error) => {
        if (!controller.signal.aborted) setResult((current) => ({ ...current, status: 'error', items: [], error: error.message || String(error) }));
      });
    return () => controller.abort();
  }, [activity, kind, collection, domain, pageTypes, demoMode, refreshVersion]);

  useLayoutEffect(() => {
    if (scrollRef.current) bottomReachGateRef.current.observe(scrollRef.current);
  }, [result.status, result.items.length, kind, activity, collection, domain, pageTypes]);

  function markScrollIntent() {
    scrollIntentRef.current.at = Date.now();
  }

  function handleStreamScroll(event) {
    const intent = scrollIntentRef.current;
    const intentional = intent.pointerDown || Date.now() - intent.at < 1200;
    if (bottomReachGateRef.current.onScroll(event.currentTarget, intentional)) {
      intent.at = 0;
      if (!moreError) loadMore();
    }
  }

  function loadMore() {
    if (result.status !== 'ready' || !result.meta?.has_more || loadingMore || moreControllerRef.current) return;
    const nextOffset = result.meta.next_offset;
    if (!Number.isInteger(nextOffset) || completedOffsetsRef.current.has(nextOffset)) return;
    const requestVersion = requestVersionRef.current;
    const controller = new AbortController();
    moreControllerRef.current = controller;
    setLoadingMore(true);
    setMoreError('');
    const params = new URLSearchParams({ activity, kind, limit: String(STREAM_PAGE_SIZE), offset: String(nextOffset) });
    if (collection) params.set('collection', collection);
    if (domain) params.set('domain', domain);
    if (pageTypes.length) params.set('page_type', pageTypes.join(','));
    fetchJson(`/api/recents?${params}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted || requestVersionRef.current !== requestVersion) return;
        completedOffsetsRef.current.add(nextOffset);
        setResult((current) => ({
          ...current,
          items: appendUniqueRecentItems(current.items, Array.isArray(data.items) ? data.items : [], kind),
          sourceTypes: Array.isArray(data.source_types) ? data.source_types : current.sourceTypes,
          sourceCounts: Array.isArray(data.source_counts) ? data.source_counts : current.sourceCounts,
          domainDefinitions: Array.isArray(data.domain_definitions) ? data.domain_definitions : current.domainDefinitions,
          pageTypeDefinitions: Array.isArray(data.page_type_definitions) ? data.page_type_definitions : current.pageTypeDefinitions,
          meta: data.meta?.has_more && (!Number.isInteger(data.meta.next_offset) || data.meta.next_offset <= nextOffset)
            ? { ...data.meta, has_more: false, next_offset: null }
            : data.meta || { ...current.meta, has_more: false, next_offset: null },
        }));
      })
      .catch((error) => {
        if (!controller.signal.aborted && requestVersionRef.current === requestVersion) setMoreError(error.message || String(error));
      })
      .finally(() => {
        if (moreControllerRef.current !== controller) return;
        moreControllerRef.current = null;
        setLoadingMore(false);
      });
  }

  const timeField = activity === 'added' ? 'created_at' : activity === 'viewed' ? 'viewed_at' : 'updated_at';
  const timestampFor = (item) => kind === 'images' && activity === 'updated'
    ? item.image?.updated_at || item[timeField]
    : item[timeField];
  const galleryItems = kind === 'images' ? result.items.filter((item) => item.image?.url) : [];
  const galleryImages = galleryItems.map((item) => ({
    ...item.image,
    page_slug: item.slug,
    alt_text: item.image.alt_text || item.image.alt || '',
    source: item.title || (item.image.source?.startsWith('http') ? '' : item.image.source) || labelFromSlug(item.slug),
  }));
  const galleryIndexByItem = new Map(galleryItems.map((item, index) => [item, index]));
  const canonicalSourceTypes = result.sourceTypes.filter((entry) => entry?.type && entry?.label);
  const knownSourceTypes = new Set(canonicalSourceTypes.map((entry) => entry.type));
  function sourceTypeForItem(item) {
    const type = String(item.source_type || '').trim().toLowerCase();
    return knownSourceTypes.has(type) ? type : 'unknown';
  }
  const sourceCounts = new Map(result.sourceCounts.map(({ type, count }) => [type, count]));
  const sourceTypes = orderStreamSourceTypes(canonicalSourceTypes
    .map(({ type, label }) => [type, sourceCounts.get(type) ?? null, label]));
  const allSourcesSelected = selectedSourceTypes === null;
  function toggleSourceType(type) {
    setSelectedSourceTypes((current) => {
      const next = current === null
        ? new Set(sourceTypes.map(([sourceType]) => sourceType).filter((sourceType) => sourceType !== type))
        : new Set(current);
      if (current !== null) {
        if (next.has(type)) next.delete(type);
        else next.add(type);
      }
      return next.size === sourceTypes.length ? null : next;
    });
  }
  const filtersActive = Boolean(collection || domain || pageTypes.length);
  function resetStreamFilters() {
    setCollection('');
    setDomain('');
    setPageTypes([]);
    setCollectionMenuOpen(false);
    setDomainMenuOpen(false);
    setPageTypeMenuOpen(false);
  }
  const visibleItems = kind === 'images'
    ? galleryItems
    : result.items.filter((item) => allSourcesSelected || selectedSourceTypes.has(sourceTypeForItem(item)));
  const groups = kind === 'images'
    ? [{ label: null, items: visibleItems }]
    : [];
  if (kind === 'pages') {
    for (const item of visibleItems) {
      const label = recentDateGroupLabel(timestampFor(item));
      const group = groups.at(-1);
      if (group?.label === label) group.items.push(item);
      else groups.push({ label, items: [item] });
    }
  }
  const errorIsMissingRoute = result.error.includes('failed with 404');
  const selectedCollection = result.collections.find((entry) => entry.id === collection);
  const selectedDomain = result.domainDefinitions.find((entry) => entry.id === domain);
  const selectedPageTypes = result.pageTypeDefinitions.filter((entry) => pageTypes.includes(entry.type));
  const collectionName = selectedCollection?.title || 'this collection';
  const emptyTitle = demoMode
    ? 'Stream is off in demo mode'
    : collection
      ? activity === 'viewed' ? `Nothing viewed in ${collectionName}` : `No ${kind} in ${collectionName}`
      : activity === 'viewed' ? 'Nothing viewed yet' : `No ${kind} to show`;
  const emptyCopy = demoMode
    ? 'Turn off demo mode to see activity from this brain.'
    : collection
      ? activity === 'viewed'
        ? kind === 'images'
          ? 'Images attached to pages you open from this collection will appear here.'
          : 'Pages you open from this collection will appear here.'
        : 'Try another collection or choose All collections.'
      : activity === 'viewed'
        ? 'Pages you open in BigBrain will appear here.'
        : kind === 'images'
          ? 'Images attached to pages will appear here when available.'
          : 'New and changed pages will appear here when available.';
  const noSourcesSelected = kind === 'pages' && selectedSourceTypes?.size === 0 && result.items.length > 0;
  const noSourceMatches = kind === 'pages' && !allSourcesSelected && !noSourcesSelected && result.items.length > 0 && !visibleItems.length;

  return (
    <section className="recents-panel" aria-label="Stream">
      <div className="recents-head" style={{ alignItems: 'center', paddingBlock: 18 }}>
        <div className="recents-head-copy">
          <h1>Stream</h1>
        </div>
        <div className="recents-controls">
          <div className="recents-activity-switch" role="group" aria-label="Stream activity">
            {[['updated', 'Updated'], ['viewed', 'Viewed'], ['added', 'Added']].map(([value, label]) => (
              <button key={value} type="button" className={activity === value ? 'active' : ''} aria-pressed={activity === value} onClick={() => setActivity(value)}>{label}</button>
            ))}
          </div>
          <div className="recents-kind-switch" role="group" aria-label="Content type">
            {[['pages', 'Pages'], ['images', 'Images']].map(([value, label]) => (
              <button key={value} type="button" className={kind === value ? 'active' : ''} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>
            ))}
          </div>
          <div className="recents-collection-shell" ref={collectionMenuRef}>
            <button
              type="button"
              className={`recents-collection-trigger ${collectionMenuOpen ? 'active' : ''}`}
              aria-label={`Collection: ${selectedCollection?.title || collection || 'All collections'}`}
              aria-haspopup="menu"
              aria-expanded={collectionMenuOpen}
              onClick={() => { setDomainMenuOpen(false); setPageTypeMenuOpen(false); setCollectionMenuOpen((open) => !open); }}
            >
              <span>{selectedCollection?.title || collection || 'All collections'}</span>
              <span className="recents-collection-chevron" aria-hidden="true">⌄</span>
            </button>
            {collectionMenuOpen ? (
              <div className="graph-filter-menu recents-collection-menu" role="menu" aria-label="Collections">
                <button type="button" className={`menu-item ${!collection ? 'selected' : ''}`} role="menuitemradio" aria-checked={!collection} onClick={() => { setCollection(''); setCollectionMenuOpen(false); }}>
                  <span>All collections</span><span className="menu-item-check" aria-hidden="true">{!collection ? '✓' : ''}</span>
                </button>
                {result.status === 'ready' && !result.collections.length ? <p className="recents-collection-empty" role="note">No saved collections in this brain yet.</p> : null}
                {result.collections.map((entry) => (
                  <button key={entry.id} type="button" className={`menu-item ${collection === entry.id ? 'selected' : ''}`} role="menuitemradio" aria-checked={collection === entry.id} onClick={() => { setCollection(entry.id); setCollectionMenuOpen(false); }}>
                    <span>{entry.title}</span><span className="menu-item-check" aria-hidden="true">{collection === entry.id ? '✓' : ''}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="recents-collection-shell" ref={domainMenuRef}>
            <button
              type="button"
              className={`recents-collection-trigger ${domainMenuOpen ? 'active' : ''}`}
              aria-label={`Domain: ${selectedDomain?.name || domain || 'All domains'}`}
              aria-haspopup="menu"
              aria-expanded={domainMenuOpen}
              onClick={() => { setCollectionMenuOpen(false); setPageTypeMenuOpen(false); setDomainMenuOpen((open) => !open); }}
            >
              <span>{selectedDomain?.name || domain || 'All domains'}</span>
              <kbd className="settings-shortcut">D</kbd>
              <span className="recents-collection-chevron" aria-hidden="true">⌄</span>
            </button>
            {domainMenuOpen ? (
              <div className="graph-filter-menu recents-collection-menu" role="menu" aria-label="Domains">
                <button type="button" className={`menu-item ${!domain ? 'selected' : ''}`} role="menuitemradio" aria-checked={!domain} onClick={() => { setDomain(''); setDomainMenuOpen(false); }}>
                  <span>All domains</span><span className="menu-item-check" aria-hidden="true">{!domain ? '✓' : ''}</span>
                </button>
                {result.domainDefinitions.map((entry) => (
                  <button key={entry.id} type="button" className={`menu-item ${domain === entry.id ? 'selected' : ''}`} role="menuitemradio" aria-checked={domain === entry.id} onClick={() => { setDomain(entry.id); setDomainMenuOpen(false); }}>
                    <span>{entry.name || entry.id}</span><span className="menu-item-check" aria-hidden="true">{domain === entry.id ? '✓' : ''}</span>
                  </button>
                ))}
                {result.status === 'ready' && !result.domainDefinitions.length ? <p className="recents-collection-empty" role="note">No domains are registered in this brain yet.</p> : null}
              </div>
            ) : null}
          </div>
          <div className="recents-collection-shell" ref={pageTypeMenuRef}>
            <button
              type="button"
              className={`recents-collection-trigger ${pageTypeMenuOpen ? 'active' : ''}`}
              aria-label={`Page type: ${selectedPageTypes.length ? selectedPageTypes.map((entry) => streamPageTypeLabel(entry.type)).join(', ') : 'All page types'}`}
              aria-haspopup="menu"
              aria-expanded={pageTypeMenuOpen}
              onClick={() => { setCollectionMenuOpen(false); setDomainMenuOpen(false); setPageTypeMenuOpen((open) => !open); }}
            >
              <span>{selectedPageTypes.length ? `${selectedPageTypes.length} page type${selectedPageTypes.length === 1 ? '' : 's'}` : 'All page types'}</span>
              <span className="recents-collection-chevron" aria-hidden="true">⌄</span>
            </button>
            {pageTypeMenuOpen ? (
              <div className="graph-filter-menu recents-collection-menu" role="menu" aria-label="Page types">
                <button type="button" className={`menu-item ${!pageTypes.length ? 'selected' : ''}`} role="menuitemcheckbox" aria-checked={!pageTypes.length} onClick={() => setPageTypes([])}>
                  <span>All page types</span><span className="menu-item-check" aria-hidden="true">{!pageTypes.length ? '✓' : ''}</span>
                </button>
                {result.pageTypeDefinitions.map((entry) => (
                  <button key={entry.type} type="button" className={`menu-item ${pageTypes.includes(entry.type) ? 'selected' : ''}`} role="menuitemcheckbox" aria-checked={pageTypes.includes(entry.type)} onClick={() => setPageTypes((current) => current.includes(entry.type) ? current.filter((type) => type !== entry.type) : [...current, entry.type])}>
                    <span>{streamPageTypeLabel(entry.type)}</span><span className="menu-item-check" aria-hidden="true">{pageTypes.includes(entry.type) ? '✓' : ''}</span>
                  </button>
                ))}
                {result.status === 'ready' && !result.pageTypeDefinitions.length ? <p className="recents-collection-empty" role="note">No page types are available in this brain yet.</p> : null}
              </div>
            ) : null}
          </div>
          <IconButton
            className={`recents-filter-reset ${filtersActive ? 'active' : ''}`}
            aria-label="Reset Stream filters"
            title="Reset filters"
            disabled={!filtersActive}
            onClick={resetStreamFilters}
          ><X size={17} strokeWidth={1.8} aria-hidden="true" /></IconButton>
        </div>
      </div>
      <div
        className="recents-scroll"
        ref={scrollRef}
        tabIndex={0}
        onScroll={handleStreamScroll}
        onWheel={(event) => { if (event.deltaY > 0) markScrollIntent(); }}
        onTouchMove={markScrollIntent}
        onKeyDown={(event) => { if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) markScrollIntent(); }}
        onPointerDown={() => { scrollIntentRef.current.pointerDown = true; }}
        onPointerUp={() => { scrollIntentRef.current.pointerDown = false; }}
        onPointerCancel={() => { scrollIntentRef.current.pointerDown = false; }}
        aria-live="polite"
      >
        {result.status === 'loading' ? <div className={kind === 'images' ? 'recents-loading recents-loading-gallery' : 'recents-loading recents-loading-pages'} aria-label="Loading Stream">{Array.from({ length: kind === 'images' ? 8 : 5 }, (_, index) => <span key={index} />)}</div> : null}
        {result.status === 'error' ? (
          <div className="recents-state recents-error" role="alert">
            <span className="recents-state-icon" aria-hidden="true">!</span>
            <h2>Stream is unavailable</h2>
            <p>{errorIsMissingRoute ? 'This dashboard is running an older BigBrain service. Restart BigBrain to load Stream.' : 'We couldn’t load recent activity. Check the connection and try again.'}</p>
            <button type="button" className="recents-retry" onClick={() => setRefreshVersion((version) => version + 1)}>Try again</button>
          </div>
        ) : null}
        {result.status === 'ready' && kind === 'pages' && sourceTypes.length ? (
          <div className="recents-source-filter" style={{ width: '100%', maxWidth: 'none', boxSizing: 'border-box', marginInline: 0, justifyContent: 'center' }} role="group" aria-label="Filter Stream pages by source">
            <button type="button" className={`recents-source-pill recents-source-toggle-all ${allSourcesSelected ? 'active' : ''}`} aria-label={allSourcesSelected ? 'Deselect all sources' : 'Select all sources'} title={allSourcesSelected ? 'Deselect all sources' : 'Select all sources'} aria-pressed={allSourcesSelected} onClick={() => setSelectedSourceTypes(allSourcesSelected ? new Set() : null)}>
              {allSourcesSelected ? <SquareCheckBig size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
            </button>
            <div className="recents-source-strip" style={{ flex: '0 1 auto', width: 'max-content', maxWidth: 'calc(100% - 32px)' }}>
              {sourceTypes.map(([type, count, label]) => (
                <button key={type} type="button" className={`recents-source-pill recents-source-pill-${type.replaceAll('_', '-')} ${allSourcesSelected || selectedSourceTypes.has(type) ? 'active' : ''} ${count === 0 ? 'empty' : ''}`} aria-pressed={allSourcesSelected || selectedSourceTypes.has(type)} onClick={() => toggleSourceType(type)}>
                  <span className="recents-source-pill-icon" aria-hidden="true"><GraphFlowSourceIcon source={{ type, label }} /></span>
                  <span>{label}</span>{count !== null ? <small>{count}</small> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {result.status === 'ready' && !visibleItems.length ? (
          <div className={`recents-state ${result.meta?.has_more ? 'recents-state-filtered' : ''}`}>
            <span className="recents-state-icon" aria-hidden="true">{kind === 'images' ? '▧' : '▤'}</span>
            <h2>{noSourcesSelected ? 'No sources selected' : noSourceMatches ? result.meta?.has_more ? 'No matching pages loaded yet' : 'No pages from selected sources' : emptyTitle}</h2>
            <p>{noSourcesSelected ? 'Select a source above or use the control at the beginning of the row to show all.' : noSourceMatches ? result.meta?.has_more ? 'Scroll for older activity, or choose another source.' : 'Choose another source to see more of this Stream.' : emptyCopy}</p>
          </div>
        ) : null}
        {result.status === 'ready' && visibleItems.length ? (
          <div className={`recents-groups ${kind === 'pages' ? 'recents-groups-pages' : ''}`}>
            {groups.map((group) => <div className="recents-group" key={group.label || 'images-all'}>
              {group.label ? <h2>{group.label}</h2> : null}
              <div className={kind === 'images' ? 'recents-gallery' : 'recents-list'}>
                {group.items.map((item, index) => (
                  <button
                    key={kind === 'images' ? `${item.slug}:${item.image?.path || index}` : item.slug}
                    type="button"
                    className={`recents-item ${kind === 'pages' && selectedSlug === item.slug ? 'selected' : ''}`}
                    onClick={async () => {
                      if (kind === 'images') {
                        setImageViewerIndex(galleryIndexByItem.get(item) ?? null);
                        return;
                      }
                      await onOpenPage(item.slug);
                      if (activity === 'viewed') setRefreshVersion((version) => version + 1);
                    }}
                    aria-label={kind === 'images'
                      ? `Open image ${(galleryIndexByItem.get(item) ?? 0) + 1} of ${galleryItems.length}: ${item.image?.caption || item.image?.alt || item.title || labelFromSlug(item.slug)}`
                      : `Open ${streamPageTypeLabel(item.type)} page: ${item.title || labelFromSlug(item.slug)}. Source: ${streamSourceText(item)}`}
                  >
                    {kind === 'images' ? (
                      <span className="recents-thumbnail"><img src={item.image?.url} alt="" loading="lazy" /></span>
                    ) : (
                      <>
                        <span className="recents-page-glyph" role="img" aria-label={`${streamPageTypeLabel(item.type)} page`}>
                          <span style={{ color: typeColors?.[item.type] || 'currentColor', display: 'inline-flex' }}>
                            <PageTypeIcon type={item.type} />
                          </span>
                        </span>
                        <span className="recents-item-copy">
                          <strong>{item.title || labelFromSlug(item.slug)}</strong>
                          <span className="recents-item-source" title={streamSourceText(item)} aria-label={`Source: ${streamSourceText(item)}`}>
                            <span className="recents-item-source-icon" aria-hidden="true"><GraphFlowSourceIcon source={{ type: item.source_type, label: item.source_label }} /></span>
                            <span className="recents-item-source-text">{streamSourceText(item)}</span>
                          </span>
                        </span>
                        <span className="recents-item-time">{formatRelativeTime(timestampFor(item))}</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>)}
          </div>
        ) : null}
        {result.status === 'ready' && result.items.length && result.meta ? (
          <div className={`recents-continuation ${kind === 'pages' ? 'recents-continuation-pages' : ''}`}>
            <span>{result.items.length} of {result.meta.total_count} {kind} loaded</span>
            {moreError ? <p role="alert">Couldn’t load more. Your current items are still here.</p> : null}
            {result.meta.has_more ? moreError ? (
              <button type="button" className="recents-load-more" onClick={loadMore}>Try again</button>
            ) : <strong>{loadingMore ? 'Loading more…' : 'Scroll for more'}</strong> : <strong>End of Stream</strong>}
          </div>
        ) : null}
        {result.status === 'ready' && result.items.length && !result.meta ? <p className="recents-continuation recents-continuation-warning" role="status">This BigBrain service cannot load beyond the first batch. Restart BigBrain to continue.</p> : null}
      </div>
      <PageImageLightbox
        images={galleryImages}
        activeIndex={imageViewerIndex}
        onClose={() => setImageViewerIndex(null)}
        onIndexChange={setImageViewerIndex}
        onOpenPage={async (slug) => {
          setImageViewerIndex(null);
          await onOpenPage(slug);
          if (activity === 'viewed') setRefreshVersion((version) => version + 1);
        }}
      />
    </section>
  );
}

function recentDateGroupLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const now = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (day === new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) return 'Today';
  if (day === new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).format(date);
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
            <span className="explorer-recent-name">{formatRecentFileTitle(file)}</span>
            <span className="explorer-recent-meta">{formatRelativeTime(file.updated_at)}</span>
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
  const [imageViewerIndex, setImageViewerIndex] = useState(null);
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
  useEffect(() => {
    setImageViewerIndex(null);
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
  return (
    <>
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
              {file.blob_url ? (
                <a
                  className="icon-button explorer-header-button"
                  href={file.blob_url}
                  download={file.name || ''}
                  aria-label="Download file"
                  title="Download file"
                >
                  <DownloadIcon />
                </a>
              ) : null}
            </div>
          </div>
        </div>
        <div className="explorer-viewer-body">
          {file.kind === 'markdown' ? (
            <ExplorerMarkdownPreview
              file={file}
              onImageOpen={setImageViewerIndex}
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
      <PageImageLightbox
        images={file.images}
        activeIndex={imageViewerIndex}
        onClose={() => setImageViewerIndex(null)}
        onIndexChange={setImageViewerIndex}
      />
    </>
  );
}

function ExplorerMarkdownPreview({ file, onImageOpen, onRelativeLinkClick, emptyLabel }) {
  const sourceSlug = file.path?.replace(/\.(?:md|markdown)$/i, '') || '';
  const fallback = useMemo(() => splitMarkdownFrontmatter(file.text || ''), [file.text]);
  const markdown = typeof file.markdown === 'string' ? file.markdown : fallback.body;
  return (
    <PageContentPreview
      markdown={markdown}
      title={file.title || ''}
      type={file.type || sourceSlug.split('/')[0]}
      sourceSlug={sourceSlug}
      frontmatter={file.frontmatter}
      images={file.images}
      onImageOpen={onImageOpen}
      onRelativeLinkClick={onRelativeLinkClick}
      className="explorer-page-preview"
      emptyLabel={emptyLabel}
    />
  );
}

function splitMarkdownFrontmatter(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  if (!text.startsWith('---\n')) {
    return { body: text, frontmatter: '' };
  }
  const end = text.indexOf('\n---', 4);
  if (end < 0) {
    return { body: text, frontmatter: '' };
  }
  const frontmatter = text.slice(4, end).trim();
  const bodyStart = text[end + 4] === '\n' ? end + 5 : end + 4;
  return {
    body: text.slice(bodyStart).replace(/^\n+/, ''),
    frontmatter,
  };
}

async function copyTextToClipboard(value) {
  let clipboardError = null;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  try {
    document.body.appendChild(textarea);
    textarea.select();
    if (!document.execCommand('copy')) {
      throw clipboardError || new Error('Clipboard copy is unavailable');
    }
  } catch (error) {
    throw clipboardError || error;
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

function formatRecentFileTitle(file) {
  const source = String(file?.path || file?.name || '').split('/').pop() || 'Untitled';
  const slug = source.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  if (!slug) return 'Untitled';
  return slug
    .split(/\s+/)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
    .join(' ');
}

function formatRelativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const elapsedMs = Date.now() - timestamp;
  const isFuture = elapsedMs < 0;
  const absoluteMs = Math.abs(elapsedMs);
  if (absoluteMs < 45 * 1000) return isFuture ? 'in a few seconds' : 'just now';
  const units = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ];
  for (const [unit, unitMs] of units) {
    const count = Math.round(absoluteMs / unitMs);
    if (count >= 1) {
      return isFuture
        ? `in ${count} ${unit}${count === 1 ? '' : 's'}`
        : `${count} ${unit}${count === 1 ? '' : 's'} ago`;
    }
  }
  return '';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function dayKeyFromTimestamp(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatActivityDate(dayKey) {
  if (!dayKey) return 'No date';
  const timestamp = Date.parse(`${dayKey}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return dayKey;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp));
}

function labelFromSlug(slug) {
  const leaf = String(slug || '').split('/').filter(Boolean).pop() || '';
  return leaf
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function graphFlowInputTargets(item) {
  if (Array.isArray(item?.target_pages)) return item.target_pages.filter((target) => target?.slug);
  const slug = item?.page_slug || item?.slug;
  return slug ? [{ slug, title: item?.title || labelFromSlug(slug) }] : [];
}

const GRAPH_FLOW_SOURCE_ICONS = {
  assistant_chat: MessagesSquare,
  whatsapp: MessageCircle,
  gmail: Mail,
  substack: BookOpen,
  youtube: Youtube,
  google_calendar: CalendarDays,
  calendar: CalendarDays,
  granola: AudioLines,
  rss: Rss,
  webhook: Webhook,
  cli: Terminal,
  direct_edit: FilePenLine,
  slack: Slack,
  unknown: CircleHelp,
};

const GRAPH_FLOW_SOURCE_LABELS = {
  assistant_chat: 'Assistant chat',
  whatsapp: 'WhatsApp',
  gmail: 'Gmail',
  substack: 'Substack',
  youtube: 'YouTube',
  google_calendar: 'Google Calendar',
  calendar: 'Calendar',
  granola: 'Granola',
  rss: 'RSS',
  webhook: 'Webhook',
  cli: 'CLI',
  direct_edit: 'Direct edit',
  slack: 'Slack',
  unknown: 'Unknown source',
};

function graphFlowSourceType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return GRAPH_FLOW_SOURCE_ICONS[normalized] ? normalized : 'unknown';
}

function graphFlowInputSourceType(item) {
  const source = item?.demo_input ? item.input_source : item?.source;
  return graphFlowSourceType(source?.type);
}

function graphFlowSourceLabel(value) {
  const normalized = graphFlowSourceType(value);
  return GRAPH_FLOW_SOURCE_LABELS[normalized] || GRAPH_FLOW_SOURCE_LABELS.unknown;
}

function graphFlowInputTimestamp(input) {
  for (const value of [input?.received_at, input?.occurred_at]) {
    const timestamp = Date.parse(value || '');
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.NEGATIVE_INFINITY;
}

function formatGraphFlowTargetCount(item) {
  const count = graphFlowInputTargets(item).length;
  return `${count} ${count === 1 ? 'page' : 'pages'}`;
}

function buildActivityBuckets(nodes, activity = []) {
  if (Array.isArray(activity) && activity.length) return activity;
  const counts = new Map();
  for (const node of nodes) {
    const day = dayKeyFromTimestamp(node.updated_at);
    if (!day) continue;
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((left, right) => left.day.localeCompare(right.day));
}

function resolveActivityIndex(value, buckets) {
  if (!buckets.length) return -1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return buckets.length - 1;
  return clamp(Math.round(numeric), 0, buckets.length - 1);
}

function buildActivitySeries(buckets) {
  let cumulative = 0;
  return buckets.map((bucket) => {
    const count = Math.max(0, Number(bucket.count) || 0);
    cumulative += count;
    return { ...bucket, count, cumulative };
  });
}

const FOCUSED_VIEW_MODES = ['network', 'timeline', 'subgraph'];
const FOCUSED_VIEW_LABELS = {
  network: 'Focused network',
  timeline: 'Focused timeline',
  subgraph: 'Focused subgraph',
};

function nextFocusedViewMode(mode) {
  const index = FOCUSED_VIEW_MODES.indexOf(mode);
  return FOCUSED_VIEW_MODES[(index + 1) % FOCUSED_VIEW_MODES.length];
}

function buildFocusedTimelineUpdates(lineage, graph) {
  const focusSlug = normalizeFocusedGraphSlug(lineage?.slug);
  const updates = (Array.isArray(lineage?.timeline_updates) ? lineage.timeline_updates : [])
    .filter((update) => normalizeFocusedGraphSlug(update?.page?.slug) === focusSlug);
  if (updates.length) return updates;
  if (!lineage || lineage.status !== 'ready' || !focusSlug) return [];
  const focusedNode = (Array.isArray(graph?.nodes) ? graph.nodes : [])
    .find((node) => normalizeFocusedGraphSlug(node?.slug) === focusSlug && node.latest_timeline_entry);
  return focusedNode ? [{
    entry_id: `latest:${focusedNode.slug}`,
    page: { slug: focusedNode.slug, title: focusedNode.title, type: focusedNode.type },
    occurred_at: focusedNode.updated_at || focusedNode.created_at || null,
    occurred_label: null,
    recorded_at: null,
    text: focusedNode.latest_timeline_entry,
    significance: null,
    provenance: null,
  }] : [];
}

function activityModeLabel(mode) {
  return GRAPH_ACTIVITY_MODES.find((item) => item.id === mode)?.label || GRAPH_ACTIVITY_MODES[0].label;
}

function isCumulativeActivityMode(mode) {
  return mode.startsWith('cumulative-');
}

function isLineActivityMode(mode) {
  return mode.endsWith('-line') || mode === 'line';
}

function activityPointX(index, length) {
  if (length <= 1) return 50;
  return (index / (length - 1)) * 100;
}

function activityPointY(value, maxValue) {
  return 92 - ((value / Math.max(maxValue, 1)) * 78);
}

function activityLinePath(series, mode, maxValue) {
  const valueKey = isCumulativeActivityMode(mode) ? 'cumulative' : 'count';
  return series
    .map((item, index) => `${index === 0 ? 'M' : 'L'} ${activityPointX(index, series.length).toFixed(3)} ${activityPointY(item[valueKey], maxValue).toFixed(3)}`)
    .join(' ');
}

const GraphPanel = memo(function GraphPanel({
  graph,
  motionEvent,
  demoMode,
  demoSeed,
  visualizerId,
  setVisualizerId,
  nodeShape,
  setNodeShape,
  nodeFill,
  setNodeFill,
  nodeIcon,
  setNodeIcon,
  nodeSize,
  setNodeSize,
  nodeSizeMode,
  setNodeSizeMode,
  arcStyle,
  setArcStyle,
  arcAnimation,
  setArcAnimation,
  layoutStyle,
  labelStyle,
  setLabelStyle,
  colorMode,
  setColorMode,
  colorPaletteId,
  setColorPaletteId,
  typeColors,
  setTypeColors,
  flowVisible,
  setFlowVisible,
  autoRotate,
  setAutoRotate,
  flowTasks,
  visualizerRef,
  shortcutsEnabled,
  activeSlug,
  initialDomains = [],
  onDomainScopeChange,
  onActiveSlugChange,
  onNodeOpen,
  onGraphNodeSelect,
  lineage,
  onLineageClose,
}) {
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [domainMenuOpen, setDomainMenuOpen] = useState(false);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [activityMode, setActivityMode] = useState('bars');
  const [focusedViewMode, setFocusedViewMode] = useState('network');
  const wasFocusedRef = useRef(false);
  const previousForceSubgraphFocusRef = useRef(null);
  const [selectedPageTypes, setSelectedPageTypes] = useState([]);
  const [selectedDomains, setSelectedDomains] = useState(initialDomains);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const styleMenuRef = useRef(null);
  const filterMenuRef = useRef(null);
  const domainMenuRef = useRef(null);
  const collectionMenuRef = useRef(null);
  const activityPlotRef = useRef(null);
  const activityDraggingRef = useRef(false);
  const visualizer = graphVisualizers.find((item) => item.id === visualizerId) || graphVisualizers[0];
  const VisualizerComponent = visualizer.Component;
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const focusSlug = normalizeFocusedGraphSlug(lineage?.slug);
  const focusGraph = useMemo(() => buildFocusedNetworkGraph(graph, lineage, focusSlug), [focusSlug, graph, lineage]);
  const focusedSubgraph = useMemo(() => buildFocusedSubgraphGraph(graph, lineage, focusSlug), [focusSlug, graph, lineage]);
  const focusedNetworkStats = useMemo(() => {
    const nodes = Array.isArray(focusGraph?.nodes) ? focusGraph.nodes : [];
    return {
      direct: nodes.filter((node) => Number(node.focus_hop) === 1).length,
      extended: nodes.filter((node) => Number(node.focus_hop) > 1).length,
    };
  }, [focusGraph]);
  const activeGraph = focusSlug ? focusGraph : graph;
  const activeGraphNodes = Array.isArray(activeGraph?.nodes) ? activeGraph.nodes : [];
  const activityBuckets = useMemo(() => (
    focusSlug ? [] : buildActivityBuckets(graphNodes, graph?.activity)
  ), [focusSlug, graph?.activity, graphNodes]);
  const [activityIndex, setActivityIndex] = useState(-1);
  const [eligibleMotionEvent, setEligibleMotionEvent] = useState(null);
  const consumedMotionEventRef = useRef(null);
  const latestActivityIndex = activityBuckets.length - 1;
  const resolvedActivityIndex = resolveActivityIndex(activityIndex < 0 ? latestActivityIndex : activityIndex, activityBuckets);
  const selectedActivityBucket = resolvedActivityIndex >= 0 ? activityBuckets[resolvedActivityIndex] : null;
  const selectedActivityDay = selectedActivityBucket?.day || null;

  useEffect(() => {
    if (!motionEvent || consumedMotionEventRef.current === motionEvent) return;
    if (activityIndex >= 0 || focusSlug) return;
    consumedMotionEventRef.current = motionEvent;
    setEligibleMotionEvent(motionEvent);
  }, [activeSlug, activityIndex, focusSlug, motionEvent]);

  useEffect(() => {
    setEligibleMotionEvent(null);
  }, [visualizerId]);
  const activityFilteredNodes = useMemo(() => {
    if (!selectedActivityDay) return activeGraphNodes;
    return activeGraphNodes.filter((node) => {
      const day = dayKeyFromTimestamp(node.lineage_at || node.created_at || node.updated_at);
      return !day || day <= selectedActivityDay;
    });
  }, [activeGraphNodes, selectedActivityDay]);
  const presentTypes = new Set(activeGraphNodes.map((node) => node.type));
  const pageTypes = [
    ...TYPE_ORDER.filter((type) => presentTypes.has(type)),
    ...[...presentTypes].filter((type) => !TYPE_ORDER.includes(type)).sort(),
  ];
  const presentDomains = new Set(activeGraphNodes.flatMap((node) => graphNodeDomains(node)));
  const domains = [...presentDomains].sort((left, right) => left.localeCompare(right));
  const domainLabels = useMemo(() => new Map(
    (Array.isArray(graph?.meta?.domain_definitions) ? graph.meta.domain_definitions : [])
      .filter((domain) => domain?.id)
      .map((domain) => [domain.id, domain.name || domain.id]),
  ), [graph?.meta?.domain_definitions]);
  const collections = Array.isArray(graph?.meta?.collection_definitions) ? graph.meta.collection_definitions : [];
  const selectedCollection = collections.find((collection) => collection.id === selectedCollectionId);
  const selectedCollectionSlugs = useMemo(() => (
    selectedCollectionId ? new Set(selectedCollection?.page_slugs || []) : null
  ), [selectedCollectionId, selectedCollection]);
  const selectedTypeSet = useMemo(() => new Set(selectedPageTypes), [selectedPageTypes]);
  const selectedDomainSet = useMemo(() => new Set(selectedDomains), [selectedDomains]);

  useEffect(() => {
    setSelectedDomains((current) => current.join('|') === initialDomains.join('|') ? current : initialDomains);
  }, [initialDomains]);

  useEffect(() => {
    onDomainScopeChange?.(selectedDomains);
  }, [onDomainScopeChange, selectedDomains]);

  const filteredGraph = useMemo(() => {
    const nodes = selectedPageTypes.length || selectedDomains.length || selectedCollectionSlugs !== null
      ? activityFilteredNodes.filter((node) => graphNodeMatchesFilters(node, selectedTypeSet, selectedDomainSet, selectedCollectionSlugs))
      : activityFilteredNodes;
    const slugs = new Set(nodes.map((node) => node.slug));
    const edges = (Array.isArray(activeGraph?.edges) ? activeGraph.edges : []).filter((edge) => {
      return slugs.has(edge.source) && slugs.has(edge.target);
    });

    return {
      ...activeGraph,
      nodes,
      edges,
      meta: {
        ...graph?.meta,
        page_count: nodes.length,
        edge_count: edges.length,
      },
    };
  }, [activeGraph, activityFilteredNodes, selectedDomains.length, selectedDomainSet, selectedPageTypes.length, selectedTypeSet, selectedCollectionSlugs]);
  const filteredSubgraph = useMemo(() => {
    if (!focusSlug) return focusedSubgraph;
    const sourceNodes = Array.isArray(focusedSubgraph?.nodes) ? focusedSubgraph.nodes : [];
    const nodes = selectedPageTypes.length || selectedDomains.length || selectedCollectionSlugs !== null
      ? sourceNodes.filter((node) => graphNodeMatchesFilters(node, selectedTypeSet, selectedDomainSet, selectedCollectionSlugs))
      : sourceNodes;
    if (focusSlug && nodes.every((node) => node.slug !== focusSlug)) {
      const focusedNode = sourceNodes.find((node) => node.slug === focusSlug);
      if (focusedNode) nodes.unshift(focusedNode);
    }
    const slugs = new Set(nodes.map((node) => node.slug));
    const edges = (Array.isArray(focusedSubgraph?.edges) ? focusedSubgraph.edges : []).filter((edge) => {
      return slugs.has(edge.source) && slugs.has(edge.target);
    });
    return {
      ...focusedSubgraph,
      nodes,
      edges,
      meta: {
        ...graph?.meta,
        page_count: nodes.length,
        edge_count: edges.length,
      },
    };
  }, [focusSlug, focusedSubgraph, graph?.meta, selectedDomains.length, selectedDomainSet, selectedPageTypes.length, selectedTypeSet, selectedCollectionSlugs]);
  const forceGraph = useMemo(() => {
    const forceSourceGraph = focusSlug ? focusGraph : graph;
    const forceSourceNodes = activityFilteredNodes;
    const nodes = selectedPageTypes.length || selectedDomains.length || selectedCollectionSlugs !== null
      ? forceSourceNodes.filter((node) => graphNodeMatchesFilters(node, selectedTypeSet, selectedDomainSet, selectedCollectionSlugs))
      : forceSourceNodes;
    const slugs = new Set(nodes.map((node) => node.slug));
    const edges = (Array.isArray(forceSourceGraph?.edges) ? forceSourceGraph.edges : []).filter((edge) => {
      return slugs.has(edge.source) && slugs.has(edge.target);
    });
    return {
      ...forceSourceGraph,
      nodes,
      edges,
      meta: {
        ...graph?.meta,
        page_count: nodes.length,
        edge_count: edges.length,
      },
    };
  }, [activityFilteredNodes, focusGraph, focusSlug, graph, selectedDomains.length, selectedDomainSet, selectedPageTypes.length, selectedTypeSet, selectedCollectionSlugs]);
  const recentNodes = useMemo(() => {
    const nodes = Array.isArray(filteredGraph?.nodes) ? filteredGraph.nodes : [];
    return [...nodes]
      .filter((node) => Number.isFinite(Date.parse(node.updated_at)))
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
      .slice(0, 6);
  }, [filteredGraph]);
  const flowInputs = useMemo(() => (
    demoMode
      ? buildDemoGraphFlowInputs(recentNodes, demoSeed)
      : (Array.isArray(filteredGraph?.inputs) ? filteredGraph.inputs : [])
        .map((item) => ({ ...item, target_pages: graphFlowInputTargets(item) }))
        .filter((item) => (
          selectedTypeSet.size === 0 && selectedDomainSet.size === 0 && selectedCollectionSlugs === null
            ? true
            : item.target_pages.some((target) => graphNodeMatchesFilters(
              filteredGraph.nodes?.find((node) => node.slug === target.slug),
              selectedTypeSet,
              selectedDomainSet,
              selectedCollectionSlugs,
            ))
        ))
        .sort((left, right) => {
          const leftTime = graphFlowInputTimestamp(left);
          const rightTime = graphFlowInputTimestamp(right);
          return rightTime - leftTime || String(right.event_id || '').localeCompare(String(left.event_id || ''));
        })
  ), [demoMode, demoSeed, filteredGraph, recentNodes, selectedDomainSet, selectedTypeSet, selectedCollectionSlugs]);
  const activitySeries = useMemo(() => buildActivitySeries(activityBuckets), [activityBuckets]);
  const focusedTimelineUpdates = useMemo(() => buildFocusedTimelineUpdates(lineage, filteredGraph), [filteredGraph, lineage]);
  const activityValueKey = isCumulativeActivityMode(activityMode) ? 'cumulative' : 'count';
  const activityMaxValue = useMemo(() => Math.max(...activitySeries.map((item) => item[activityValueKey]), 1), [activitySeries, activityValueKey]);
  const isForceRenderer = visualizerId === 'force-graph-3d' || visualizerId === 'force-graph-2d';
  const effectiveLabelStyle = focusSlug ? labelStyle : 'off';
  const visibleControls = Array.isArray(visualizer.controls)
    ? visualizer.controls.filter((control) => control === 'resetView')
    : [];

  useEffect(() => {
    setActivityIndex(-1);
  }, [focusSlug, graph]);

  useEffect(() => {
    setFocusedViewMode(focusSlug ? 'subgraph' : 'network');
  }, [focusSlug]);

  useEffect(() => {
    if (focusSlug && focusedViewMode === 'subgraph') setLabelStyle('all');
    else if (!focusSlug && wasFocusedRef.current) setLabelStyle('off');
    wasFocusedRef.current = Boolean(focusSlug);
  }, [focusSlug, focusedViewMode, setLabelStyle]);

  useEffect(() => {
    if (!focusSlug) return undefined;
    function handleFocusedViewKeyDown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() !== 't') return;
      event.preventDefault();
      setFocusedViewMode((current) => nextFocusedViewMode(current));
    }

    window.addEventListener('keydown', handleFocusedViewKeyDown);
    return () => window.removeEventListener('keydown', handleFocusedViewKeyDown);
  }, [focusSlug]);

  useEffect(() => {
    if (!focusSlug || !isForceRenderer || focusedViewMode !== 'subgraph') {
      previousForceSubgraphFocusRef.current = null;
      return undefined;
    }
    const walking = Boolean(previousForceSubgraphFocusRef.current);
    previousForceSubgraphFocusRef.current = focusSlug;
    // A clicked node already animates the camera. Refitting here would snap
    // the retained graph before its membership transition can be seen.
    if (walking) return undefined;
    let frame = 0;
    let settleFrame = 0;
    frame = window.requestAnimationFrame(() => {
      settleFrame = window.requestAnimationFrame(() => {
        visualizerRef.current?.focusNode?.(focusSlug);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
    };
  }, [focusSlug, focusedViewMode, isForceRenderer]);

  useEffect(() => {
    if (!styleMenuOpen && !filterMenuOpen && !domainMenuOpen && !collectionMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (styleMenuRef.current && !styleMenuRef.current.contains(event.target)) {
        setStyleMenuOpen(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
        setFilterMenuOpen(false);
      }
      if (domainMenuRef.current && !domainMenuRef.current.contains(event.target)) {
        setDomainMenuOpen(false);
      }
      if (collectionMenuRef.current && !collectionMenuRef.current.contains(event.target)) {
        setCollectionMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setStyleMenuOpen(false);
        setFilterMenuOpen(false);
        setDomainMenuOpen(false);
        setCollectionMenuOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [styleMenuOpen, filterMenuOpen, domainMenuOpen, collectionMenuOpen]);

  function togglePageType(type) {
    setSelectedPageTypes((current) => (
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type]
    ));
  }

  function selectColorPalette(nextPaletteId) {
    setColorPaletteId(nextPaletteId);
    if (nextPaletteId !== 'custom') {
      setTypeColors(sanitizeGraphTypeColors(getGraphColorPalette(nextPaletteId)));
    }
  }

  const graphStyleKeyDownRef = useRef(null);
  // Keep the window listener attached while refreshing the values it reads.
  graphStyleKeyDownRef.current = (event) => {
    if (!shortcutsEnabled || event.defaultPrevented || event.repeat || event.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTypingTarget(event.target)) return;
    if (document.querySelector('[role="dialog"], [role="listbox"], .graph-flow-source-filter-menu')) return;
    const key = event.key.toLowerCase();
    if (key === 'd') {
      setSelectedDomains((current) => nextGraphDomainFilter(current, domains));
    } else if (key === 'c') {
      setColorMode((current) => nextGraphStyleOption(current, GRAPH_COLOR_MODES));
    } else if (key === 'p') {
      selectColorPalette(nextGraphStyleOption(colorPaletteId, GRAPH_COLOR_PALETTE_OPTIONS));
    } else if (key === 'r' && visualizerId === 'force-graph-3d') {
      setAutoRotate((current) => !current);
    } else if (key === 's') {
      setNodeSizeMode((current) => nextGraphStyleOption(current, GRAPH_NODE_SIZE_MODES));
    } else if (key === 'l') {
      setLabelStyle((current) => nextGraphStyleOption(current, GRAPH_LABEL_STYLES));
    } else if (key === 'f') {
      setFlowVisible((current) => !current);
    } else {
      return;
    }
    event.preventDefault();
  };

  useEffect(() => {
    const handleKeyDown = (event) => graphStyleKeyDownRef.current?.(event);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function updateTypeColor(type, value) {
    if (!isGraphHexColor(value)) return;
    setColorPaletteId('custom');
    setTypeColors((current) => ({ ...current, [type]: value.toUpperCase() }));
  }

  function seekActivityFromPointer(event) {
    const plot = activityPlotRef.current;
    if (!plot || !activitySeries.length) return;
    const bounds = plot.getBoundingClientRect();
    const ratio = bounds.width ? clamp((event.clientX - bounds.left) / bounds.width, 0, 1) : 0;
    setActivityIndex(Math.round(ratio * Math.max(activitySeries.length - 1, 0)));
  }

  function handleActivityPointerDown(event) {
    activityDraggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekActivityFromPointer(event);
  }

  function handleActivityPointerMove(event) {
    if (activityDraggingRef.current) seekActivityFromPointer(event);
  }

  function handleActivityPointerUp(event) {
    if (!activityDraggingRef.current) return;
    seekActivityFromPointer(event);
    activityDraggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleActivityKeyDown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setActivityIndex((value) => resolveActivityIndex(value - 1, activityBuckets));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActivityIndex((value) => resolveActivityIndex(value + 1, activityBuckets));
    }
  }

  return (
    <section className="card hero-card">
      {focusSlug ? (
        <div className="graph-focus-banner" aria-live="polite">
          <div className="graph-focus-copy">
            <span>{FOCUSED_VIEW_LABELS[focusedViewMode]}</span>
            <strong>{focusGraph?.nodes?.find((node) => node.slug === focusSlug)?.title || labelFromSlug(focusSlug)}</strong>
            <small>
              {lineage?.status === 'loading'
                ? 'Reconstructing related pages…'
                : lineage?.status === 'error'
                  ? (lineage.message || 'History unavailable')
                  : `${focusedNetworkStats.direct} direct · ${focusedNetworkStats.extended} second-hop · ${FOCUSED_NETWORK_MAX_HOPS} hops`}
            </small>
          </div>
          <div className="graph-focus-mode-toggle" role="group" aria-label="Focused view">
            <button
              type="button"
              className={`graph-focus-mode-button ${focusedViewMode === 'network' ? 'active' : ''}`}
              aria-pressed={focusedViewMode === 'network'}
              onClick={() => setFocusedViewMode('network')}
            >
              Network
            </button>
            <button
              type="button"
              className={`graph-focus-mode-button ${focusedViewMode === 'timeline' ? 'active' : ''}`}
              aria-pressed={focusedViewMode === 'timeline'}
              onClick={() => setFocusedViewMode('timeline')}
            >
              Timeline
            </button>
            <button
              type="button"
              className={`graph-focus-mode-button ${focusedViewMode === 'subgraph' ? 'active' : ''}`}
              aria-pressed={focusedViewMode === 'subgraph'}
              onClick={() => setFocusedViewMode('subgraph')}
            >
              Subgraph <kbd className="settings-shortcut">T</kbd>
            </button>
          </div>
          <button type="button" className="graph-focus-close" onClick={onLineageClose}>
            Full graph
          </button>
        </div>
      ) : null}
      <div className={`graph-wrap graph-wrap-expanded ${flowVisible ? 'graph-flow-enabled' : ''} ${focusSlug ? 'graph-wrap-focused' : ''}`}>
        <div className={focusSlug ? 'focused-view-stage' : 'graph-canvas-stage'}>
          {focusSlug ? (
            focusedViewMode === 'timeline' ? (
              <FocusedTimelineView
                lineage={lineage}
                updates={focusedTimelineUpdates}
                onNodeOpen={onGraphNodeSelect}
              />
            ) : focusedViewMode === 'subgraph' ? (
              <VisualizerComponent
                ref={visualizerRef}
                key="focused-subgraph"
                graph={filteredSubgraph}
                fitOnGraphChange={isForceRenderer}
                activityDay={null}
                motionEvent={null}
                onNodeOpen={onGraphNodeSelect}
                nodeShape={nodeShape}
                nodeFill={nodeFill}
                nodeIcon={nodeIcon}
                nodeSize={nodeSize}
                nodeSizeMode={nodeSizeMode}
                arcStyle={arcStyle}
                arcAnimation={arcAnimation}
                layoutStyle={layoutStyle}
                labelStyle={effectiveLabelStyle}
                colorMode={colorMode}
                typeColors={typeColors}
                autoRotate={autoRotate}
                activeSlug={activeSlug}
                onActiveSlugChange={onActiveSlugChange}
              />
            ) : (
              <FocusedNetworkVisualizer
                graph={filteredGraph}
                focusSlug={focusSlug}
                onNodeOpen={onGraphNodeSelect}
                colorMode={colorMode}
                typeColors={typeColors}
              />
            )
          ) : (
            <VisualizerComponent
              ref={visualizerRef}
              key="full-graph"
              graph={isForceRenderer ? forceGraph : filteredGraph}
              activityDay={isForceRenderer ? selectedActivityDay : null}
              motionEvent={eligibleMotionEvent}
              onNodeOpen={onGraphNodeSelect}
              nodeShape={nodeShape}
              nodeFill={nodeFill}
              nodeIcon={nodeIcon}
              nodeSize={nodeSize}
              nodeSizeMode={nodeSizeMode}
              arcStyle={arcStyle}
              arcAnimation={arcAnimation}
              layoutStyle={layoutStyle}
              labelStyle={effectiveLabelStyle}
              colorMode={colorMode}
              typeColors={typeColors}
              autoRotate={autoRotate}
              activeSlug={activeSlug}
              onActiveSlugChange={onActiveSlugChange}
              onBackgroundClick={onLineageClose}
            />
          )}
        </div>
        {flowVisible && !focusSlug ? (
          <GraphFlowOverlay
            inputs={flowInputs}
            tasks={flowTasks}
            onNodeOpen={onNodeOpen}
          />
        ) : null}
        {activityBuckets.length > 0 && !focusSlug ? (
          <div className={`graph-activity-panel ${flowVisible ? 'graph-flow-sibling-hidden' : ''}`}>
            <div className="graph-activity-head">
              <span>Activity</span>
              <strong>{formatActivityDate(selectedActivityDay)}</strong>
              <button
                type="button"
                className="graph-activity-mode"
                aria-label={`Cycle activity chart, currently ${activityModeLabel(activityMode)}`}
                onClick={() => {
                  const currentIndex = GRAPH_ACTIVITY_MODES.findIndex((item) => item.id === activityMode);
                  setActivityMode(GRAPH_ACTIVITY_MODES[(currentIndex + 1) % GRAPH_ACTIVITY_MODES.length].id);
                }}
              >
                {activityModeLabel(activityMode)}
              </button>
            </div>
            <div
              ref={activityPlotRef}
              className={`graph-activity-plot graph-activity-${activityMode}`}
              role="slider"
              tabIndex="0"
              aria-label="Graph date"
              aria-valuemin="0"
              aria-valuemax={Math.max(activityBuckets.length - 1, 0)}
              aria-valuenow={Math.max(resolvedActivityIndex, 0)}
              aria-valuetext={formatActivityDate(selectedActivityDay)}
              onKeyDown={handleActivityKeyDown}
              onPointerDown={handleActivityPointerDown}
              onPointerMove={handleActivityPointerMove}
              onPointerUp={handleActivityPointerUp}
              onPointerCancel={handleActivityPointerUp}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {isLineActivityMode(activityMode) ? (
                  <path className="graph-activity-line" d={activityLinePath(activitySeries, activityMode, activityMaxValue)} />
                ) : activitySeries.map((item, index) => {
                  const value = item[activityValueKey];
                  const width = 100 / activitySeries.length;
                  const height = (value / Math.max(activityMaxValue, 1)) * 78;
                  return (
                    <rect
                      key={item.day}
                      className={`graph-activity-bar ${index <= resolvedActivityIndex ? 'active' : ''}`}
                      x={index * width + width * 0.18}
                      y={92 - height}
                      width={Math.max(width * 0.64, 0.35)}
                      height={height}
                      rx="0.8"
                    />
                  );
                })}
                <line className="graph-activity-cursor" x1={activityPointX(resolvedActivityIndex, activitySeries.length)} x2={activityPointX(resolvedActivityIndex, activitySeries.length)} y1="4" y2="96" />
                <circle className="graph-activity-point" cx={activityPointX(resolvedActivityIndex, activitySeries.length)} cy={activityPointY(activitySeries[resolvedActivityIndex]?.[activityValueKey] || 0, activityMaxValue)} r="1.6" />
              </svg>
            </div>
          </div>
        ) : null}
      </div>
      <div className="graph-footer">
        <div>
          <div className="graph-stats">
            <span className="graph-stat"><strong>{Number.isFinite(filteredGraph?.meta?.page_count) ? filteredGraph.meta.page_count : 0}</strong> pages</span>
            <span className="graph-stat"><strong>{Number.isFinite(filteredGraph?.meta?.edge_count) ? filteredGraph.meta.edge_count : 0}</strong> edges</span>
            <div className="graph-scope-menu-shell" ref={domainMenuRef}>
              <button
                type="button"
                className={`graph-button graph-scope-trigger ${domainMenuOpen ? 'graph-button-active' : ''}`}
                aria-haspopup="menu"
                aria-expanded={domainMenuOpen}
                onClick={() => {
                  setCollectionMenuOpen(false);
                  setFilterMenuOpen(false);
                  setStyleMenuOpen(false);
                  setDomainMenuOpen((open) => !open);
                }}
              >
                <span className="graph-scope-label">{selectedDomains.length ? domainLabels.get(selectedDomains[0]) || selectedDomains[0] : 'All domains'}</span>
                <kbd className="settings-shortcut">D</kbd>
              </button>
              {domainMenuOpen ? (
                <div className="graph-filter-menu graph-scope-menu" role="menu" aria-label="Domain scope">
                  <button type="button" className={`menu-item ${selectedDomains.length === 0 ? 'selected' : ''}`} role="menuitemradio" aria-checked={selectedDomains.length === 0} onClick={() => { setSelectedDomains([]); setDomainMenuOpen(false); }}><span>All domains</span><span className="menu-item-check" aria-hidden="true">{selectedDomains.length === 0 ? '✓' : ''}</span></button>
                  {domains.map((domain) => (
                    <button key={domain} type="button" className={`menu-item ${selectedDomainSet.has(domain) ? 'selected' : ''}`} role="menuitemradio" aria-checked={selectedDomainSet.has(domain)} onClick={() => { setSelectedDomains([domain]); setDomainMenuOpen(false); }}>
                      <span>{domainLabels.get(domain) || domain}</span><span className="menu-item-check" aria-hidden="true">{selectedDomainSet.has(domain) ? '✓' : ''}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="graph-scope-menu-shell" ref={collectionMenuRef}>
              <button
                type="button"
                className={`graph-button graph-scope-trigger ${collectionMenuOpen ? 'graph-button-active' : ''}`}
                aria-haspopup="menu"
                aria-expanded={collectionMenuOpen}
                onClick={() => {
                  setDomainMenuOpen(false);
                  setFilterMenuOpen(false);
                  setStyleMenuOpen(false);
                  setCollectionMenuOpen((open) => !open);
                }}
              >
                <span className="graph-scope-label">{selectedCollection?.title || 'All collections'}</span>
              </button>
              {collectionMenuOpen ? (
                <div className="graph-filter-menu graph-scope-menu" role="menu" aria-label="Collection scope">
                  <button type="button" className={`menu-item ${selectedCollectionId === null ? 'selected' : ''}`} role="menuitemradio" aria-checked={selectedCollectionId === null} onClick={() => { setSelectedCollectionId(null); setCollectionMenuOpen(false); }}><span>All collections</span><span className="menu-item-check" aria-hidden="true">{selectedCollectionId === null ? '✓' : ''}</span></button>
                  {collections.map((collection) => (
                    <button key={collection.id} type="button" className={`menu-item ${selectedCollectionId === collection.id ? 'selected' : ''}`} role="menuitemradio" aria-checked={selectedCollectionId === collection.id} onClick={() => { setSelectedCollectionId(collection.id); setCollectionMenuOpen(false); }}>
                      <span>{collection.title}</span><span className="menu-item-check" aria-hidden="true">{selectedCollectionId === collection.id ? '✓' : ''}</span>
                    </button>
                  ))}
                  {collections.length === 0 ? <div className="graph-scope-empty" aria-disabled="true">No collections yet</div> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="graph-toolbar">
          <div className="graph-filter-menu-shell" ref={filterMenuRef}>
            <button
              type="button"
              className={`icon-button graph-icon-button ${filterMenuOpen ? 'graph-button-active' : ''}`}
              aria-label="Filter graph"
              title="Filter page types"
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
                <div className="graph-filter-group">
                  <span className="graph-filter-group-label">Page types</span>
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
                  label="Node shape"
                  value={nodeShape}
                  options={GRAPH_NODE_SHAPES}
                  onSelect={setNodeShape}
                />
                <GraphStyleOptionGroup
                  label="Node fill"
                  value={nodeFill}
                  options={GRAPH_NODE_FILLS}
                  onSelect={setNodeFill}
                />
                <GraphStyleOptionGroup
                  label="Node icon"
                  value={nodeIcon}
                  options={GRAPH_NODE_ICONS}
                  onSelect={setNodeIcon}
                />
                <GraphStyleOptionGroup
                  label="Base size"
                  value={nodeSize}
                  options={GRAPH_NODE_SIZES}
                  onSelect={setNodeSize}
                />
                <GraphStyleOptionGroup
                  label="Size scaling"
                  shortcut="s"
                  value={nodeSizeMode}
                  options={GRAPH_NODE_SIZE_MODES}
                  onSelect={setNodeSizeMode}
                />
                <GraphStyleOptionGroup
                  label="Arc"
                  value={arcStyle}
                  options={GRAPH_ARC_STYLES}
                  onSelect={setArcStyle}
                />
                <GraphStyleOptionGroup
                  label="Arc animation"
                  value={arcAnimation}
                  options={GRAPH_ARC_ANIMATIONS}
                  onSelect={setArcAnimation}
                />
                <GraphStyleOptionGroup
                  label="Labels"
                  shortcut="l"
                  value={labelStyle}
                  options={GRAPH_LABEL_STYLES}
                  onSelect={setLabelStyle}
                />
                <GraphStyleOptionGroup
                  label="Flow context"
                  shortcut="f"
                  value={flowVisible ? 'visible' : 'hidden'}
                  options={GRAPH_FLOW_VISIBILITY_OPTIONS}
                  onSelect={(value) => setFlowVisible(value === 'visible')}
                />
                <GraphStyleOptionGroup
                  label="Auto rotation"
                  shortcut="r"
                  value={autoRotate ? 'on' : 'off'}
                  options={GRAPH_AUTO_ROTATION_OPTIONS}
                  onSelect={(value) => setAutoRotate(value === 'on')}
                  disabled={visualizerId !== 'force-graph-3d'}
                />
                <GraphStyleOptionGroup
                  label="Palette"
                  shortcut="p"
                  value={colorPaletteId}
                  options={GRAPH_COLOR_PALETTE_OPTIONS}
                  onSelect={selectColorPalette}
                />
                <GraphStyleOptionGroup
                  label="Color"
                  shortcut="c"
                  value={colorMode}
                  options={GRAPH_COLOR_MODES}
                  onSelect={setColorMode}
                />
                {colorMode === 'domain' ? (
                  <div className="graph-menu-field">
                    <span>Domain colors</span>
                    <div className="graph-type-color-grid">
                      {domains.map((domain) => (
                        <div key={domain} className="graph-type-color-row">
                          <span className="graph-type-color-name">{domainLabels.get(domain) || domain}</span>
                          <i className="graph-domain-color-swatch" style={{ backgroundColor: getGraphDomainColor(domain, typeColors) }} aria-hidden="true" />
                        </div>
                      ))}
                      <div className="graph-type-color-row">
                        <span className="graph-type-color-name">No domain</span>
                        <i className="graph-domain-color-swatch" style={{ backgroundColor: GRAPH_DOMAIN_UNASSIGNED_COLOR }} aria-hidden="true" />
                      </div>
                    </div>
                    <small>Multiple memberships blend their domain colors. Hover a node to see its memberships.</small>
                  </div>
                ) : null}
                <GraphTypeColorEditor colors={typeColors} onChange={updateTypeColor} />
              </div>
            ) : null}
          </div>
          {visibleControls.length ? (
            <div className="graph-controls graph-controls-inline">
              {visibleControls.map((control) => (
                <button
                  key={control}
                  type="button"
                  className="icon-button graph-icon-button"
                  aria-label={control === 'resetView' ? 'Fit graph to view' : GRAPH_CONTROL_LABELS[control] || control}
                  title={control === 'resetView' ? 'Fit graph to view' : GRAPH_CONTROL_LABELS[control] || control}
                  onClick={() => visualizerRef.current?.[control]?.()}
                >
                  {control === 'resetView' ? <FitViewIcon /> : GRAPH_CONTROL_LABELS[control] || control}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
});

function GraphFlowOverlay({ inputs, tasks, onNodeOpen }) {
  const stageRef = useRef(null);
  const inputRefs = useRef(new Map());
  const taskRefs = useRef(new Map());
  const sourceFilterRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const [selectedSourceTypes, setSelectedSourceTypes] = useState([]);
  const sourceTypeOptions = useMemo(() => {
    const counts = new Map();
    inputs.forEach((item) => {
      const type = graphFlowInputSourceType(item);
      counts.set(type, (counts.get(type) || 0) + 1);
    });
    return [...counts.entries()].sort((left, right) => (
      graphFlowSourceLabel(left[0]).localeCompare(graphFlowSourceLabel(right[0]))
    ));
  }, [inputs]);
  const sourceTypeSet = useMemo(() => new Set(selectedSourceTypes), [selectedSourceTypes]);
  const visibleInputs = useMemo(() => {
    const matchingInputs = selectedSourceTypes.length
      ? inputs.filter((item) => sourceTypeSet.has(graphFlowInputSourceType(item)))
      : inputs;
    return matchingInputs.slice(0, GRAPH_FLOW_INPUT_LIMIT);
  }, [inputs, selectedSourceTypes.length, sourceTypeSet]);

  useEffect(() => {
    const availableTypes = new Set(sourceTypeOptions.map(([type]) => type));
    setSelectedSourceTypes((current) => {
      const next = current.filter((type) => availableTypes.has(type));
      return next.length === current.length ? current : next;
    });
  }, [sourceTypeOptions]);

  useEffect(() => {
    if (!sourceFilterOpen) return undefined;
    function handlePointerDown(event) {
      if (!sourceFilterRef.current?.contains(event.target)) setSourceFilterOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setSourceFilterOpen(false);
    }
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sourceFilterOpen]);

  function toggleSourceType(type) {
    setSelectedSourceTypes((current) => current.includes(type)
      ? current.filter((value) => value !== type)
      : [...current, type]);
  }

  useLayoutEffect(() => {
    function measure() {
      const stage = stageRef.current;
      if (!stage) return;
      const stageRect = stage.getBoundingClientRect();
      if (!stageRect.width || !stageRect.height) return;
      const pointFor = (node, edge = 'center') => {
        const rect = node?.getBoundingClientRect();
        if (!rect) return null;
        return {
          x: (edge === 'right' ? rect.right : edge === 'left' ? rect.left : rect.left + (rect.width / 2)) - stageRect.left,
          y: rect.top + (rect.height / 2) - stageRect.top,
        };
      };
      const graphHost = stage.parentElement;
      const graphNodes = new Map(
        [...(graphHost?.querySelectorAll('[data-graph-node-slug]') || [])]
          .map((node) => [node.getAttribute('data-graph-node-slug'), node])
          .filter(([slug]) => slug),
      );
      const graphPointFor = (slug) => pointFor(graphNodes.get(slug));
      setLayout({
        width: stageRect.width,
        height: stageRect.height,
        inputs: visibleInputs.flatMap((item) => {
          const source = pointFor(inputRefs.current.get(item.id || item.event_id || item.slug), 'right');
          return graphFlowInputTargets(item).map((target) => ({
            source,
            target: graphPointFor(target.slug),
          }));
        }).filter(({ source, target }) => source && target),
        outputs: tasks.map((item) => ({
          source: graphPointFor(item.slug),
          target: pointFor(taskRefs.current.get(item.slug), 'left'),
        })).filter(({ source, target }) => source && target),
      });
    }

    let frame = window.requestAnimationFrame(measure);
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const graphHost = stageRef.current?.parentElement;
    const observed = [stageRef.current, graphHost, ...inputRefs.current.values(), ...taskRefs.current.values()].filter(Boolean);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    observed.forEach((node) => observer?.observe(node));
    const mutationObserver = typeof MutationObserver === 'undefined' || !graphHost
      ? null
      : new MutationObserver(scheduleMeasure);
    mutationObserver?.observe(graphHost, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'data-graph-node-slug', 'style', 'transform', 'viewBox'],
    });
    const animationRefresh = window.setTimeout(scheduleMeasure, 1400);
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(animationRefresh);
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [tasks, visibleInputs]);

  return (
    <>
      <GraphFlowNetwork layout={layout} />
      <div ref={stageRef} className="graph-flow-overlay">
        <div className="graph-flow-column graph-flow-input-column">
          <div className="graph-flow-column-head">
            <span>Inputs</span>
            <div className="graph-flow-column-head-actions">
              <small>{visibleInputs.length}</small>
              <div className="graph-flow-source-filter-shell" ref={sourceFilterRef}>
                <button
                  type="button"
                  className={`icon-button graph-flow-source-filter-button ${sourceFilterOpen || selectedSourceTypes.length ? 'graph-button-active' : ''}`}
                  aria-label="Filter inputs by source type"
                  title="Filter inputs by source type"
                  aria-expanded={sourceFilterOpen}
                  onClick={() => setSourceFilterOpen((value) => !value)}
                >
                  <FilterIcon />
                </button>
                {sourceFilterOpen ? (
                  <div className="graph-filter-menu graph-flow-source-filter-menu" role="menu">
                    <div className="graph-filter-group">
                      <span className="graph-filter-group-label">Source types</span>
                      <button
                        type="button"
                        className={`menu-item ${selectedSourceTypes.length === 0 ? 'selected' : ''}`}
                        onClick={() => setSelectedSourceTypes([])}
                        role="menuitemcheckbox"
                        aria-checked={selectedSourceTypes.length === 0}
                      >
                        <span>All source types</span>
                        <span className="menu-item-check" aria-hidden="true">{selectedSourceTypes.length === 0 ? '✓' : ''}</span>
                      </button>
                      {sourceTypeOptions.map(([type, count]) => {
                        const selected = sourceTypeSet.has(type);
                        return (
                          <button
                            key={type}
                            type="button"
                            className={`menu-item ${selected ? 'selected' : ''}`}
                            onClick={() => toggleSourceType(type)}
                            role="menuitemcheckbox"
                            aria-checked={selected}
                          >
                            <span>{graphFlowSourceLabel(type)} ({count})</span>
                            <span className="menu-item-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="graph-flow-card-list">
            {visibleInputs.map((item) => (
              (() => {
                const targets = graphFlowInputTargets(item);
                const source = item.demo_input ? item.input_source : item.source;
                const sourceMessage = item.source_message || source?.label || item.event_id || 'Inbound input';
                return (
                  <button
                    key={item.id || item.event_id || item.slug}
                    ref={(node) => node ? inputRefs.current.set(item.id || item.event_id || item.slug, node) : inputRefs.current.delete(item.id || item.event_id || item.slug)}
                    type="button"
                    className="graph-flow-card"
                    title={sourceMessage}
                    onClick={() => onNodeOpen?.(targets[0]?.slug)}
                  >
                    {item.demo_input ? <GraphFlowInputMarkers item={item} /> : <GraphFlowSourceIcon source={source} />}
                    <span className="graph-flow-card-copy"><strong>{sourceMessage}</strong><small>{item.demo_input ? `${item.input_source.label} · ${item.input_sender.name}` : `${graphFlowSourceLabel(source?.type)} · ${formatDateTime(item.received_at || item.occurred_at)}`}</small></span>
                    <span className="graph-flow-card-status">{formatGraphFlowTargetCount(item)}</span>
                  </button>
                );
              })()
            ))}
          </div>
        </div>
        <div className="graph-flow-column graph-flow-output-column">
          <div className="graph-flow-column-head"><span>Next tasks</span><small>{tasks.length}</small></div>
          <div className="graph-flow-card-list">
            {tasks.map((item) => (
              <button
                key={item.slug}
                ref={(node) => node ? taskRefs.current.set(item.slug, node) : taskRefs.current.delete(item.slug)}
                type="button"
                className="graph-flow-card"
                onClick={() => onNodeOpen?.(item.slug)}
              >
                <span className="graph-flow-card-type graph-flow-card-task">→</span>
                <span className="graph-flow-card-copy"><strong>{item.title || labelFromSlug(item.slug)}</strong><small>{formatTaskStatus(item.status)}{item.due ? ` · due ${item.due}` : ''}</small></span>
                <span className="graph-flow-card-status">{formatTaskStatus(item.status)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function GraphFlowSourceIcon({ source }) {
  const type = graphFlowSourceType(source?.type);
  const SourceIcon = GRAPH_FLOW_SOURCE_ICONS[type];
  const label = source?.label || graphFlowSourceLabel(type);
  return (
    <span
      className={`graph-flow-card-source graph-flow-card-source-${type.replaceAll('_', '-')}`}
      title={label}
      aria-label={label}
    >
      <SourceIcon size={14} strokeWidth={2.1} aria-hidden="true" />
    </span>
  );
}

function GraphFlowInputMarkers({ item }) {
  const source = item.input_source || {};
  const sender = item.input_sender || {};
  const senderName = sender.name || 'Demo sender';
  return (
    <span className="graph-flow-card-markers">
      <GraphFlowSourceIcon source={source} />
      <span
        className="graph-flow-card-avatar"
        title={`Sent by ${senderName}`}
        aria-label={`Sent by ${senderName}`}
      >
        {getAvatarInitials(senderName)}
      </span>
    </span>
  );
}

function getAvatarInitials(name) {
  const initials = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return initials || <UserRound size={13} strokeWidth={2} aria-hidden="true" />;
}

function GraphFlowNetwork({ layout }) {
  if (!layout) return null;
  const inbound = layout.inputs.map((source, index) => ({
    d: graphFlowInboundPath(source.source, source.target),
    delay: `${[-0.2, -1.4, -2.8, -0.8, -3.7, -2.1][index] || 0}s`,
    duration: `${[5.4, 6.1, 4.9, 5.8, 6.5, 5.2][index] || 5.5}s`,
  }));
  const outbound = layout.outputs.map((target, index) => ({
    d: graphFlowOutboundPath(target.source, target.target),
    delay: `${[-2.4, -0.6, -3.5, -1.5, -4.2, -2.8][index] || 0}s`,
    duration: `${[5.8, 5.1, 6.4, 5.5, 6.8, 5.9][index] || 5.8}s`,
  }));

  return (
    <div className="graph-flow-network" aria-hidden="true">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="graph-flow-in-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#d4d4d8" stopOpacity="0.12" />
            <stop offset="0.72" stopColor="#a1a1aa" stopOpacity="0.42" />
            <stop offset="1" stopColor="#f4f4f5" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="graph-flow-out-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#f4f4f5" stopOpacity="0.7" />
            <stop offset="0.46" stopColor="#a1a1aa" stopOpacity="0.42" />
            <stop offset="1" stopColor="#d4d4d8" stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id="graph-flow-energy-in" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#d4d4d8" stopOpacity="0" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.72" stopColor="#d4d4d8" stopOpacity="0.78" />
            <stop offset="1" stopColor="#a1a1aa" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="graph-flow-energy-out" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#a1a1aa" stopOpacity="0" />
            <stop offset="0.34" stopColor="#d4d4d8" stopOpacity="0.82" />
            <stop offset="0.68" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#d4d4d8" stopOpacity="0" />
          </linearGradient>
          <filter id="graph-flow-blur" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="0.9" /></filter>
        </defs>
        {inbound.map((arc, index) => (
          <React.Fragment key={`graph-flow-in-${index}`}>
            <path d={arc.d} className="graph-flow-arc graph-flow-arc-in" />
            <path d={arc.d} className="graph-flow-energy graph-flow-energy-glow" style={{ animationDelay: arc.delay, animationDuration: arc.duration }} />
            <path d={arc.d} className="graph-flow-energy graph-flow-energy-in" style={{ animationDelay: arc.delay, animationDuration: arc.duration }} />
          </React.Fragment>
        ))}
        {outbound.map((arc, index) => (
          <React.Fragment key={`graph-flow-out-${index}`}>
            <path d={arc.d} className="graph-flow-arc graph-flow-arc-out" />
            <path d={arc.d} className="graph-flow-energy graph-flow-energy-glow" style={{ animationDelay: arc.delay, animationDuration: arc.duration }} />
            <path d={arc.d} className="graph-flow-energy graph-flow-energy-out" style={{ animationDelay: arc.delay, animationDuration: arc.duration }} />
          </React.Fragment>
        ))}
      </svg>
    </div>
  );
}

function graphFlowInboundPath(source, target) {
  return graphFlowDirectedPath(source, target);
}

function graphFlowOutboundPath(source, target) {
  return graphFlowDirectedPath(source, target);
}

function graphFlowDirectedPath(source, target) {
  const direction = target.x >= source.x ? 1 : -1;
  const span = Math.max(48, Math.abs(target.x - source.x));
  const handle = Math.min(150, span * 0.42);
  return `M ${source.x} ${source.y} C ${source.x + handle * direction} ${source.y}, ${target.x - handle * direction} ${target.y}, ${target.x} ${target.y}`;
}

function formatTaskStatus(status) {
  return String(status || 'open').replace(/_/g, ' ');
}

function GraphStyleOptionGroup({ label, value, options, onSelect, disabled = false, shortcut }) {
  return (
    <div className={`graph-menu-field ${disabled ? 'disabled' : ''}`}>
      <span>{label}{shortcut ? <> <kbd className="settings-shortcut">{shortcut.toUpperCase()}</kbd></> : null}</span>
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

function GraphTypeColorEditor({ colors, onChange }) {
  return (
    <div className="graph-menu-field">
      <span>Type colors</span>
      <div className="graph-type-color-grid">
        {TYPE_ORDER.map((type) => {
          const color = colors?.[type] || '#FFFFFF';
          const label = formatGraphTypeLabel(type);
          return (
            <div key={type} className="graph-type-color-row">
              <span className="graph-type-color-name">{label}</span>
              <input
                type="color"
                className="graph-type-color-swatch"
                value={color}
                aria-label={`${label} color picker`}
                onChange={(event) => onChange(type, event.target.value)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatGraphTypeLabel(type) {
  return String(type || '')
    .split('-')
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
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

function FitViewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="settings-icon">
      <path d="M9 4H4v5m11-5h5v5m0 6v5h-5M4 15v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="8" y="8" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="dashboard-search-icon">
      <circle cx="10.8" cy="10.8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function stripLeadingMarkdownHeading(markdown, title) {
  const expected = String(title || '').trim();
  if (!expected) return markdown;
  return String(markdown || '').replace(new RegExp(`^\\s*#\\s+${escapeRegExp(expected)}\\s*(?:\\n|$)`, 'i'), '').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const root = createRoot(document.getElementById('root'));
installGlobalErrorHandlers(root);
root.render(
  <DashboardErrorBoundary>
    <RootApp />
  </DashboardErrorBoundary>,
);

function installGlobalErrorHandlers(rootInstance) {
  if (typeof window === 'undefined') return;
  let fatalRendered = false;
  const renderFatal = (label, error) => {
    console.error(label, error);
    recordDashboardError({ source: label, error });
    if (fatalRendered) return;
    fatalRendered = true;
    rootInstance.render(<DashboardFatalError error={error} />);
  };
  window.addEventListener('error', (event) => {
    renderFatal('Dashboard uncaught error', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    renderFatal('Dashboard unhandled promise rejection', event.reason);
  });
}
