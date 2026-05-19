import { allEmbeddings, getPagesBySlugs, lexicalSearch } from './db.js';
import { answerQuestion, embedTexts, expandQueryVariants } from './openai.js';

const RRF_K = 60;

export async function searchBrain({ db, config, query, limit = 10, apiKey = process.env.OPENAI_API_KEY }) {
  const queries = await resolveQueries({ query, config, apiKey });
  const innerLimit = Math.min(limit * 3, 30);
  const lexicalLists = queries
    .map((candidate) => lexicalSearch(db, safeFtsQuery(candidate), innerLimit))
    .filter((rows) => rows.length > 0);
  const semanticLists = await semanticSearchLists({ db, config, queries, limit: innerLimit, apiKey });
  const intentWeights = weightsForIntent(classifyQueryIntent(query));
  const fused = fuseRankedLists(
    [
      ...semanticLists.map((rows) => ({ list: rows, k: effectiveRrfK(RRF_K, intentWeights.vectorWeight), source: 'semantic' })),
      ...lexicalLists.map((rows) => ({ list: rows, k: effectiveRrfK(RRF_K, intentWeights.keywordWeight), source: 'lexical' })),
    ],
    limit,
  );
  applyExactMatchBoost(fused, query, intentWeights.exactMatchBoost);
  fused.sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));
  return {
    queries,
    lexical: lexicalLists[0] ?? [],
    semantic: semanticLists[0] ?? [],
    fused: fused.slice(0, limit),
  };
}

export async function queryBrain({ db, config, question, limit = 6, apiKey = process.env.OPENAI_API_KEY }) {
  const search = await searchBrain({ db, config, query: question, limit, apiKey });
  const context = formatAnswerContext(search.fused);
  const preferredSources = search.fused.slice(0, 3).map((result) => result.slug);
  const answer = await answerQuestion({ model: config.openaiQueryModel, apiKey, question, context });
  return { answer: answer || null, preferred_sources: preferredSources, search };
}

export function formatAnswerContext(results) {
  const preferredSources = results.slice(0, 3).map((result, index) => (
    `${index + 1}. ${result.slug} — ${result.title || result.slug}`
  ));

  const entries = results.map((result, index) => [
    `Result ${index + 1}`,
    `Slug: ${result.slug}`,
    `Title: ${result.title || result.slug}`,
    `Summary: ${result.summary || ''}`,
    `Snippet: ${result.snippet || ''}`,
  ].join('\n'));

  return [
    'Top-ranked sources:',
    preferredSources.length ? preferredSources.join('\n') : 'none',
    '',
    'Retrieved context:',
    entries.join('\n\n'),
  ].join('\n');
}

async function resolveQueries({ query, config, apiKey }) {
  try {
    return await expandQueryVariants({ query, model: config.openaiQueryModel, apiKey });
  } catch {
    return [query];
  }
}

async function semanticSearchLists({ db, config, queries, limit, apiKey }) {
  if (!apiKey) return [];
  const embeddings = allEmbeddings(db);
  if (embeddings.length === 0 || queries.length === 0) return [];

  const queryVectors = await embedTexts(queries, config.openaiEmbeddingModel, apiKey);
  if (queryVectors.length === 0) return [];

  const metadataBySlug = new Map(
    getPagesBySlugs(db, [...new Set(embeddings.map((row) => row.page_slug))]).map((row) => [row.slug, row]),
  );

  return queryVectors.map((queryVector) => embeddings
    .map((row) => {
      const metadata = metadataBySlug.get(row.page_slug);
      return {
        slug: row.page_slug,
        title: metadata?.title ?? row.page_slug,
        type: metadata?.type ?? null,
        summary: metadata?.summary ?? '',
        snippet: row.chunk_text.slice(0, 240),
        semantic_score: cosineSimilarity(queryVector, JSON.parse(row.embedding_json)),
      };
    })
    .sort((left, right) => right.semantic_score - left.semantic_score)
    .slice(0, limit));
}

export function fuseResults(lexical, semantic, limit) {
  return fuseRankedLists(
    [
      ...(semantic.length ? [{ list: semantic, k: RRF_K, source: 'semantic' }] : []),
      ...(lexical.length ? [{ list: lexical, k: RRF_K, source: 'lexical' }] : []),
    ],
    limit,
  );
}

