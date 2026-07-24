const BRAIN_ID_PATTERN = /^brn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
