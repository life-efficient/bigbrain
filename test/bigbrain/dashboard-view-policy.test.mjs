import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  dashboardPartition,
  dashboardViewBounds,
  isAllowedDashboardNavigation,
} = require('../../electron/lib/dashboard-view-policy.cjs');

test('dashboard content views use stable isolated persistent partitions per brain', () => {
  assert.equal(dashboardPartition('brain-one'), dashboardPartition('brain-one'));
  assert.notEqual(dashboardPartition('brain-one'), dashboardPartition('brain-two'));
  assert.match(dashboardPartition('brain-one'), /^persist:bigbrain-dashboard-[a-f0-9]{24}$/);
});

test('dashboard content view stays below fixed desktop chrome', () => {
  assert.deepEqual(dashboardViewBounds([1079, 945], 104), {
    x: 0,
    y: 104,
    width: 1079,
    height: 841,
  });
  assert.deepEqual(dashboardViewBounds([0, 40], 104), {
    x: 0,
    y: 104,
    width: 1,
    height: 1,
  });
});

test('dashboard navigation is limited to the selected brain and Google sign-in', () => {
  const origin = 'https://brain.example.test';
  assert.equal(isAllowedDashboardNavigation(`${origin}/dashboard`, origin), true);
  assert.equal(isAllowedDashboardNavigation(`${origin}/oauth/callback`, origin), true);
  assert.equal(isAllowedDashboardNavigation('https://accounts.google.com/o/oauth2/v2/auth', origin), true);
  assert.equal(isAllowedDashboardNavigation('https://another-brain.example.test/dashboard', origin), false);
  assert.equal(isAllowedDashboardNavigation('http://127.0.0.1:55560/dashboard', origin), false);
  assert.equal(isAllowedDashboardNavigation('file:///tmp/brain', origin), false);
});
