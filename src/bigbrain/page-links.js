import path from 'node:path';

import { assertAllowedPagePath } from './page-ops.js';

export const CANONICAL_PAGE_ROUTE = '/dashboard/page';
export const LOCAL_PAGE_LINK_HOST = '127.0.0.1';
export const LOCAL_PAGE_LINK_PORT = 55559;
export const LOCAL_PAGE_LINK_ORIGIN = `http://${LOCAL_PAGE_LINK_HOST}:${LOCAL_PAGE_LINK_PORT}`;

const BRAIN_ID_PATTERN = /^brn_[0-9a-f-]{36}$/i;

export function normalizeCanonicalPageSlug(input) {
  const value = String(input || '').trim();
  if (!value || value.includes('\0') || value.includes('\\') || value.includes('?') || value.includes('#')) {
    throw new Error('Invalid canonical page slug.');
  }
  if (value.startsWith('/') || value.endsWith('/') || value.includes('%')) {
    throw new Error('Invalid canonical page slug.');
  }
  const withoutExtension = value.replace(/\.md$/i, '');
  const parts = withoutExtension.split('/');
  if (parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid canonical page slug.');
  }
  const normalized = path.posix.normalize(withoutExtension);
  if (normalized !== withoutExtension) throw new Error('Invalid canonical page slug.');
  assertAllowedPagePath(`${normalized}.md`);
  return normalized;
}

export function requireCanonicalBrainId(input) {
  const value = String(input || '').trim();
  if (!BRAIN_ID_PATTERN.test(value)) throw new Error('Invalid canonical brain ID.');
  return value;
}

export function canonicalPagePath(brainId, slug, { basePath = '/dashboard' } = {}) {
  const canonicalBrainId = requireCanonicalBrainId(brainId);
  const canonicalSlug = normalizeCanonicalPageSlug(slug);
  const prefix = normalizeBasePath(basePath);
  const encodedSlug = canonicalSlug.split('/').map(encodeURIComponent).join('/');
  return `${prefix}/page/${encodeURIComponent(canonicalBrainId)}/${encodedSlug}`;
}

export function canonicalPageUrl(origin, brainId, slug, options = {}) {
  const normalizedOrigin = requireHttpOrigin(origin);
  return new URL(canonicalPagePath(brainId, slug, options), `${normalizedOrigin}/`).toString();
}

export function localPageUrl(brainId, slug, { origin = LOCAL_PAGE_LINK_ORIGIN } = {}) {
  return canonicalPageUrl(origin, brainId, slug, { basePath: '' });
}

export function parseCanonicalPagePath(pathname, { basePath = '/dashboard' } = {}) {
  const prefix = `${normalizeBasePath(basePath)}/page/`;
  if (!String(pathname || '').startsWith(prefix)) return null;
  const rawParts = String(pathname).slice(prefix.length).split('/');
  if (rawParts.length < 3) throw new Error('Malformed canonical page route.');
  const parts = rawParts.map(decodeRouteSegment);
  return {
    brainId: requireCanonicalBrainId(parts[0]),
    slug: normalizeCanonicalPageSlug(parts.slice(1).join('/')),
  };
}

export function isLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function decodeRouteSegment(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error('Malformed canonical page route.');
  }
  if (!decoded || decoded.includes('/') || decoded.includes('\\') || decoded.includes('%') || decoded.includes('\0')) {
    throw new Error('Malformed canonical page route.');
  }
  return decoded;
}

function normalizeBasePath(basePath) {
  const value = String(basePath || '').trim().replace(/\/+$/, '');
  if (!value || value === '/') return '';
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) throw new Error('Invalid dashboard base path.');
  return value;
}

function requireHttpOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(String(origin || ''));
  } catch {
    throw new Error('Invalid page URL origin.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Invalid page URL origin.');
  }
  return parsed.origin;
}
