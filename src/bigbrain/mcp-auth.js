import crypto from 'node:crypto';

const DEFAULT_PROVIDER = 'google';
const CLIENT_ID_PREFIX = 'bbmcp_client_';
const CODE_PREFIX = 'bbmcp_code_';
const ACCESS_TOKEN_PREFIX = 'bbmcp_';
const DASHBOARD_SESSION_PREFIX = 'bbdash_';
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SCOPES = ['brain:read', 'brain:write'];
const DASHBOARD_SCOPE = 'dashboard:read';

export function buildAuthConfig({
  env = process.env,
  authToken = env.BIGBRAIN_MCP_TOKEN || env.MCP_AUTH_TOKEN || null,
} = {}) {
  const mode = env.BIGBRAIN_MCP_AUTH_MODE || (authToken ? 'token' : 'none');
  const publicUrl = (env.BIGBRAIN_MCP_PUBLIC_URL || '').replace(/\/+$/, '');
  const allowedEmails = parseList(env.BIGBRAIN_MCP_ALLOWED_EMAILS).map((email) => email.toLowerCase());
  const allowedDomains = parseList(env.BIGBRAIN_MCP_ALLOWED_DOMAINS)
    .map((domain) => domain.replace(/^@/, '').toLowerCase());
  return {
    mode,
    authToken,
    publicUrl,
    provider: env.BIGBRAIN_MCP_OAUTH_PROVIDER || DEFAULT_PROVIDER,
    googleClientId: env.BIGBRAIN_MCP_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.BIGBRAIN_MCP_GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || '',
    allowedEmails,
    allowedDomains,
    tokenStorePath: env.BIGBRAIN_MCP_TOKEN_STORE || '',
    tokenStore: null,
    allowSharedToken: env.BIGBRAIN_MCP_ALLOW_SHARED_TOKEN === '1',
    serviceName: env.BIGBRAIN_MCP_SERVICE_NAME || 'BigBrain MCP',
    appName: env.BIGBRAIN_MCP_APP_NAME || env.BIGBRAIN_MCP_SERVICE_NAME || 'BigBrain',
  };
}

export async function authorizeMcpRequest(request, authConfig) {
  if (authConfig.mode === 'none') return { ok: true, actor: null };

  const token = bearerToken(request) || request.headers['x-bigbrain-token'];
  if (!token) return { ok: false, status: 401, message: 'Unauthorized' };

  if (authConfig.mode === 'token') {
    if (authConfig.authToken && token === authConfig.authToken) return { ok: true, actor: null };
    return { ok: false, status: 401, message: 'Unauthorized' };
  }

  if (authConfig.mode === 'oauth_allowlist') {
    if (authConfig.allowSharedToken && authConfig.authToken && token === authConfig.authToken) {
      return { ok: true, actor: { email: 'shared-token', name: 'Shared Token' } };
    }
    const store = await readTokenStore(authConfig);
    const tokenHash = hashToken(token);
    const record = store.tokens.find((entry) => entry.token_hash === tokenHash && !entry.revoked_at);
    if (!record) return { ok: false, status: 401, message: 'Unauthorized' };
    record.last_used_at = new Date().toISOString();
    await writeTokenStore(authConfig, store);
    return { ok: true, actor: { email: record.email, name: record.name || record.email } };
  }

  return { ok: false, status: 500, message: `Unsupported auth mode: ${authConfig.mode}` };
}

export async function authorizeDashboardRequest(request, authConfig) {
  if (authConfig.mode === 'none') return { ok: true, actor: null };
  if (authConfig.mode !== 'oauth_allowlist') {
    return { ok: false, status: 403, message: 'Dashboard OAuth requires BIGBRAIN_MCP_AUTH_MODE=oauth_allowlist.' };
  }

  const token = cookieValue(request.headers.cookie || '', 'bigbrain_dashboard_session');
  if (!token) return { ok: false, status: 302, location: '/auth/start' };

  const store = await readTokenStore(authConfig);
  const tokenHash = hashToken(token);
  const now = new Date();
  const record = store.tokens.find((entry) =>
    entry.token_hash === tokenHash
    && !entry.revoked_at
    && entry.scope === DASHBOARD_SCOPE
    && (!entry.expires_at || new Date(entry.expires_at) > now)
  );
  if (!record) return { ok: false, status: 302, location: '/auth/start', clearCookie: true };
  record.last_used_at = new Date().toISOString();
  await writeTokenStore(authConfig, store);
  return { ok: true, actor: { email: record.email, name: record.name || record.email } };
}

