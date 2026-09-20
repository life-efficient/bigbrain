import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Recents images open the shared lightbox across the filtered gallery, not the sidecar', async () => {
  const source = await fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8');
  const panel = source.slice(source.indexOf('function RecentsPanel('), source.indexOf('function recentDateGroupLabel('));
  const lightbox = source.slice(source.indexOf('function PageImageLightbox('), source.indexOf('function PrivatePageBackLink('));

  assert.match(panel, /const galleryItems = kind === 'images' \? result\.items\.filter\(\(item\) => item\.image\?\.url\) : \[\]/);
  assert.match(panel, /const galleryImages = galleryItems\.map\(\(item\) => \(\{/);
  assert.match(panel, /setImageViewerIndex\(galleryIndexByItem\.get\(item\) \?\? null\);\s+return;\s+}\s+await onOpenPage\(item\.slug\)/);
  assert.match(panel, /<PageImageLightbox\s+images=\{galleryImages\}\s+activeIndex=\{imageViewerIndex\}/);
  assert.match(panel, /kind === 'images' \? \(\s+<span className="recents-thumbnail">/);
  assert.match(panel, /\) : \(\s+<>\s+<span className="recents-page-glyph"/);
  assert.match(lightbox, /aria-label="Close image viewer"/);
  assert.match(lightbox, /aria-label="Previous image"/);
  assert.match(lightbox, /aria-label="Next image"/);
  assert.match(lightbox, /'ArrowLeft', 'ArrowRight'/);
});
