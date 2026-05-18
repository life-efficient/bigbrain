import path from 'node:path';

export function slugFromPath(brainDir, fullPath) {
  const relative = toPosix(path.relative(brainDir, fullPath));
  return relative.replace(/\.md$/i, '');
}

export function fullPathFromSlug(brainDir, slug) {
  return path.join(brainDir, `${slug}.md`);
}

export function inferTypeFromSlug(slug) {
  return slug.split('/')[0] || 'unknown';
}

export function parseMarkdownPage(markdown, slug) {
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(markdown);
  const separator = '\n---\n';
  const separatorIndex = body.indexOf(separator);
  const hasSeparator = separatorIndex >= 0;
  const compiledTruth = hasSeparator ? body.slice(0, separatorIndex).trim() : body.trim();
  const timeline = hasSeparator ? body.slice(separatorIndex + separator.length).trim() : '';
  const title = extractTitle(frontmatter, body, slug);
  return {
    slug,
    type: inferTypeFromSlug(slug),
    title,
    frontmatter,
    hasFrontmatter,
    hasSeparator,
    compiledTruth,
    timeline,
    bodyMarkdown: markdown,
    bodyText: stripMarkdown(body),
    summary: extractSummary(compiledTruth),
  };
}

export function extractLinks(markdown, currentSlug) {
  const links = [];
  const currentDir = path.posix.dirname(currentSlug);
  for (const match of markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const [, label, target] = match;
    const resolved = resolveLinkTarget(target, currentDir);
    if (!resolved) continue;
    links.push({ linkText: label.trim(), targetRaw: target.trim(), toSlug: resolved, kind: 'markdown' });
  }
  for (const match of markdown.matchAll(/\[\[([^[\]]+)\]\]/g)) {
    const target = match[1].trim().split('|')[0].trim();
    const resolved = resolveWikiTarget(target);
    if (!resolved) continue;
    links.push({ linkText: target, targetRaw: target, toSlug: resolved, kind: 'wikilink' });
  }
  return dedupeLinks(links);
}

export function rewriteSlugLinksToRelative(markdown, currentSlug) {
  const currentDir = path.posix.dirname(currentSlug);
  return markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, target) => {
      const trimmed = target.trim();
      if (!looksCanonicalSlug(trimmed)) return full;
      return `[${label}](${relativeMarkdownTarget(currentDir, trimmed)})`;
    })
    .replace(/\[\[([^[\]]+)\]\]/g, (full, target) => {
      const trimmed = target.trim().split('|')[0].trim();
      if (!looksCanonicalSlug(trimmed)) return full;
      return `[${trimmed}](${relativeMarkdownTarget(currentDir, trimmed)})`;
    });
}

export function relativeMarkdownTarget(fromDir, targetSlug) {
  const relative = path.posix.relative(fromDir, `${targetSlug}.md`);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return { frontmatter: {}, body: markdown, hasFrontmatter: false };
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) return { frontmatter: {}, body: markdown, hasFrontmatter: false };
  return {
    frontmatter: parseSimpleYaml(markdown.slice(4, end)),
    body: markdown.slice(end + 5),
    hasFrontmatter: true,
  };
}

function parseSimpleYaml(raw) {
  const result = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf(':');
    if (index <= 0) continue;
    result[trimmed.slice(0, index).trim()] = parseYamlValue(trimmed.slice(index + 1).trim());
  }
  return result;
}

function parseYamlValue(value) {
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean);
  }
  return value;
}

function extractTitle(frontmatter, body, slug) {
  if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) return frontmatter.title.trim();
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return slug.split('/').pop()?.replace(/-/g, ' ') || slug;
}

function extractSummary(compiledTruth) {
  return compiledTruth.split('\n').map((line) => line.trim()).find(Boolean) || '';
}

function stripMarkdown(value) {
  return value
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\[\[([^[\]]+)\]\]/g, '$1')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveLinkTarget(target, currentDir) {
  if (!target || /^(https?:|mailto:|#)/i.test(target)) return null;
  const withoutAnchor = target.split('#')[0].trim();
  if (!withoutAnchor) return null;
  if (looksCanonicalSlug(withoutAnchor)) return stripMarkdownExtension(normalizeSlug(withoutAnchor));
  const resolved = path.posix.normalize(path.posix.join(currentDir, withoutAnchor));
  return stripMarkdownExtension(stripLeadingCurrentDir(resolved));
}

function resolveWikiTarget(target) {
  if (!looksCanonicalSlug(target)) return null;
  return stripMarkdownExtension(normalizeSlug(target));
}

function looksCanonicalSlug(value) {
  return /^[a-z0-9_-]+\/[a-z0-9_./-]+$/i.test(value) && !value.startsWith('../');
}

function normalizeSlug(value) {
  return value.replace(/^\/+/, '');
}

function stripLeadingCurrentDir(value) {
  return value.replace(/^\.\/+/, '');
}

function stripMarkdownExtension(value) {
  return value.replace(/\.md$/i, '');
}

function dedupeLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    const key = `${link.kind}:${link.toSlug}:${link.linkText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}
