export function buildFullDocumentEmbeddingInput(page) {
  const title = String(page?.title || page?.slug || '').trim();
  const aliases = normalizeEmbeddingAliases(page?.frontmatter?.aliases);
  const body = normalizeEmbeddingBody(page?.bodyContentMarkdown);
  return [
    `Title: ${title || 'Untitled'}`,
    aliases.length > 0 ? `Aliases: ${aliases.join(', ')}` : null,
    `Content:\n${body || title || page?.slug || 'Untitled'}`,
  ].filter(Boolean).join('\n\n');
}

function normalizeEmbeddingAliases(value) {
  const aliases = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(aliases.map((alias) => String(alias).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeEmbeddingBody(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*<!--\s*bigbrain:timeline\b[\s\S]*?-->[ \t]*(?:\n|$)/gim, '')
    .trim();
}
