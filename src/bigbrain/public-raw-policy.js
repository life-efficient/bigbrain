import path from 'node:path';

const PUBLIC_RAW_MIME_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
]);

export const PUBLIC_RAW_ALLOWED_EXTENSIONS = [...PUBLIC_RAW_MIME_TYPES.keys()];

export const PUBLIC_RAW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'sandbox',
].join('; ');

export function publicRawMimeTypeForPath(relativePath) {
  return PUBLIC_RAW_MIME_TYPES.get(path.extname(relativePath).toLowerCase()) || null;
}

export function isSafePublicRawPath(relativePath) {
  return publicRawMimeTypeForPath(relativePath) !== null;
}

export function assertSafePublicRawPath(relativePath) {
  if (isSafePublicRawPath(relativePath)) return relativePath;
  throw new Error(`Public raw files may only use these file types: ${PUBLIC_RAW_ALLOWED_EXTENSIONS.join(', ')}.`);
}
