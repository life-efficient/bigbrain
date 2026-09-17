import { createHash } from 'node:crypto';

export function articleSlug(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  if (!slug) throw new Error('Article title must produce a non-empty slug.');
  return slug;
}

export function extractArticleHtml(html) {
  const marker = '<div dir="auto" class="body markup">';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Publisher page did not expose a readable article body.');
  let index = start;
  let depth = 0;
  while (index < html.length) {
    const opening = html.indexOf('<div', index);
    const closing = html.indexOf('</div', index);
    if (opening < 0 && closing < 0) break;
    if (opening >= 0 && (closing < 0 || opening < closing)) {
      depth += 1;
      index = html.indexOf('>', opening) + 1;
    } else {
      depth -= 1;
      index = html.indexOf('>', closing) + 1;
      if (depth === 0) return html.slice(start, index);
    }
  }
  throw new Error('Publisher article body was incomplete.');
}

export function htmlToFaithfulMarkdown(articleHtml) {
  return articleHtml
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n\n${'#'.repeat(Number(level) + 1)} ${text}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(?:li|p)>|<br\s*\/?>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/^\s*-\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fetchArticleCapture(canonicalUrl) {
  const response = await fetch(canonicalUrl, { headers: { 'user-agent': 'BigBrain article capture/1.0' } });
  if (!response.ok) throw new Error(`Publisher returned ${response.status} while fetching the article.`);
  const html = await response.text();
  const transcript = htmlToFaithfulMarkdown(extractArticleHtml(html));
  if (transcript.split(/\s+/).length < 100) throw new Error('Extracted article transcript is too short to be a full capture.');
  return {
    html,
    transcript,
    word_count: transcript.split(/\s+/).filter(Boolean).length,
    html_sha256: createHash('sha256').update(html).digest('hex'),
    transcript_sha256: createHash('sha256').update(transcript).digest('hex'),
  };
}
