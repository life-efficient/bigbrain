import test from 'node:test';
import assert from 'node:assert/strict';

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
