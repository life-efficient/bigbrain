import test from 'node:test';
import assert from 'node:assert/strict';
import { nextGraphDomainFilter, nextGraphStyleOption } from '../../src/dashboard-client/graph/style-shortcuts.js';

test('style cycles follow menu order, wrap, and recover stale preferences', () => {
  const options = [{ id: 'updated' }, { id: 'type' }, { id: 'domain' }, { id: 'none' }];
  let current = 'updated';
  for (const expected of ['type', 'domain', 'none', 'updated']) {
    current = nextGraphStyleOption(current, options);
    assert.equal(current, expected);
  }
  assert.equal(nextGraphStyleOption('removed-option', options), 'updated');
  assert.equal(nextGraphStyleOption('updated', []), 'updated');
});

test('domain cycling visits each domain and then removes the filter', () => {
  const domains = ['ai', 'dealmaking', 'health'];
  let selected = [];
  for (const expected of [['ai'], ['dealmaking'], ['health'], [], ['ai']]) {
    selected = nextGraphDomainFilter(selected, domains);
    assert.deepEqual(selected, expected);
  }
  assert.deepEqual(nextGraphDomainFilter(['ai', 'health'], domains), ['ai']);
  assert.deepEqual(nextGraphDomainFilter(['removed-domain'], domains), ['ai']);
  assert.deepEqual(nextGraphDomainFilter(['ai'], []), []);
});
