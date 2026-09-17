import { createHash } from 'node:crypto';

const MAX_ARTICLE_IMAGES = 24;
const MAX_ARTICLE_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);

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
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const source = imageSourceFromTag(tag);
      if (!source) return '';
      const alt = markdownText(attributeValue(tag, 'alt') || '');
      return `\n\n![${alt}](${source})\n\n`;
    })
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

export function extractArticleImageCandidates(articleHtml, canonicalUrl) {
  const seen = new Set();
  const images = [];
  for (const match of String(articleHtml || '').matchAll(/<img\b[^>]*>/gi)) {
    if (images.length >= MAX_ARTICLE_IMAGES) break;
    const tag = match[0];
    const source = imageSourceFromTag(tag);
    if (!source) continue;
    let url;
    try {
      url = new URL(source, canonicalUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) continue;
    const width = Number(attributeValue(tag, 'width'));
    const height = Number(attributeValue(tag, 'height'));
    if ((width && width < 40) || (height && height < 40)) continue;
    seen.add(url.href);
    images.push({ url: url.href, alt_text: markdownText(attributeValue(tag, 'alt') || '') });
  }
  return images;
}

export async function fetchArticleImages(candidates) {
  const downloaded = [];
  for (const candidate of candidates || []) {
    try {
      const response = await fetch(candidate.url, { headers: { 'user-agent': 'BigBrain article capture/1.0' } });
      const mimeType = String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
      const extension = IMAGE_EXTENSIONS.get(mimeType);
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !extension || (contentLength && contentLength > MAX_ARTICLE_IMAGE_BYTES)) continue;
      const content = Buffer.from(await response.arrayBuffer());
      if (!content.length || content.length > MAX_ARTICLE_IMAGE_BYTES) continue;
      downloaded.push({ ...candidate, content, mime_type: mimeType, extension });
    } catch {
      // A missing image should not prevent a readable source article from being saved.
    }
  }
  return downloaded;
}

export async function fetchArticleCapture(canonicalUrl) {
  const response = await fetch(canonicalUrl, { headers: { 'user-agent': 'BigBrain article capture/1.0' } });
  if (!response.ok) throw new Error(`Publisher returned ${response.status} while fetching the article.`);
  const html = await response.text();
  const articleHtml = extractArticleHtml(html);
  const transcript = htmlToFaithfulMarkdown(articleHtml);
  if (transcript.split(/\s+/).length < 100) throw new Error('Extracted article transcript is too short to be a full capture.');
  return {
    html,
    transcript,
    images: await fetchArticleImages(extractArticleImageCandidates(articleHtml, canonicalUrl)),
    word_count: transcript.split(/\s+/).filter(Boolean).length,
    html_sha256: createHash('sha256').update(html).digest('hex'),
    transcript_sha256: createHash('sha256').update(transcript).digest('hex'),
  };
}

function attributeValue(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function imageSourceFromTag(tag) {
  return attributeValue(tag, 'src') || attributeValue(tag, 'data-src') || attributeValue(tag, 'data-original');
}

function markdownText(value) {
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\[\]]/g, '\\$&')
    .trim();
}
