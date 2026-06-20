import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExplorerLinkPath } from '../../src/dashboard-client/explorer-links.js';

test('explorer markdown links resolve to explorer file paths', () => {
  assert.equal(
    resolveExplorerLinkPath('people/alice.md', '../projects/relay.md'),
    'projects/relay.md',
  );
  assert.equal(
    resolveExplorerLinkPath('sources/deck-summary.md', '.raw/deck.pdf'),
    'sources/.raw/deck.pdf',
  );
  assert.equal(
    resolveExplorerLinkPath('sources/deck-summary.md', './.raw/notes.txt#section'),
    'sources/.raw/notes.txt',
  );
  assert.equal(
    resolveExplorerLinkPath('sources/nested/page.md', '../../people/alice.md'),
    'people/alice.md',
  );
  assert.equal(
    resolveExplorerLinkPath('people/alice.md', '../projects/relay'),
    'projects/relay.md',
  );
});

test('explorer markdown links ignore external, absolute, and escaping hrefs', () => {
  assert.equal(resolveExplorerLinkPath('people/alice.md', 'https://example.com'), null);
  assert.equal(resolveExplorerLinkPath('people/alice.md', 'mailto:test@example.com'), null);
  assert.equal(resolveExplorerLinkPath('people/alice.md', '/people/bob.md'), null);
  assert.equal(resolveExplorerLinkPath('people/alice.md', '#notes'), null);
  assert.equal(resolveExplorerLinkPath('people/alice.md', '../../outside.md'), null);
});
