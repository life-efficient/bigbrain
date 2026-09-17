import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('page image attachments render as an accessible carousel in private and public page views', async () => {
  const [clientSource, dashboardSource, markdownSource] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/markdown.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(clientSource, /function PageImageCarousel\(\{ images, compact = false \}\)/);
  assert.match(clientSource, /aria-roledescription="carousel"/);
  assert.match(clientSource, /aria-label="Previous attached image"/);
  assert.match(clientSource, /aria-label="Next attached image"/);
  assert.match(clientSource, /event\.key === 'ArrowLeft'/);
  assert.match(clientSource, /event\.key === 'ArrowRight'/);
  assert.match(clientSource, /Show attached image/);
  assert.equal((clientSource.match(/<PageImageCarousel images=\{state\.page\.images\} \/>/g) || []).length, 2);
  assert.match(clientSource, /<PageImageCarousel images=\{preview\.images\} compact \/>/);
  assert.match(dashboardSource, /\.page-image-carousel \{/);
  assert.match(dashboardSource, /object-fit: contain/);
  assert.match(dashboardSource, /\.page-image-control-next/);
  assert.match(clientSource, /className="page-image-strip"/);
  assert.match(dashboardSource, /\.page-image-strip \{ display: flex; gap: 8px; height: 112px; overflow-x: auto;/);
  assert.match(dashboardSource, /\.sidecar-document \.markdown-shell img \{ display: block; width: 100%;/);
  assert.match(markdownSource, /@tiptap\/extension-image/);
  assert.match(markdownSource, /function rewriteAttachedImageSources/);
  assert.match(markdownSource, /Image\.configure/);
});
