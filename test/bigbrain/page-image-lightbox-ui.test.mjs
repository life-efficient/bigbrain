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
  const stage = lightbox.slice(lightbox.indexOf('page-image-lightbox-stage'), lightbox.indexOf('className="page-image-lightbox-caption"'));
  const stageCss = rule(dashboard, '.page-image-lightbox-stage');
  const controlCss = rule(dashboard, '.page-image-lightbox-control');
  const modalCss = rule(dashboard, '.page-image-lightbox');
  const overlayCss = rule(dashboard, '.page-image-lightbox-overlay');

  assert.match(stage, /page-image-lightbox-control-previous[\s\S]*<img[\s\S]*page-image-lightbox-control-next/);
  assert.match(stageCss, /display:\s*grid/);
  assert.match(stageCss, /grid-template-columns:\s*[^;]*\b(?:auto|\d+px|\d+rem)\b[^;]*minmax\(0,\s*1fr\)[^;]*\b(?:auto|\d+px|\d+rem)\b/);
  assert.match(rule(dashboard, '.page-image-lightbox-stage.is-comparing'), /grid-template-columns:\s*48px\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s+48px/);
  assert.doesNotMatch(controlCss, /position:\s*absolute/);
  assert.match(modalCss, /border:\s*(?:0|none)\s*;/);
  assert.match(modalCss, /border-radius:\s*(?!0(?:px|rem)?\s*;)[^;]+;/);
  assert.match(modalCss, /width:\s*calc\(100vw - 16px\)/);
  assert.match(modalCss, /height:\s*calc\(100vh - 16px\)/);
  assert.match(overlayCss, /padding:\s*8px/);
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
  assert.match(lightbox, /if \(event\.metaKey\) \{/);
  assert.match(lightbox, /event\.preventDefault\(\)/);
  assert.match(lightbox, /Math\.min\(5, Math\.max\(1,/);
  assert.match(lightbox, /const viewportX = event\.clientX - bounds\.left/);
  assert.match(lightbox, /imageX: \(viewport\.scrollLeft \+ viewportX\) \/ zoom/);
  assert.match(lightbox, /anchor\.viewport\.scrollLeft = anchor\.imageX \* zoom - anchor\.viewportX/);
  assert.match(lightbox, /onWheel=\{handleImageWheel\}/);
  assert.match(lightbox, /event\.currentTarget\.scrollBy\(\{ left: event\.deltaX, top: event\.deltaY \}\)/);
  assert.match(lightbox, /onPointerDown=\{handleImagePointerDown\}/);
  assert.match(lightbox, /onPointerMove=\{handleImagePointerMove\}/);
  assert.match(lightbox, /setPointerCapture\(event\.pointerId\)/);
  assert.match(lightbox, /draggable="false"/);
  assert.match(lightbox, /page-image-lightbox-image-canvas/);
  assert.match(rule(dashboard, '.page-image-lightbox-image'), /overflow:\s*auto/);
  assert.match(rule(dashboard, '.page-image-lightbox-image\.is-panning'), /cursor:\s*grabbing/);
  assert.match(rule(dashboard, '.page-image-lightbox-image-canvas'), /min-width:\s*100%/);
});

test('shared lightbox can select another image for a side-by-side comparison', async () => {
  const [client, dashboard] = await Promise.all([
    fs.readFile(clientUrl, 'utf8'),
    fs.readFile(dashboardUrl, 'utf8'),
  ]);
  const lightbox = client.slice(client.indexOf('function PageImageLightbox('), client.indexOf('function PrivatePageBackLink('));

  assert.match(lightbox, /const \[compareIndex, setCompareIndex\] = useState\(null\)/);
  assert.match(lightbox, /Compare/);
  assert.match(lightbox, /aria-controls="page-image-lightbox-compare-picker"/);
  assert.match(lightbox, /if \(index === safeActiveIndex\) return null/);
  assert.match(lightbox, /<ComparisonImageViewport/);
  assert.match(lightbox, /page-image-lightbox-stage\$\{comparisonItem \? ' is-comparing' : ''\}/);
  assert.match(rule(dashboard, '.page-image-lightbox-compare-picker'), /position:\s*absolute/);
  assert.match(rule(dashboard, '.page-image-lightbox-compare-option'), /grid-template-columns:\s*64px/);
});
