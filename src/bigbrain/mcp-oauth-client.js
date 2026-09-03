import http from 'node:http';
import crypto from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { renderOAuthCallbackErrorPage, renderOAuthCompletePage } from './oauth-pages.js';

const execFileDefault = promisify(execFileCallback);
const DEFAULT_SCOPE = 'brain:read brain:create';
const DEFAULT_CALLBACK_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function connectMcpOAuth({
  endpoint,
  clientName = 'BigBrain client',
  fetchImpl = fetch,
  openBrowser = (url) => openOAuthBrowser(url),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const serviceOrigin = serviceOriginFromEndpoint(endpoint);
  const codeVerifier = randomToken(48);
  const codeChallenge = computePkceChallenge(codeVerifier);
  const state = randomToken(32);
  let callbackHandler;
  const callback = await startLoopbackCallbackServer({
    callbackPath: DEFAULT_CALLBACK_PATH,
    timeoutMs,
    handleCallback: (params) => callbackHandler(params),
  });

  try {
    const registration = await registerOAuthClient(fetchImpl, serviceOrigin, {
      client_name: clientName,
      redirect_uris: [callback.redirectUri],
      token_endpoint_auth_method: 'none',
    });
    const clientId = String(registration.client_id || '').trim();
    if (!clientId) throw new Error('The BigBrain service did not return an OAuth client ID.');
    const scope = String(registration.scope || DEFAULT_SCOPE).trim() || DEFAULT_SCOPE;

    callbackHandler = async ({ code, returnedState, error, errorDescription }) => {
      if (error) {
        throw new Error(errorDescription ? `OAuth sign-in was not completed: ${errorDescription}` : 'OAuth sign-in was not completed.');
      }
      if (!code || !returnedState) throw new Error('The OAuth callback did not include a code and state.');
      if (returnedState !== state) throw new Error('The OAuth callback state did not match this sign-in attempt.');
      return exchangeOAuthCode(fetchImpl, serviceOrigin, {
        clientId,
        code,
        codeVerifier,
        redirectUri: callback.redirectUri,
      });
    };

    const authorizeUrl = new URL('/oauth/authorize', `${serviceOrigin}/`);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', callback.redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', scope);
    await openBrowser(authorizeUrl.toString());
    const token = await callback.result;
    return {
      accessToken: token.access_token,
      scope: token.scope || scope,
      tokenType: token.token_type || 'Bearer',
    };
  } finally {
    await callback.close();
  }
}

export async function startLoopbackCallbackServer({
  callbackPath = DEFAULT_CALLBACK_PATH,
  handleCallback,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  host = '127.0.0.1',
} = {}) {
  if (typeof handleCallback !== 'function') throw new Error('A callback handler is required.');
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', `http://${host}`);
    if (request.method !== 'GET' || requestUrl.pathname !== callbackPath) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Not found');
      return;
    }
    if (settled) {
      response.writeHead(409, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(renderOAuthCallbackErrorPage('This sign-in attempt has already been completed.'));
      return;
    }
    settled = true;
    clearTimeout(timeout);
    try {
      const value = await handleCallback({
        code: requestUrl.searchParams.get('code'),
        returnedState: requestUrl.searchParams.get('state'),
        error: requestUrl.searchParams.get('error'),
        errorDescription: requestUrl.searchParams.get('error_description'),
      });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(renderOAuthCompletePage());
      resolveResult(value);
    } catch (error) {
      response.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(renderOAuthCallbackErrorPage(error));
      rejectResult(error);
    } finally {
      closeServer(server);
    }
  });

  let resolveResult;
  let rejectResult;
  let settled = false;
  let timeout;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // The browser can report a provider denial before connectMcpOAuth reaches
  // its await below. Keep that expected rejection observed in the meantime.
  result.catch(() => {});
  await listen(server, host);
  const address = server.address();
  if (!address || typeof address !== 'object') {
    await closeServer(server);
    throw new Error('Could not determine the local OAuth callback address.');
  }
  timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectResult(new Error('OAuth sign-in timed out before the local callback was received.'));
    closeServer(server);
  }, timeoutMs);
  timeout.unref?.();

  return {
    redirectUri: `http://${host}:${address.port}${callbackPath}`,
    result,
    close: async () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        rejectResult(new Error('OAuth sign-in was cancelled before the callback was received.'));
      }
      await closeServer(server);
    },
  };
}

export async function openOAuthBrowser(url, {
  execFile = execFileDefault,
  platform = process.platform,
} = {}) {
  if (platform === 'darwin') return execFile('open', [url]);
  if (platform === 'win32') return execFile('cmd', ['/c', 'start', '', url]);
  return execFile('xdg-open', [url]);
}

function serviceOriginFromEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(String(endpoint || ''));
  } catch {
    throw new Error('OAuth requires a valid BigBrain service endpoint.');
  }
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/mcp\/?$/, '').replace(/\/connect\/?$/, '').replace(/\/$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

async function registerOAuthClient(fetchImpl, serviceOrigin, payload) {
  const response = await fetchImpl(`${serviceOrigin}/oauth/register`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`OAuth client registration failed with HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error('OAuth client registration returned an invalid response.');
  }
}

async function exchangeOAuthCode(fetchImpl, serviceOrigin, { clientId, code, codeVerifier, redirectUri }) {
  const response = await fetchImpl(`${serviceOrigin}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed with HTTP ${response.status}.`);
  let token;
  try {
    token = await response.json();
  } catch {
    throw new Error('OAuth token exchange returned an invalid response.');
  }
  if (!token?.access_token) throw new Error('OAuth token exchange did not return an access token.');
  return token;
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function computePkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
