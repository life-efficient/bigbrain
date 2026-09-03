import test from 'node:test';
import assert from 'node:assert/strict';

import { connectMcpOAuth } from '../../src/bigbrain/mcp-oauth-client.js';

test('MCP OAuth owns the loopback callback and renders a neutral completion page', async () => {
  let registration;
  let tokenRequest;
  let callbackResponse;
  let authorizationUrl;
  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://brain.example.test/oauth/register') {
      registration = JSON.parse(options.body);
      return jsonResponse({ client_id: 'client-test', scope: 'brain:read brain:create' });
    }
    if (url === 'https://brain.example.test/oauth/token') {
      tokenRequest = new URLSearchParams(options.body);
      return jsonResponse({ access_token: 'oauth-secret', token_type: 'Bearer', scope: 'brain:read brain:create' });
    }
    throw new Error(`Unexpected remote request: ${url}`);
  };
  const openBrowser = async (url) => {
    authorizationUrl = new URL(url);
    const callbackUrl = new URL(authorizationUrl.searchParams.get('redirect_uri'));
    callbackUrl.searchParams.set('code', 'authorization-code');
    callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state'));
    callbackResponse = await fetch(callbackUrl);
  };

  const result = await connectMcpOAuth({
    endpoint: 'https://brain.example.test/mcp',
    clientName: 'example-client',
    fetchImpl,
    openBrowser,
  });

  assert.deepEqual(result, {
    accessToken: 'oauth-secret',
    scope: 'brain:read brain:create',
    tokenType: 'Bearer',
  });
  assert.equal(registration.client_name, 'example-client');
  assert.equal(registration.token_endpoint_auth_method, 'none');
  assert.equal(registration.redirect_uris.length, 1);
  assert.match(registration.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.equal(tokenRequest.get('client_id'), 'client-test');
  assert.equal(tokenRequest.get('code'), 'authorization-code');
  assert.equal(tokenRequest.get('redirect_uri'), registration.redirect_uris[0]);
  assert.equal(tokenRequest.get('grant_type'), 'authorization_code');
  assert.equal(callbackResponse.status, 200);
  const html = await callbackResponse.text();
  assert.match(html, /Authorization complete/);
  assert.match(html, /You can close this page/);
  assert.doesNotMatch(html, /Example Brain|ICAIRE|BigBrain/);
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
});

test('MCP OAuth renders a neutral failure page when the provider denies access', async () => {
  let callbackResponse;
  const fetchImpl = async (url) => {
    if (url.endsWith('/oauth/register')) return jsonResponse({ client_id: 'client-test', scope: 'brain:read' });
    throw new Error(`Unexpected remote request: ${url}`);
  };
  const openBrowser = async (url) => {
    const authorize = new URL(url);
    const callbackUrl = new URL(authorize.searchParams.get('redirect_uri'));
    callbackUrl.searchParams.set('error', 'access_denied');
    callbackUrl.searchParams.set('error_description', 'The user cancelled sign-in.');
    callbackUrl.searchParams.set('state', authorize.searchParams.get('state'));
    callbackResponse = await fetch(callbackUrl);
  };

  await assert.rejects(
    () => connectMcpOAuth({ endpoint: 'https://brain.example.test/mcp', fetchImpl, openBrowser }),
    /OAuth sign-in was not completed: The user cancelled sign-in\./,
  );
  assert.equal(callbackResponse.status, 400);
  const html = await callbackResponse.text();
  assert.match(html, /We could not finish sign-in/);
  assert.match(html, /The user cancelled sign-in/);
  assert.doesNotMatch(html, /Example Brain|ICAIRE|BigBrain/);
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
