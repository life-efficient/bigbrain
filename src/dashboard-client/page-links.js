const BRAIN_ID_PATTERN = /^brn_[0-9a-f-]{36}$/i;

export function privatePageRouteFromPath(pathname) {
  const match = String(pathname || '').match(/^(?:\/dashboard)?\/page\/([^/]+)\/(.+)$/);
  if (!match) return null;
  try {
    const brainId = decodeSegment(match[1]);
    const slug = match[2].split('/').map(decodeSegment).join('/');
    if (!BRAIN_ID_PATTERN.test(brainId) || !isCanonicalSlug(slug)) return null;
    return { brainId, slug };
  } catch {
    return null;
  }
}

export function privatePageHrefFromMarkdown({ pathname, brainId, sourceSlug, href }) {
  if (!BRAIN_ID_PATTERN.test(String(brainId || '')) || !isCanonicalSlug(sourceSlug)) return null;
  const target = String(href || '').trim();
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return null;

  const hashIndex = target.indexOf('#');
  const targetPath = (hashIndex >= 0 ? target.slice(0, hashIndex) : target).trim();
  const anchor = hashIndex >= 0 ? target.slice(hashIndex) : '';
  if (!targetPath || targetPath.includes('?') || !isMarkdownPageTarget(targetPath)) return null;

  const withoutExtension = targetPath.replace(/\.md$/i, '');
  const targetParts = withoutExtension.split('/');
  const isRootSlug = looksCanonicalSlug(withoutExtension);
  const resolved = isRootSlug ? [] : sourceSlug.split('/').slice(0, -1);
  for (const part of targetParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!resolved.length) return null;
      resolved.pop();
      continue;
    }
    if (!/^[a-z0-9_-]+$/i.test(part)) return null;
    resolved.push(part);
  }
  const slug = resolved.join('/');
  if (!isCanonicalSlug(slug)) return null;

  const basePath = String(pathname || '').startsWith('/dashboard/page/') ? '/dashboard' : '';
  const encodedSlug = resolved.map((part) => encodeURIComponent(part)).join('/');
  return `${basePath}/page/${encodeURIComponent(brainId)}/${encodedSlug}${anchor}`;
}

function decodeSegment(value) {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.includes('/') || decoded.includes('\\') || decoded.includes('%') || decoded.includes('\0')) {
    throw new Error('Invalid route segment.');
  }
  return decoded;
}

function isCanonicalSlug(slug) {
  const parts = String(slug || '').split('/');
  return parts.length >= 2 && parts.every((part) => part && part !== '.' && part !== '..');
}

function isMarkdownPageTarget(target) {
  const basename = target.split('/').pop() || '';
  return !basename.includes('.') || /\.md$/i.test(basename);
}

function looksCanonicalSlug(value) {
  const parts = String(value || '').split('/');
  return parts.length >= 2
    && parts.every((part) => /^[a-z0-9_-]+$/i.test(part));
}