export function authRoutesEnabled(authConfig) {
  return authConfig.mode === 'oauth_allowlist';
}

export function assertOAuthConfigured(authConfig) {
  if (!authConfig.publicUrl) throw new Error('BIGBRAIN_MCP_PUBLIC_URL is required for OAuth auth.');
  if (authConfig.provider !== 'google') throw new Error(`Unsupported OAuth provider: ${authConfig.provider}`);
  if (!authConfig.googleClientId) throw new Error('BIGBRAIN_MCP_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_ID is required.');
  if (!authConfig.googleClientSecret) throw new Error('BIGBRAIN_MCP_GOOGLE_CLIENT_SECRET or GOOGLE_CLIENT_SECRET is required.');
  if (!authConfig.allowedEmails.length && !authConfig.allowedDomains.length) {
    throw new Error('Set BIGBRAIN_MCP_ALLOWED_EMAILS or BIGBRAIN_MCP_ALLOWED_DOMAINS before enabling OAuth.');
  }
  if (!authConfig.tokenStorePath && !authConfig.tokenStore) {
    throw new Error('BIGBRAIN_MCP_TOKEN_STORE is required for OAuth auth unless a database token store is configured.');
  }
}

export function protectedResourceMetadata(authConfig) {
  return {
    resource: `${authConfig.publicUrl}/mcp`,
    authorization_servers: [authConfig.publicUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: SCOPES,
    resource_documentation: `${authConfig.publicUrl}/connect`,
  };
}

export function authorizationServerMetadata(authConfig) {
  return {
    issuer: authConfig.publicUrl,
    authorization_endpoint: `${authConfig.publicUrl}/oauth/authorize`,
    token_endpoint: `${authConfig.publicUrl}/oauth/token`,
    registration_endpoint: `${authConfig.publicUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SCOPES,
    service_documentation: `${authConfig.publicUrl}/connect`,
  };
}

export async function registerOAuthClient(authConfig, input = {}) {
  assertOAuthConfigured(authConfig);
  const redirectUris = Array.from(new Set(Array.isArray(input.redirect_uris) ? input.redirect_uris : [])).filter(Boolean);
  if (!redirectUris.length) throw new Error('redirect_uris must include at least one callback URL.');
  const clientId = `${CLIENT_ID_PREFIX}${randomToken(24)}`;
  const store = await readTokenStore(authConfig);
  store.clients.push({
    client_id: clientId,
    client_name: input.client_name || null,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: input.scope || SCOPES.join(' '),
    token_endpoint_auth_method: 'none',
    created_at: new Date().toISOString(),
  });
  await writeTokenStore(authConfig, store);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: input.scope || SCOPES.join(' '),
    token_endpoint_auth_method: 'none',
  };
}

export async function createAgentOAuthStart(authConfig, requestUrl) {
  assertOAuthConfigured(authConfig);
  const url = new URL(requestUrl, authConfig.publicUrl);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const state = url.searchParams.get('state') || '';
  const scope = normalizeScope(url.searchParams.get('scope'));

  if (!clientId || !redirectUri || responseType !== 'code' || !codeChallenge || codeChallengeMethod !== 'S256') {
    throw new Error('client_id, redirect_uri, response_type=code, code_challenge, and code_challenge_method=S256 are required.');
  }

  const store = await readTokenStore(authConfig);
  const client = store.clients.find((entry) => entry.client_id === clientId);
  if (!client) throw new Error('Unknown client_id.');
  if (!client.redirect_uris.includes(redirectUri)) throw new Error('redirect_uri must match a registered callback URL.');

  const googleState = randomToken(24);
  store.states.push({
    flow: 'agent_oauth',
    state_hash: hashToken(googleState),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    original_state: state,
    scope,
  });
  pruneStore(store);
  await writeTokenStore(authConfig, store);

  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id', authConfig.googleClientId);
  google.searchParams.set('redirect_uri', callbackUrl(authConfig));
  google.searchParams.set('response_type', 'code');
  google.searchParams.set('scope', 'openid email profile');
  google.searchParams.set('state', googleState);
  google.searchParams.set('prompt', 'select_account');
  return google.toString();
}

export async function createDashboardOAuthStart(authConfig, requestUrl) {
  assertOAuthConfigured(authConfig);
  const url = new URL(requestUrl, authConfig.publicUrl);
  const redirectPath = normalizeRedirectPath(url.searchParams.get('redirect') || '/');
  const googleState = randomToken(24);
  const store = await readTokenStore(authConfig);
  store.states.push({
    flow: 'dashboard_oauth',
    state_hash: hashToken(googleState),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    redirect_path: redirectPath,
  });
  pruneStore(store);
  await writeTokenStore(authConfig, store);

  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id', authConfig.googleClientId);
  google.searchParams.set('redirect_uri', callbackUrl(authConfig));
  google.searchParams.set('response_type', 'code');
  google.searchParams.set('scope', 'openid email profile');
  google.searchParams.set('state', googleState);
  google.searchParams.set('prompt', 'select_account');
  return google.toString();
}

export async function completeOAuthCallback(authConfig, { code, state }) {
  assertOAuthConfigured(authConfig);
  if (!code || !state) throw new Error('Missing OAuth code or state.');

  const store = await readTokenStore(authConfig);
  const stateHash = hashToken(state);
  const now = new Date();
  const stateRecord = store.states.find((entry) => entry.state_hash === stateHash && new Date(entry.expires_at) > now);
  if (!stateRecord) throw new Error('OAuth state expired or invalid.');
  store.states = store.states.filter((entry) => entry.state_hash !== stateHash);

  const profile = await fetchGoogleProfile(authConfig, code);
  const email = String(profile.email || '').toLowerCase();
  if (!email || profile.email_verified === false) throw new Error('Google account email is not verified.');
  if (!isEmailAllowed(authConfig, email)) throw new Error(`${email} is not allowed to access this brain.`);

  if (stateRecord.flow === 'agent_oauth') {
    const authCode = `${CODE_PREFIX}${randomToken(24)}`;
    store.codes.push({
      code_hash: hashToken(authCode),
      client_id: stateRecord.client_id,
      redirect_uri: stateRecord.redirect_uri,
      code_challenge: stateRecord.code_challenge,
      scope: stateRecord.scope || SCOPES.join(' '),
      email,
      name: profile.name || email,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
    });
    await writeTokenStore(authConfig, store);
    return {
      redirect_uri: stateRecord.redirect_uri,
      code: authCode,
      state: stateRecord.original_state,
    };
  }

  if (stateRecord.flow === 'dashboard_oauth') {
    const token = `${DASHBOARD_SESSION_PREFIX}${randomToken(32)}`;
    store.tokens.push({
      token_hash: hashToken(token),
      email,
      name: profile.name || email,
      provider: 'google',
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      scope: DASHBOARD_SCOPE,
      expires_at: new Date(Date.now() + DASHBOARD_SESSION_TTL_MS).toISOString(),
    });
    pruneStore(store);
    await writeTokenStore(authConfig, store);
    return {
      dashboard_session_token: token,
      redirect_path: normalizeRedirectPath(stateRecord.redirect_path || '/'),
      email,
      name: profile.name || email,
    };
  }

  return { completed: true, email, name: profile.name || email };
}

export async function exchangeAgentOAuthCode(authConfig, params) {
  assertOAuthConfigured(authConfig);
  const grantType = params.get('grant_type');
  const code = params.get('code');
  const codeVerifier = params.get('code_verifier');
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  if (grantType !== 'authorization_code') throw new Error('Unsupported grant_type.');
  if (!code || !codeVerifier || !clientId) throw new Error('code, code_verifier, and client_id are required.');

  const store = await readTokenStore(authConfig);
  const codeHash = hashToken(code);
  const now = new Date();
  const record = store.codes.find((entry) =>
    entry.code_hash === codeHash
    && entry.client_id === clientId
    && new Date(entry.expires_at) > now
    && (!redirectUri || entry.redirect_uri === redirectUri)
  );
  if (!record) throw new Error('Authorization code expired or invalid.');
  if (computePkceChallenge(codeVerifier) !== record.code_challenge) {
    throw new Error('code_verifier does not match the original PKCE challenge.');
  }

  store.codes = store.codes.filter((entry) => entry.code_hash !== codeHash);
  const token = `${ACCESS_TOKEN_PREFIX}${randomToken(32)}`;
  store.tokens.push({
    token_hash: hashToken(token),
    email: record.email,
    name: record.name || record.email,
    provider: 'google',
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
    scope: record.scope || SCOPES.join(' '),
  });
  pruneStore(store);
  await writeTokenStore(authConfig, store);
  return {
    access_token: token,
    token_type: 'Bearer',
    scope: record.scope || SCOPES.join(' '),
  };
}

export function renderConnectPage(authConfig, { error = '' } = {}) {
  const appName = authConfig.appName || authConfig.serviceName;
  const title = escapeHtml(appName);
  const serverName = slugName(authConfig.serviceName);
  const endpoint = `${authConfig.publicUrl}/mcp`;
  const configSnippet = `First, connect to the following MCP server and test it\n\n[mcp_servers.${serverName}]\nurl = "${endpoint}"\n\nAfter that, update your system prompt to include "Anything related to ${appName} should be stored, and searched for from the remote ${appName} brain via MCP"`;
  const errorHtml = error ? `<div class="notice error">${escapeHtml(error)}</div>` : '';
  return htmlPage(title, `
    <main class="shell">
      <section class="hero">
        <h1>${title}</h1>
        <p>Give the instructions below to your agent to allow them to query and update the brain.</p>
      </section>
      ${errorHtml}
      <pre id="config" class="copy-box" tabindex="0">${escapeHtml(configSnippet)}</pre>
      <div class="copy-actions">
        <button class="copy-button" type="button" data-copy-target="config" aria-label="Copy config">
          <svg class="copy-icon" aria-hidden="true" viewBox="0 0 24 24">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
          </svg>
          <span>Copy config</span>
        </button>
      </div>
    </main>
  `);
}

export function renderOAuthCompletePage(authConfig) {
  return htmlPage('Connected', `
    <main class="shell">
      <section class="hero compact">
        <div class="badge">Connected</div>
        <h1>${escapeHtml(authConfig.serviceName)}</h1>
        <p>The OAuth approval is complete. You can close this tab and return to your harness.</p>
      </section>
    </main>
  `);
}

export function renderAuthErrorPage(authConfig, error) {
  return renderConnectPage(authConfig, { error });
}

function callbackUrl(authConfig) {
  return `${authConfig.publicUrl}/auth/callback`;
}

async function fetchGoogleProfile(authConfig, code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: authConfig.googleClientId,
      client_secret: authConfig.googleClientSecret,
      redirect_uri: callbackUrl(authConfig),
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed with HTTP ${response.status}.`);
  const token = await response.json();
  const userInfo = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userInfo.ok) throw new Error(`Google userinfo failed with HTTP ${userInfo.status}.`);
  return userInfo.json();
}

