import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('page image attachments render as an accessible carousel in private and public page views', async () => {
  const [clientSource, dashboardSource, markdownSource] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/markdown.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(clientSource, /function PageImageCarousel\(\{ images, compact = false, onImageOpen \}\)/);
  assert.match(clientSource, /aria-roledescription="carousel"/);
  assert.match(clientSource, /aria-label="Previous attached image"/);
  assert.match(clientSource, /aria-label="Next attached image"/);
  assert.match(clientSource, /event\.key === 'ArrowLeft'/);
  assert.match(clientSource, /event\.key === 'ArrowRight'/);
  assert.match(clientSource, /function PageImageLightbox\(\{ images, activeIndex, onClose, onIndexChange, onOpenPage \}\)/);
  assert.match(clientSource, /function PageContentPreview\(/);
  assert.match(clientSource, /className="page-image-lightbox-overlay"/);
  assert.match(clientSource, /aria-label="Next image"/);
  assert.match(clientSource, /onImageClick=\{setImageViewerIndex\}/);
  assert.match(clientSource, /Show attached image/);
  assert.equal((clientSource.match(/<PageImageCarousel images=\{state\.page\.images\} onImageOpen=\{setImageViewerIndex\} \/>/g) || []).length, 2);
  assert.match(clientSource, /<PageContentPreview\s+markdown=\{preview\.body \|\| preview\.markdown\}/);
  assert.match(clientSource, /<PageContentPreview\s+markdown=\{markdown\}/);
  assert.match(clientSource, /className="explorer-page-preview"/);
  assert.doesNotMatch(clientSource, /explorer-frontmatter|parsed\.frontmatter/);
  assert.match(clientSource, /function PageMetadata\(\{ frontmatter, sourceSlug, onRelativeLinkClick \}\)/);
  assert.match(clientSource, /<PageMetadata\s+frontmatter=\{frontmatter\}\s+sourceSlug=\{sourceSlug\}\s+onRelativeLinkClick=\{onRelativeLinkClick\}\s+\/>/);
  assert.match(clientSource, /const pageMarkdown = stripLeadingMarkdownHeading\(/);
  assert.match(clientSource, /const pageMarkdown = stripLeadingMarkdownHeading\(\s*markdown,/);
  assert.doesNotMatch(clientSource, /stripManagedArticleTimeline/);
  assert.match(clientSource, /function PageSummaryCard\(\{ summary \}\)/);
  assert.match(clientSource, /function PageTimelineCard\(\{ entries \}\)/);
  assert.match(clientSource, /<GraphFlowSourceIcon source=\{\{ type: sourceType, label: sourceLabel \}\} \/>/);
  assert.match(clientSource, /className="sidecar-metadata-list"/);
  assert.match(clientSource, /className="sidecar-metadata-link"/);
  assert.match(clientSource, /https\?:\|mailto:/);
  assert.match(clientSource, /<summary>Metadata<\/summary>/);
  assert.match(dashboardSource, /\.page-image-carousel \{/);
  assert.match(dashboardSource, /object-fit: contain/);
  assert.match(dashboardSource, /\.page-image-control-next/);
  assert.match(dashboardSource, /\.page-image-lightbox-overlay \{/);
  assert.match(dashboardSource, /\.page-image-lightbox-stage \{[^}]*grid-template-columns:/);
  assert.match(dashboardSource, /\.markdown-shell img\.markdown-image-trigger \{ cursor: zoom-in; \}/);
  assert.match(clientSource, /className="page-image-strip"/);
  assert.match(dashboardSource, /\.page-image-strip \{ display: flex; gap: 8px; height: 112px; overflow-x: auto;/);
  assert.match(dashboardSource, /\.sidecar-document \.markdown-shell img \{ display: block; width: 100%;/);
  assert.match(dashboardSource, /: parsed\.compiledTruth;/);
  assert.match(dashboardSource, /timeline_entries: parsed\.timeline_entries/);
  assert.match(dashboardSource, /\.page-timeline-card \{/);
  assert.match(markdownSource, /@tiptap\/extension-image/);
  assert.match(markdownSource, /onImageClick/);
  assert.match(markdownSource, /findAttachedImageIndex/);
  assert.match(markdownSource, /function rewriteAttachedImageSources/);
  assert.match(markdownSource, /onRawLinkClick/);
  assert.match(markdownSource, /function isRelativeRawFileHref/);
  assert.match(markdownSource, /Image\.configure/);
});