function fuseRankedLists(lists, limit) {
  const scores = new Map();

  for (const { list, k, source = 'unknown' } of lists) {
    for (let rank = 0; rank < list.length; rank += 1) {
      const row = list[rank];
      const existing = scores.get(row.slug);
      const contribution = 1 / (k + rank);

      if (existing) {
        existing.score += contribution;
        if (!existing.snippet && row.snippet) existing.snippet = row.snippet;
        if (!existing.summary && row.summary) existing.summary = row.summary;
        if (!existing.title && row.title) existing.title = row.title;
        if (!existing.type && row.type) existing.type = row.type;
        if (source === 'lexical') existing.lexicalHits += 1;
        if (source === 'semantic') existing.semanticHits += 1;
      } else {
        scores.set(row.slug, {
          slug: row.slug,
          title: row.title ?? row.slug,
          type: row.type ?? null,
          summary: row.summary ?? '',
          snippet: row.snippet ?? '',
          score: contribution,
          lexicalHits: source === 'lexical' ? 1 : 0,
          semanticHits: source === 'semantic' ? 1 : 0,
        });
      }
    }
  }

  const entries = [...scores.values()];
  if (entries.length === 0) return [];

  const maxScore = Math.max(...entries.map((entry) => entry.score));
  if (maxScore > 0) {
    for (const entry of entries) entry.score /= maxScore;
  }

  return entries
    .sort((left, right) => (
      right.score - left.score
      || right.lexicalHits - left.lexicalHits
      || right.semanticHits - left.semanticHits
      || left.slug.localeCompare(right.slug)
    ))
    .slice(0, limit);
}

function effectiveRrfK(baseK, weight) {
  if (weight <= 0) return baseK;
  return baseK / weight;
}

function applyExactMatchBoost(results, query, boost) {
  if (boost === 1) return;
  const normalized = query.toLowerCase().trim();
  if (!normalized) return;
  const kebab = normalized.replace(/\s+/g, '-');

  for (const result of results) {
    const slug = (result.slug ?? '').toLowerCase();
    const title = (result.title ?? '').toLowerCase().trim();
    if (slug === normalized || slug === kebab || slug.endsWith(`/${kebab}`) || title === normalized) {
      result.score *= boost;
    }
  }
}

function weightsForIntent(intent) {
  switch (intent) {
    case 'entity':
      return { keywordWeight: 1.15, vectorWeight: 1.0, exactMatchBoost: 1.25 };
    case 'event':
      return { keywordWeight: 1.20, vectorWeight: 0.95, exactMatchBoost: 1.10 };
    default:
      return { keywordWeight: 1.0, vectorWeight: 1.0, exactMatchBoost: 1.0 };
  }
}

function classifyQueryIntent(query) {
  if (/\bwho\s+is\b/i.test(query) || /\bwhat\s+(is|does|are)\b/i.test(query) || /\btell\s+me\s+about\b/i.test(query)) {
    return 'entity';
  }
  if (/\bannounce[ds]?(ment)?\b/i.test(query) || /\blaunch(ed|es|ing)?\b/i.test(query) || /\bacquisition\b/i.test(query) || /\bhappened?\b/i.test(query)) {
    return 'event';
  }
  return 'general';
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function safeFtsQuery(value) {
  const stopWords = new Set([
    'a',
    'about',
    'an',
    'and',
    'are',
    'did',
    'for',
    'from',
    'have',
    'how',
    'i',
    'in',
    'is',
    'me',
    'my',
    'of',
    'on',
    'or',
    'the',
    'things',
    'to',
    'what',
    'whats',
    'when',
    'where',
    'which',
    'who',
    'why',
    'with',
  ]);

  return value
    .trim()
    .split(/\s+/)
    .flatMap((token) => token
      .replace(/[^\p{L}\p{N}_-]+/gu, '')
      .toLowerCase()
      .split(/-+/)
      .filter(Boolean))
    .filter((token) => !stopWords.has(token))
    .filter(Boolean)
    .join(' ');
}