function isEmailAllowed(authConfig, email) {
  if (authConfig.allowedEmails.includes(email)) return true;
  const domain = email.split('@')[1] || '';
  return authConfig.allowedDomains.includes(domain);
}

async function readTokenStore(authConfig) {
  if (authConfig.tokenStore) return authConfig.tokenStore.read();
  if (!authConfig.tokenStorePath) return { tokens: [], states: [], clients: [], codes: [] };
  const { FileMcpAuthStore } = await import('./mcp-auth-store.js');
  return new FileMcpAuthStore(authConfig.tokenStorePath).read();
}

async function writeTokenStore(authConfig, store) {
  if (authConfig.tokenStore) return authConfig.tokenStore.write(store);
  if (!authConfig.tokenStorePath) return;
  const { FileMcpAuthStore } = await import('./mcp-auth-store.js');
  return new FileMcpAuthStore(authConfig.tokenStorePath).write(store);
}

function pruneStore(store) {
  const now = new Date();
  store.states = store.states.filter((entry) => new Date(entry.expires_at) > now);
  store.codes = (store.codes || []).filter((entry) => new Date(entry.expires_at) > now);
}

function bearerToken(request) {
  const authorization = request.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
}

function cookieValue(cookieHeader, name) {
  const cookies = String(cookieHeader || '').split(';');
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName === name) return decodeURIComponent(rawValue.join('='));
  }
  return '';
}

