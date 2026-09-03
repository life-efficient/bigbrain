import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderAuthErrorPage,
  renderConnectPage,
} from '../../src/bigbrain/mcp-auth.js';

const authConfig = {
  appName: 'Example Brain',
  serviceName: 'Example Brain',
  publicUrl: 'https://brain.example.test',
};

test('connect page starts browser OAuth without requiring the BigBrain CLI', () => {
  const html = renderConnectPage(authConfig);

  assert.match(html, /Sign in with Google/);
  assert.match(html, /href="\/auth\/start\?redirect=%2Fdashboard"/);
  assert.match(html, /standard OAuth discovery endpoints/);
  assert.match(html, /The BigBrain CLI is not required/);
  assert.doesNotMatch(html, /bigbrain connect codex/);
  assert.doesNotMatch(html, /Copy instructions/);
});

test('OAuth error page offers a browser retry for the original dashboard route', () => {
  const error = new Error('ruba@example.com is not allowed to access this brain.');
  error.retryPath = '/dashboard/page/brn_01234567-89ab-4cde-8fab-0123456789ab/people/ruba';
  const html = renderAuthErrorPage(authConfig, error);

  assert.match(html, /ruba@example\.com is not allowed to access this brain\./);
  assert.match(
    html,
    /href="\/auth\/start\?redirect=%2Fdashboard%2Fpage%2Fbrn_01234567-89ab-4cde-8fab-0123456789ab%2Fpeople%2Fruba"/,
  );
  assert.match(html, /Try another Google account/);
  assert.doesNotMatch(html, /bigbrain connect codex/);
});
