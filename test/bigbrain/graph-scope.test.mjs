import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { graphNodeDomains, graphNodeMatchesFilters } from '../../src/dashboard-client/graph/scope.js';
import { nextGraphDomainFilter } from '../../src/dashboard-client/graph/style-shortcuts.js';

const node = { slug: 'projects/shared', type: 'projects', domains: ['research', 'work'] };

test('graph domain and collection scopes independently intersect with page type filters', () => {
  const none = new Set();
  const projects = new Set(['projects']);
  const people = new Set(['people']);
  const work = new Set(['work']);
  const personal = new Set(['personal']);
  const collection = new Set(['projects/shared', 'people/another']);
  const otherCollection = new Set(['projects/another']);

  assert.deepEqual(graphNodeDomains(node), ['research', 'work']);
  assert.deepEqual(graphNodeDomains({ slug: 'without-domains' }), []);
  assert.equal(graphNodeMatchesFilters(node, none, none, null), true, 'all scopes include every page');
  assert.equal(graphNodeMatchesFilters(node, projects, work, collection), true);
  assert.equal(graphNodeMatchesFilters(node, projects, personal, collection), false, 'domain selection still applies');
  assert.equal(graphNodeMatchesFilters(node, projects, work, otherCollection), false, 'collection membership still applies');
  assert.equal(graphNodeMatchesFilters(node, people, work, collection), false, 'page type selection still applies');
  assert.equal(graphNodeMatchesFilters(node, none, none, new Set()), false, 'an empty collection shows no pages');
  assert.equal(graphNodeMatchesFilters(null, none, none, null), false);
});

test('D domain cycle can change domain scope without changing collection selection', () => {
  const domains = ['research', 'work'];
  const selectedCollectionSlugs = new Set(['projects/shared']);
  let selectedDomains = [];
  selectedDomains = nextGraphDomainFilter(selectedDomains, domains);
  assert.deepEqual(selectedDomains, ['research']);
  assert.equal(graphNodeMatchesFilters(node, new Set(), new Set(selectedDomains), selectedCollectionSlugs), true);
  selectedDomains = nextGraphDomainFilter(selectedDomains, domains);
  assert.deepEqual(selectedDomains, ['work']);
  assert.equal(graphNodeMatchesFilters(node, new Set(), new Set(selectedDomains), selectedCollectionSlugs), true);
  assert.deepEqual([...selectedCollectionSlugs], ['projects/shared']);
});

test('graph scope controls expose defaults next to edge count and keep D synchronized with domain selection', async () => {
  const [main, dashboard] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
  ]);
  const footer = main.slice(main.indexOf('<div className="graph-footer">'), main.indexOf('<div className="graph-toolbar">'));
  const filters = main.slice(main.indexOf('<div className="graph-toolbar">'), main.indexOf('<div className="graph-style-menu-shell"'));
  assert.match(footer, /<\/strong> edges<\/span>/);
  assert.match(footer, /All domains/);
  assert.match(footer, /All collections/);
  assert.match(footer, /aria-expanded=\{domainMenuOpen\}/);
  assert.match(footer, /aria-expanded=\{collectionMenuOpen\}/);
  assert.match(footer, /role="menu" aria-label="Domain scope"[\s\S]*?setSelectedDomains\(\[domain\]\)/);
  assert.match(footer, /role="menu" aria-label="Collection scope"[\s\S]*?setSelectedCollectionId\(collection\.id\)/);
  const collectionMenu = footer.match(/<div className="graph-filter-menu graph-scope-menu" role="menu" aria-label="Collection scope">[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(collectionMenu, /collections\.map\(\(collection\) =>/);
  assert.match(collectionMenu, /collections\.length === 0 \? <div className="graph-scope-empty" aria-disabled="true">No collections yet<\/div>/);
  assert.doesNotMatch(collectionMenu, /pageTypes|selectedPageTypes|graphNodeDomains/);
  assert.match(footer, /graph-filter-menu graph-scope-menu/g);
  assert.match(footer, /menu-item-check/);
  assert.match(footer, /selectedDomains\.length \? domainLabels\.get\(selectedDomains\[0\]\)/);
  assert.match(footer, /selectedCollection\?\.title \|\| 'All collections'/);
  assert.doesNotMatch(filters, /Domains|All domains|Collections|All collections/);
  assert.match(main, /key === 'd'[\s\S]*?setSelectedDomains\(\(current\) => nextGraphDomainFilter\(current, domains\)\)/);
  assert.equal(main.match(/graphNodeMatchesFilters\(node, selectedTypeSet, selectedDomainSet, selectedCollectionSlugs\)/g)?.length, 3);
  assert.doesNotMatch(main, /key === ['"](?:g|k)['"][\s\S]{0,120}setSelectedCollection/);
  assert.match(main, /className="icon-button graph-icon-button"[\s\S]*?aria-label=\{control === 'resetView' \? 'Fit graph to view'/);
  assert.match(main, /control === 'resetView' \? <FitViewIcon \/>/);
  assert.match(main, /function FitViewIcon\(\)/);
  assert.match(dashboard, /\.graph-stats \{[^}]*align-items: center; flex-wrap: nowrap;/);
  assert.match(dashboard, /\.graph-scope-trigger \{[^}]*min-height: 32px;/);
});
