export function resolveExplorerLinkPath(currentFilePath, href) {
  if (!currentFilePath || !href || !isRelativeExplorerHref(href)) return null;
  const target = href.split('#')[0].trim();
  if (!target) return null;
  const currentDir = dirname(currentFilePath);
  const resolved = normalizePath(joinPath(currentDir, target));
  if (!resolved || resolved.startsWith('../') || resolved === '..') return null;
  return normalizeExplorerTargetPath(resolved);
}

function isRelativeExplorerHref(href) {
  return !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href);
}

function dirname(filePath) {
  const normalized = normalizePath(filePath);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function joinPath(left, right) {
  return left ? `${left}/${right}` : right;
}

function normalizePath(input) {
  const parts = [];
  for (const rawPart of String(input || '').replace(/\\/g, '/').split('/')) {
    const part = rawPart.trim();
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return '../';
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function normalizeExplorerTargetPath(value) {
  const normalizedMarkdown = value.replace(/\.(?:md|markdown)$/i, '.md');
  const basename = normalizedMarkdown.split('/').pop() || '';
  return basename.includes('.') ? normalizedMarkdown : `${normalizedMarkdown}.md`;
}
