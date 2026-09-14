import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPH_DOMAIN_UNASSIGNED_COLOR,
  getGraphColorPalette,
  getGraphDomainColor,
  getGraphNodeColor,
  isGraphHexColor,
} from '../../src/dashboard-client/graph/colors.js';

test('domain colors are stable across nodes, filtering, and membership ordering', () => {
  const palette = getGraphColorPalette('crimson-loom');
  const infrastructure = getGraphDomainColor('ai-infrastructure', palette);
  const equity = getGraphDomainColor('private-equity', palette);
  assert.ok(isGraphHexColor(infrastructure));
  assert.notEqual(infrastructure, equity);
  assert.equal(getGraphNodeColor({ domains: ['ai-infrastructure'], type: 'people' }, 'domain', palette), infrastructure);
  assert.equal(getGraphNodeColor({ domains: ['ai-infrastructure'], type: 'projects' }, 'domain', palette), infrastructure);
  const before = getGraphNodeColor({ domains: ['ai-infrastructure', 'private-equity'] }, 'domain', palette);
  getGraphDomainColor('newly-visible-domain', palette);
  assert.equal(getGraphDomainColor('ai-infrastructure', palette), infrastructure);
  assert.equal(getGraphNodeColor({ domains: ['private-equity', 'ai-infrastructure'] }, 'domain', palette), before);
});

test('multiple memberships contribute equally to the displayed color', () => {
  const domains = ['ai-infrastructure', 'private-equity', 'dealmaking'];
  const colors = domains.map((domain) => getGraphDomainColor(domain));
  const expected = `#${[1, 3, 5].map((offset) => Math.round(
    colors.reduce((sum, color) => sum + Number.parseInt(color.slice(offset, offset + 2), 16), 0) / colors.length,
  ).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  assert.equal(getGraphNodeColor({ domains }, 'domain'), expected);
  assert.equal(getGraphNodeColor({ domains: [...domains, ' private-equity ', '', null] }, 'domain'), expected);
  assert.notEqual(getGraphNodeColor({ domains: domains.slice(0, 2) }, 'domain'), expected);
});

test('missing domain memberships use neutral color', () => {
  for (const node of [undefined, {}, { domains: [] }, { domains: ['', ' ', null, 3] }, { domains: 'ai-infrastructure' }]) {
    assert.equal(getGraphNodeColor(node, 'domain'), GRAPH_DOMAIN_UNASSIGNED_COLOR);
  }
  assert.equal(getGraphDomainColor(''), GRAPH_DOMAIN_UNASSIGNED_COLOR);
});

test('domain coloring follows the selected and customized palette', () => {
  const crimson = getGraphColorPalette('crimson-loom');
  const kusama = getGraphColorPalette('kusama');
  assert.notEqual(getGraphDomainColor('ai-infrastructure', crimson), getGraphDomainColor('ai-infrastructure', kusama));
  const custom = Object.fromEntries(Object.keys(crimson).map((type) => [type, '#123456']));
  assert.equal(getGraphDomainColor('ai-infrastructure', custom), '#123456');
  assert.equal(getGraphNodeColor({ domains: ['ai-infrastructure', 'private-equity'] }, 'domain', custom), '#123456');
  assert.equal(getGraphNodeColor({ domains: [] }, 'domain', custom), GRAPH_DOMAIN_UNASSIGNED_COLOR);
});