function normalizeRedirectPath(value) {
  const path = String(value || '/').trim();
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  return path;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function computePkceChallenge(codeVerifier) {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeScope(scope) {
  const requested = String(scope || '').split(/\s+/).filter(Boolean);
  const allowed = requested.filter((entry) => SCOPES.includes(entry));
  return (allowed.length ? allowed : SCOPES).join(' ');
}

function slugName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bigbrain';
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07090d;
      --panel: rgba(18, 22, 31, 0.78);
      --panel-strong: rgba(24, 29, 41, 0.94);
      --line: rgba(148, 163, 184, 0.22);
      --text: #eef2f7;
      --muted: #9aa8bc;
      --accent: #7dd3fc;
      --accent-strong: #38bdf8;
      --danger: #fca5a5;
      --danger-bg: rgba(127, 29, 29, 0.32);
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 32px 18px;
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 20% 12%, rgba(56, 189, 248, 0.16), transparent 32%),
        radial-gradient(circle at 82% 78%, rgba(45, 212, 191, 0.12), transparent 30%),
        linear-gradient(145deg, #05070a 0%, #0a0f18 48%, #090b10 100%);
    }
    .shell {
      width: min(100%, 680px);
      padding: 34px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: linear-gradient(180deg, var(--panel-strong), var(--panel));
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.04);
      backdrop-filter: blur(18px);
    }
    .wide { width: min(100%, 820px); }
    .hero { margin-bottom: 28px; }
    .hero.compact { margin-bottom: 24px; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      margin-bottom: 16px;
      padding: 5px 10px;
      border: 1px solid rgba(125, 211, 252, 0.34);
      border-radius: 999px;
      color: #bae6fd;
      background: rgba(14, 165, 233, 0.12);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0;
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(34px, 8vw, 60px);
      line-height: 1;
      letter-spacing: 0;
    }
    p { margin: 0 0 20px; color: var(--muted); max-width: 58ch; }
    label { display: block; margin: 0; color: #d8e0ec; font-weight: 700; }
    .field-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 20px 0 8px;
    }
    .copy-box {
      width: 100%;
      margin: 0;
      padding: 13px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #e5eefb;
      background: rgba(5, 8, 13, 0.72);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      outline: none;
    }
    .copy-box:focus { border-color: rgba(125, 211, 252, 0.62); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14); }
    .copy-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 12px;
    }
    .copy-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 32px;
      padding: 6px 10px;
      border: 1px solid rgba(125, 211, 252, 0.28);
      border-radius: 8px;
      color: #dff6ff;
      background: rgba(14, 165, 233, 0.11);
      font: inherit;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
    }
    .copy-button:hover { border-color: rgba(125, 211, 252, 0.58); background: rgba(14, 165, 233, 0.18); transform: translateY(-1px); }
    .copy-button:active { transform: translateY(0); }
    .copy-icon {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .toast {
      position: fixed;
      top: 18px;
      left: 50%;
      z-index: 20;
      min-width: min(92vw, 280px);
      padding: 12px 14px;
      border: 1px solid rgba(125, 211, 252, 0.28);
      border-radius: 8px;
      color: #eef2f7;
      background: rgba(15, 23, 42, 0.96);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.34);
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, -14px);
      transition: opacity 180ms ease, transform 180ms ease;
    }
    .toast.visible {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 46px;
      padding: 11px 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      color: #031018;
      background: linear-gradient(135deg, #e0f2fe, var(--accent-strong));
      text-decoration: none;
      font-weight: 800;
      box-shadow: 0 14px 36px rgba(14, 165, 233, 0.22);
    }
    .button:hover { filter: brightness(1.05); }
    .google-mark {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      color: #111827;
      background: rgba(255, 255, 255, 0.86);
      font-weight: 900;
    }
    .muted { margin-top: 16px; color: var(--muted); font-size: 14px; }
    .notice {
      margin: 20px 0 0;
      padding: 11px 13px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: #cbd5e1;
      background: rgba(15, 23, 42, 0.72);
      font-size: 14px;
    }
    .error {
      margin-bottom: 18px;
      border-color: rgba(252, 165, 165, 0.34);
      color: var(--danger);
      background: var(--danger-bg);
    }
    @media (max-width: 560px) {
      body { padding: 18px 12px; align-items: start; }
      .shell { padding: 24px; }
      .button { width: 100%; }
      .field-head { align-items: stretch; flex-direction: column; }
      .copy-actions { justify-content: stretch; }
      .copy-button { width: 100%; }
    }
  </style>
</head>
<body><div class="toast" role="status" aria-live="polite"></div>${body}
<script>
  let toastTimer;
  function showToast(message) {
    const toast = document.querySelector('.toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 1800);
  }

  for (const button of document.querySelectorAll('[data-copy-target]')) {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      if (!target) return;
      const value = 'value' in target ? target.value : target.textContent;
      try {
        await navigator.clipboard.writeText(value);
        showToast('Copied');
      } catch {
        target.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  }
</script></body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
