import { overlayById } from './overlays/registry.js';

const VIEWS = new Set(['graph', 'recents', 'explorer', 'tasks', 'analytics']);
const ROUTES = { graph: 'graph', recents: 'stream', explorer: 'explorer', tasks: 'tasks', analytics: 'analytics' };
const ROUTE_VIEWS = Object.fromEntries(Object.entries(ROUTES).map(([view, route]) => [route, view]));

export function dashboardNavigationFromUrl(url, basePath = '') {
  const location = new URL(url, 'http://localhost');
  const base = normalizeBasePath(basePath);
  const relative = location.pathname.startsWith(`${base}/`)
    ? location.pathname.slice(base.length + 1)
    : location.pathname === base ? '' : null;
  const legacyView = location.searchParams.get('view');
  const overlay = overlayViewFromRoute(relative);
  const view = ROUTE_VIEWS[relative] || overlay || (relative === '' || relative === 'index.html'
    ? (isKnownView(legacyView) ? legacyView : 'graph') : 'graph');
  const slug = validSlug(location.searchParams.get('page'));
  const focus = view === 'graph' && Boolean(slug) && location.searchParams.get('focus') === '1';
  const image = location.searchParams.get('image');
  const kind = location.searchParams.get('kind') === 'images' ? 'images' : 'pages';
  return {
    view,
    slug,
    focus,
    image: view === 'recents' && kind === 'images' && image ? image : null,
    domain: location.searchParams.get('domain') || '',
    collection: location.searchParams.get('collection') || '',
    activity: ['updated', 'viewed', 'added'].includes(location.searchParams.get('activity')) ? location.searchParams.get('activity') : 'updated',
    kind,
  };
}

export function dashboardNavigationHref(state, basePath = '') {
  const base = normalizeBasePath(basePath);
  const view = isKnownView(state.view) ? state.view : 'graph';
  const params = new URLSearchParams();
  if (validSlug(state.slug)) params.set('page', state.slug);
  if (view === 'graph' && state.focus && validSlug(state.slug)) params.set('focus', '1');
  if (view === 'graph' && state.domain) params.set('domain', state.domain);
  if (state.collection) params.set('collection', state.collection);
  if (view === 'recents') {
    if (state.activity && state.activity !== 'updated') params.set('activity', state.activity);
    if (state.kind === 'images') params.set('kind', 'images');
    if (state.kind === 'images' && state.image) params.set('image', state.image);
  }
  const query = params.toString();
  const route = ROUTES[view] || `overlays/${encodeURIComponent(view)}`;
  return `${base}/${route}${query ? `?${query}` : ''}`;
}

function isKnownView(view) {
  return VIEWS.has(view) || Boolean(overlayById(view));
}

function overlayViewFromRoute(relative) {
  if (typeof relative !== 'string' || !relative.startsWith('overlays/')) return null;
  const routeId = relative.slice('overlays/'.length);
  if (!routeId || routeId.includes('/')) return null;
  try {
    const id = decodeURIComponent(routeId);
    return overlayById(id)?.id || null;
  } catch {
    return null;
  }
}

export function updateDashboardNavigation(current, patch) {
  const next = { ...current, ...patch };
  if (patch.view && patch.view !== current.view) {
    if (!('slug' in patch)) next.slug = null;
    if (!('focus' in patch)) next.focus = false;
    if (!('image' in patch)) next.image = null;
  }
  if ('slug' in patch && patch.slug !== current.slug) next.image = null;
  if ('kind' in patch || 'activity' in patch || 'collection' in patch) next.image = null;
  if (!next.slug) next.focus = false;
  return next;
}

function normalizeBasePath(value) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  return !base || base === '/' ? '' : base.startsWith('/') ? base : `/${base}`;
}

function validSlug(value) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  const parts = value.split('/');
  return parts.length >= 2 && parts.every((part) => part && part !== '.' && part !== '..' && !/[\\\u0000-\u001f]/.test(part)) ? value : null;
}
