import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAYS } from '../../src/dashboard-client/overlays/registry.js';

import {
  dashboardNavigationFromUrl,
  dashboardNavigationHref,
  updateDashboardNavigation,
} from '../../src/dashboard-client/navigation.js';

test('dashboard routes round trip deliberate view state under local and hosted bases', () => {
  const state = {
    view: 'graph', slug: 'people/alice', focus: true, image: null,
    domain: 'ai-infrastructure', collection: 'priority', activity: 'updated', kind: 'pages',
  };
  for (const base of ['', '/dashboard']) {
    const href = dashboardNavigationHref(state, base);
    assert.equal(href, `${base}/graph?page=people%2Falice&focus=1&domain=ai-infrastructure&collection=priority`);
    assert.deepEqual(dashboardNavigationFromUrl(href, base), state);

    const stream = { ...state, view: 'recents', focus: false, domain: '', activity: 'viewed', kind: 'images', image: 'people/.raw/alice portrait.png' };
    assert.deepEqual(dashboardNavigationFromUrl(dashboardNavigationHref(stream, base), base), stream);
  }
});

test('all registered overlays round trip through their routes and legacy root aliases', () => {
  for (const base of ['', '/dashboard']) {
    for (const overlay of OVERLAYS) {
      const state = {
        view: overlay.id, slug: 'deals/example', focus: false, image: null,
        domain: '', collection: '', activity: 'updated', kind: 'pages',
      };
      const href = dashboardNavigationHref(state, base);
      assert.equal(href, `${base}/overlays/${encodeURIComponent(overlay.id)}?page=deals%2Fexample`);
      assert.deepEqual(dashboardNavigationFromUrl(href, base), state);
      assert.equal(dashboardNavigationFromUrl(`${base}/?view=${encodeURIComponent(overlay.id)}`, base).view, overlay.id);
      assert.equal(dashboardNavigationFromUrl(`${base}/index.html?view=${encodeURIComponent(overlay.id)}`, base).view, overlay.id);
    }
  }
});

test('overlay routing follows registry additions and rejects unregistered or malformed routes', () => {
  const overlay = { id: 'routing-test-overlay', label: 'Temporary routing test' };
  OVERLAYS.push(overlay);
  try {
    assert.equal(dashboardNavigationHref({ view: overlay.id }), '/overlays/routing-test-overlay');
    assert.equal(dashboardNavigationFromUrl('/overlays/routing-test-overlay').view, overlay.id);
  } finally {
    OVERLAYS.splice(OVERLAYS.indexOf(overlay), 1);
  }
  for (const route of ['/overlays/unregistered', '/overlays/%', '/overlays/keep-in-touch/extra', '/outside/overlays/keep-in-touch']) {
    assert.equal(dashboardNavigationFromUrl(route).view, 'graph');
  }
  assert.equal(dashboardNavigationHref({ view: 'unregistered' }), '/graph');
});

test('legacy root URLs open and new view navigation clears page selection', () => {
  const legacy = dashboardNavigationFromUrl('/?view=recents&kind=images', '');
  assert.equal(legacy.view, 'recents');
  assert.equal(legacy.kind, 'images');
  const focused = dashboardNavigationFromUrl('/graph?page=people/alice&focus=1');
  assert.deepEqual(updateDashboardNavigation(focused, { view: 'recents' }), {
    ...focused, view: 'recents', slug: null, focus: false, image: null,
  });
  assert.deepEqual(updateDashboardNavigation(legacy, { view: 'graph', slug: 'people/bob', focus: true }).slug, 'people/bob');
  assert.equal(dashboardNavigationFromUrl('/graph?page=..%2Fsecret&focus=1').slug, null);
});
