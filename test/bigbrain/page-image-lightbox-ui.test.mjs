import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const clientUrl = new URL('../../src/dashboard-client/main.jsx', import.meta.url);
const dashboardUrl = new URL('../../src/bigbrain/dashboard.js', import.meta.url);

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

test('shared image lightbox keeps navigation outside image pixels in a rounded borderless modal', async () => {
  const [client, dashboard] = await Promise.all([
    fs.readFile(clientUrl, 'utf8'),
    fs.readFile(dashboardUrl, 'utf8'),
  ]);
  const lightbox = client.slice(client.indexOf('function PageImageLightbox('), client.indexOf('function PrivatePageBackLink('));
  const stage = lightbox.slice(lightbox.indexOf('className="page-image-lightbox-stage"'), lightbox.indexOf('className="page-image-lightbox-caption"'));
  const stageCss = rule(dashboard, '.page-image-lightbox-stage');
  const controlCss = rule(dashboard, '.page-image-lightbox-control');
  const modalCss = rule(dashboard, '.page-image-lightbox');

  assert.match(stage, /page-image-lightbox-control-previous[\s\S]*<img[\s\S]*page-image-lightbox-control-next/);
  assert.match(stageCss, /display:\s*grid/);
  assert.match(stageCss, /grid-template-columns:\s*[^;]*\b(?:auto|\d+px|\d+rem)\b[^;]*minmax\(0,\s*1fr\)[^;]*\b(?:auto|\d+px|\d+rem)\b/);
  assert.doesNotMatch(controlCss, /position:\s*absolute/);
  assert.match(modalCss, /border:\s*(?:0|none)\s*;/);
  assert.match(modalCss, /border-radius:\s*(?!0(?:px|rem)?\s*;)[^;]+;/);
  assert.match(rule(dashboard, '.page-image-lightbox-stage img'), /object-fit:\s*contain/);
});

test('shared lightbox retains keyboard and labeled controls, with a Recents-only Open page action', async () => {
  const client = await fs.readFile(clientUrl, 'utf8');
  const lightbox = client.slice(client.indexOf('function PageImageLightbox('), client.indexOf('function PrivatePageBackLink('));
  const recents = client.slice(client.indexOf('function RecentsPanel('), client.indexOf('function recentDateGroupLabel('));

  assert.match(lightbox, /role="dialog"/);
  assert.match(lightbox, /aria-modal="true"/);
  assert.match(lightbox, /aria-label="Close image viewer"/);
  assert.match(lightbox, /aria-label="Previous image"/);
  assert.match(lightbox, /aria-label="Next image"/);
  assert.match(lightbox, /event\.key === 'Escape'/);
  assert.match(lightbox, /'ArrowLeft', 'ArrowRight'/);
  assert.match(lightbox, /onOpenPage && activeItem\.page_slug/);
  assert.match(lightbox, /Open page/);
  assert.match(recents, /const galleryImages = galleryItems\.map\(\(item\) => \(\{[\s\S]*?page_slug:\s*item\.slug/);
  assert.match(recents, /<PageImageLightbox[\s\S]*?onOpenPage=\{/);
});

test('shared lightbox zooms on Command-scroll and pans zoomed images with ordinary scrolling', async () => {
  const [client, dashboard] = await Promise.all([
    fs.readFile(clientUrl, 'utf8'),
    fs.readFile(dashboardUrl, 'utf8'),
  ]);
  const lightbox = client.slice(client.indexOf('function PageImageLightbox('), client.indexOf('function PrivatePageBackLink('));

  assert.match(lightbox, /const \[zoom, setZoom\] = useState\(1\)/);
  assert.match(lightbox, /if \(!event\.metaKey\) return;/);
  assert.match(lightbox, /event\.preventDefault\(\)/);
  assert.match(lightbox, /Math\.min\(5, Math\.max\(1,/);
  assert.match(lightbox, /onWheel=\{handleImageWheel\}/);
  assert.match(lightbox, /page-image-lightbox-image-canvas/);
  assert.match(rule(dashboard, '.page-image-lightbox-image'), /overflow:\s*auto/);
  assert.match(rule(dashboard, '.page-image-lightbox-image-canvas'), /min-width:\s*100%/);
});
