import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';

import { searchBrain } from '../../src/bigbrain/search.js';

const config = { openaiEmbeddingModel: 'test-embedding-model' };
const page = { slug: 'projects/example', title: 'Example', summary: 'Evidence', body_markdown: '# Example\n\nComplete evidence.', lexical_score: 1 };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function database(lexical) {
  return {
    backend: 'postgres',
    query: async (sql) => {
      if (sql.includes('AS present')) return { rows: [{ present: true }] };
      if (sql.includes('websearch_to_tsquery')) return lexical();
      if (sql.includes('SELECT slug, title, body_markdown')) return { rows: [page] };
      return { rows: [] };
    },
  };
}

test('semantic embedding begins while keyword retrieval is still pending', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch;
  const embeddingStarted = deferred();
  let lexicalStarted = false;
  let lexicalFinished = false;
  try {
    const db = database(async () => {
      lexicalStarted = true;
      await embeddingStarted.promise;
      lexicalFinished = true;
      return { rows: [page] };
    });
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/embeddings$/);
      assert.equal(lexicalStarted, true);
      assert.equal(lexicalFinished, false);
      embeddingStarted.resolve();
      return { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) };
    };
    const result = await searchBrain({ db, config, query: 'example', apiKey: 'mock-key' });
    assert.equal(lexicalFinished, true);
    assert.equal(result.fused[0].slug, page.slug);
    assert.match(result.retrieval_context.context, /Complete evidence/);
  } finally {
    embeddingStarted.resolve();
    globalThis.fetch = originalFetch;
  }
});

test('a lexical failure waits for semantic work to settle before returning', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch;
  const embeddingStarted = deferred();
  const releaseEmbedding = deferred();
  let settled = false;
  try {
    const db = database(async () => { throw new Error('lexical unavailable'); });
    globalThis.fetch = async () => {
      embeddingStarted.resolve();
      await releaseEmbedding.promise;
      return { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) };
    };
    const pending = searchBrain({ db, config, query: 'example', apiKey: 'mock-key' })
      .then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
    await embeddingStarted.promise;
    await setImmediate();
    assert.equal(settled, false);
    releaseEmbedding.resolve();
    assert.match((await pending).message, /lexical unavailable/);
  } finally {
    releaseEmbedding.resolve();
    globalThis.fetch = originalFetch;
  }
});

test('semantic errors preserve keyword fallback and strict mode while draining keyword work', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const strictRetrieval of [false, true]) {
      const semanticFailed = deferred();
      const releaseLexical = deferred();
      let settled = false;
      try {
        const db = database(async () => {
          await releaseLexical.promise;
          return { rows: [page] };
        });
        globalThis.fetch = async () => {
          semanticFailed.resolve();
          throw new Error('embedding unavailable');
        };
        const pending = searchBrain({ db, config, query: 'example', apiKey: 'mock-key', strictRetrieval })
          .then((result) => { settled = true; return { result }; }, (error) => { settled = true; return { error }; });
        await semanticFailed.promise;
        await setImmediate();
        assert.equal(settled, false);
        releaseLexical.resolve();
        const outcome = await pending;
        if (strictRetrieval) {
          assert.match(outcome.error.message, /embedding unavailable/);
        } else {
          assert.equal(outcome.result.fused[0].slug, page.slug);
          assert.match(outcome.result.warnings.join('\n'), /falling back to lexical-only results/);
        }
      } finally {
        releaseLexical.resolve();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
