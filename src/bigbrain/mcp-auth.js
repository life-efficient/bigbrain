import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PROVIDER = 'google';

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
    allowSharedToken: env.BIGBRAIN_MCP_ALLOW_SHARED_TOKEN === '1',
    serviceName: env.BIGBRAIN_MCP_SERVICE_NAME || 'BigBrain MCP',
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
  if (!authConfig.tokenStorePath) throw new Error('BIGBRAIN_MCP_TOKEN_STORE is required for OAuth auth.');
}

export async function createOAuthStart(authConfig) {
  assertOAuthConfigured(authConfig);
  const store = await readTokenStore(authConfig);
  const state = randomToken(24);
  store.states.push({
    state_hash: hashToken(state),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  pruneStore(store);
  await writeTokenStore(authConfig, store);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', authConfig.googleClientId);
  url.searchParams.set('redirect_uri', callbackUrl(authConfig));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
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

  const token = `bbmcp_${randomToken(32)}`;
  const issuedAt = new Date().toISOString();
  store.tokens.push({
    token_hash: hashToken(token),
    email,
    name: profile.name || email,
    provider: 'google',
    created_at: issuedAt,
    last_used_at: null,
    revoked_at: null,
  });
  pruneStore(store);
  await writeTokenStore(authConfig, store);
  return { token, email, name: profile.name || email, created_at: issuedAt };
}

export function renderConnectPage(authConfig, { error = '' } = {}) {
  const title = escapeHtml(authConfig.serviceName);
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const allowlist = [
    ...authConfig.allowedEmails,
    ...authConfig.allowedDomains.map((domain) => `*@${domain}`),
  ].join(', ');
  return htmlPage(title, `
    <main>
      <h1>${title}</h1>
      <p>Sign in to get your personal MCP token for this brain.</p>
      ${errorHtml}
      <a class="button" href="/auth/start">Sign in with Google</a>
      <p class="muted">Access is limited to: ${escapeHtml(allowlist || 'configured team members')}</p>
    </main>
  `);
}

export function renderTokenPage(authConfig, issued) {
  const endpoint = `${authConfig.publicUrl}/mcp`;
  const configSnippet = `[mcp_servers.${slugName(authConfig.serviceName)}]\nurl = "${endpoint}"\nheaders = { Authorization = "Bearer ${issued.token}" }`;
  return htmlPage('Connected', `
    <main>
      <h1>Connected</h1>
      <p>${escapeHtml(issued.email)} can now use ${escapeHtml(authConfig.serviceName)}.</p>
      <label for="token">MCP token</label>
      <textarea id="token" readonly>${escapeHtml(issued.token)}</textarea>
      <label for="config">Codex MCP config</label>
      <textarea id="config" readonly>${escapeHtml(configSnippet)}</textarea>
      <p class="muted">Copy this now. For security, the token is shown only once.</p>
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
  if (!authConfig.tokenStorePath) return { tokens: [], states: [] };
  try {
    const parsed = JSON.parse(await fs.readFile(authConfig.tokenStorePath, 'utf8'));
    return {
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
      states: Array.isArray(parsed.states) ? parsed.states : [],
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { tokens: [], states: [] };
  }
}

async function writeTokenStore(authConfig, store) {
  if (!authConfig.tokenStorePath) return;
  await fs.mkdir(path.dirname(authConfig.tokenStorePath), { recursive: true });
  await fs.writeFile(authConfig.tokenStorePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function pruneStore(store) {
  const now = new Date();
  store.states = store.states.filter((entry) => new Date(entry.expires_at) > now);
}

function bearerToken(request) {
  const authorization = request.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
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
    body { margin: 0; font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; background: #f7f8fa; }
    main { max-width: 720px; margin: 10vh auto; padding: 32px; background: #fff; border: 1px solid #d8dee6; border-radius: 8px; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { margin: 0 0 20px; }
    label { display: block; margin: 20px 0 8px; font-weight: 650; }
    textarea { box-sizing: border-box; width: 100%; min-height: 104px; padding: 12px; border: 1px solid #b7c0ca; border-radius: 6px; font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: #15202b; background: #fbfcfd; }
    .button { display: inline-block; padding: 10px 14px; border-radius: 6px; background: #155eef; color: white; text-decoration: none; font-weight: 650; }
    .muted { color: #5d6b7a; font-size: 14px; }
    .error { padding: 10px 12px; border: 1px solid #f0b8b8; border-radius: 6px; color: #8f1d1d; background: #fff5f5; }
  </style>
</head>
<body>${body}</body>
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
