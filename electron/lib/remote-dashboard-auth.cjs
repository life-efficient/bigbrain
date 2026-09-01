const fs = require('fs').promises;
const os = require('os');
const path = require('path');

async function findRemoteDashboardTokenPath(serviceUrl, { env = process.env, home = env.HOME || os.homedir(), fsImpl = fs } = {}) {
  const endpoint = normalizeMcpEndpoint(serviceUrl);
  const configDir = path.resolve(env.BIGBRAIN_CONFIG_DIR || path.join(home, '.config', 'bigbrain'));
  const catalogPath = path.resolve(env.BIGBRAIN_CATALOG_PATH || path.join(configDir, 'brains.json'));
  let catalog;
  try {
    catalog = JSON.parse(await fsImpl.readFile(catalogPath, 'utf8'));
  } catch {
    return null;
  }

  const match = (catalog?.brains || []).find((brain) =>
    brain?.connection?.type === 'codex_mcp'
    && normalizeMcpEndpoint(brain.connection.endpoint) === endpoint
    && isSafeHandle(brain.connection.handle));
  if (!match) return null;

  const tokenPath = path.join(configDir, 'connections', match.connection.handle, 'token');
  try {
    const stat = await fsImpl.stat(tokenPath);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return null;
    if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) return null;
    return tokenPath;
  } catch {
    return null;
  }
}

async function readProtectedDashboardToken(tokenPath, { fsImpl = fs } = {}) {
  const stat = await fsImpl.stat(tokenPath);
  if (!stat.isFile()) throw new Error('The dashboard credential path must identify a regular file.');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('The dashboard credential file must not be accessible by group or other users.');
  }
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('The dashboard credential file must be owned by the current user.');
  }
  const token = String(await fsImpl.readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error('The dashboard credential file is empty.');
  if (/\r|\n/.test(token)) throw new Error('The dashboard credential file must contain exactly one token.');
  return token;
}

function dashboardBasicAuthorization(token) {
  return `Basic ${Buffer.from(`bigbrain:${token}`).toString('base64')}`;
}

function normalizeMcpEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.search = '';
    url.hash = '';
    let pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/mcp')) pathname = `${pathname}/mcp`;
    url.pathname = pathname || '/mcp';
    return url.toString();
  } catch {
    return '';
  }
}

function isSafeHandle(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

module.exports = {
  dashboardBasicAuthorization,
  findRemoteDashboardTokenPath,
  normalizeMcpEndpoint,
  readProtectedDashboardToken,
};
