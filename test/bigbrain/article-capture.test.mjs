import test from 'node:test';
import assert from 'node:assert/strict';

import { extractArticleImageCandidates, htmlToFaithfulMarkdown } from '../../src/bigbrain/article-capture.js';

test('article capture preserves meaningful inline images and their position in Markdown', () => {
  const html = [
    '<p>Opening paragraph.</p>',
    '<figure><img src="/images/market-map.webp" alt="AI infrastructure market map" width="1200" height="800"></figure>',
    '<p>Closing paragraph.</p>',
    '<img src="/pixel.gif" width="1" height="1" alt="tracking pixel">',
  ].join('');

  const markdown = htmlToFaithfulMarkdown(html);
  const images = extractArticleImageCandidates(html, 'https://publisher.example/posts/value-chain');

  assert.match(markdown, /Opening paragraph\.[\s\S]*!\[AI infrastructure market map\]\(\/images\/market-map\.webp\)[\s\S]*Closing paragraph\./);
  assert.equal(images.length, 1);
  assert.deepEqual(images[0], {
    url: 'https://publisher.example/images/market-map.webp',
    alt_text: 'AI infrastructure market map',
  });
});
