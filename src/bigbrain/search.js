import { allEmbeddings, getPagesBySlugs, lexicalSearch, semanticSearch } from './db.js';
import { answerQuestion, embedTexts, expandQueryVariants } from './openai.js';

const RRF_K = 60;

export async function searchBrain({ db, config, query, limit = 10, apiKey = process.env.OPENAI_API_KEY }) {
  const warnings = [];
  const queries = await resolveQueries({ query, config, apiKey, warnings });
  const innerLimit = Math.min(limit * 3, 30);
  const lexicalLists = (await Promise.all(queries
    .map((candidate) => lexicalSearch(db, safeFtsQuery(candidate), innerLimit))))
    .filter((rows) => rows.length > 0);
  let semanticLists = [];
  try {
    const semanticResult = await semanticSearchLists({ db, config, queries, limit: innerLimit, apiKey });
    semanticLists = semanticResult.lists;
    if (semanticResult.skippedReason) warnings.push(semanticSkipWarning(semanticResult.skippedReason));
  } catch (error) {
    warnings.push(formatWarning('semantic search unavailable; falling back to lexical-only results', error));
  }
  const intentWeights = weightsForIntent(classifyQueryIntent(query));
  const fused = fuseRankedLists(
    [
      ...semanticLists.map((rows) => ({ list: rows, k: effectiveRrfK(RRF_K, intentWeights.vectorWeight), source: 'semantic' })),
      ...lexicalLists.map((rows) => ({ list: rows, k: effectiveRrfK(RRF_K, intentWeights.keywordWeight), source: 'lexical' })),
    ],
    limit,
  );
  boostResultsForQuery(fused, query, intentWeights);
  fused.sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));
  return {
    queries,
    lexical: lexicalLists[0] ?? [],
    semantic: semanticLists[0] ?? [],
    fused: fused.slice(0, limit),
    warnings,
  };
}

export async function queryBrain({ db, config, question, limit = 6, apiKey = process.env.OPENAI_API_KEY }) {
  const search = await searchBrain({ db, config, query: question, limit, apiKey });
  const context = formatAnswerContext(search.fused);
  const preferredSources = search.fused.slice(0, 3).map((result) => result.slug);
  const warnings = [...search.warnings];
  let answer = null;
  if (!apiKey) {
    warnings.push('OpenAI answer generation skipped because OPENAI_API_KEY is not set.');
  }
  try {
    if (apiKey) answer = await answerQuestion({ model: config.openaiQueryModel, apiKey, question, context });
  } catch (error) {
    warnings.push(formatWarning('OpenAI answer generation unavailable; returning retrieved context only', error));
  }
  return { answer: answer || null, preferred_sources: preferredSources, search, warnings };
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

async function resolveQueries({ query, config, apiKey, warnings }) {
  if (!shouldAutoExpandQuery(query)) return [query];
  try {
    return await expandQueryVariants({ query, model: config.openaiQueryModel, apiKey });
  } catch (error) {
    warnings?.push(formatWarning('query expansion unavailable; using the original query', error));
    return [query];
  }
}

function formatWarning(message, error) {
  if (!(error instanceof Error)) return message;
  const parts = [];
  if (error.message) parts.push(error.message);
  const causeMessage = extractCauseMessage(error.cause);
  if (causeMessage && causeMessage !== error.message) parts.push(`cause: ${causeMessage}`);
  const suffix = parts.length ? ` (${parts.join('; ')})` : '';
  return `${message}${suffix}`;
}

function semanticSkipWarning(reason) {
  switch (reason) {
    case 'missing_api_key':
      return 'semantic search skipped because OPENAI_API_KEY is not set.';
    case 'no_embeddings':
      return 'semantic search skipped because the index has no embeddings. Run sync with OPENAI_API_KEY set.';
    case 'no_queries':
      return 'semantic search skipped because no query text was available.';
    case 'no_query_vectors':
      return 'semantic search skipped because no query embedding vectors were generated.';
    default:
      return 'semantic search skipped.';
  }
}

function extractCauseMessage(cause) {
  if (!cause) return '';
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === 'object' && typeof cause.message === 'string' && cause.message) return cause.message;
  return '';
}

export function shouldAutoExpandQuery(query) {
  const wordCount = countWords(query);
  if (wordCount < 4) return false;

  const normalized = query.toLowerCase().trim();
  const intent = classifyQueryIntent(query);
  if (intent === 'entity') return false;

  if (/\?/.test(query)) return true;
  if (/\b(recent|recently|current|currently|next|state|status|todo|mentioned?|advised?)\b/i.test(query)) return true;
  if (/\bwhat's\s+next\b/i.test(normalized) || /\bwhat\s+did\s+i\b/i.test(normalized)) return true;

  return wordCount >= 6;
}

async function semanticSearchLists({ db, config, queries, limit, apiKey }) {
  if (!apiKey) {
    return {
      lists: [],
      skippedReason: 'missing_api_key',
    };
  }
  const embeddings = await allEmbeddings(db);
  if (embeddings.length === 0) {
    return {
      lists: [],
      skippedReason: 'no_embeddings',
    };
  }
  if (queries.length === 0) {
    return {
      lists: [],
      skippedReason: 'no_queries',
    };
  }

  const queryVectors = await embedTexts(queries, config.openaiEmbeddingModel, apiKey);
  if (queryVectors.length === 0) {
    return {
      lists: [],
      skippedReason: 'no_query_vectors',
    };
  }

  if (db.backend === 'postgres') {
    return {
      lists: await Promise.all(queryVectors.map((queryVector) => semanticSearch(db, queryVector, limit))),
      skippedReason: null,
    };
  }

  const metadataBySlug = new Map(
    (await getPagesBySlugs(db, [...new Set(embeddings.map((row) => row.page_slug))])).map((row) => [row.slug, row]),
  );

  return {
    lists: queryVectors.map((queryVector) => embeddings
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
      .slice(0, limit)),
    skippedReason: null,
  };
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

export function boostResultsForQuery(results, query, intentWeights = weightsForIntent(classifyQueryIntent(query))) {
  applyExactMatchBoost(results, query, intentWeights.exactMatchBoost);
  applyTitlePhraseBoost(results, query, intentWeights.titlePhraseBoost);
  applyTokenSetBoost(results, query, intentWeights.tokenSetBoost);
  applyLexicalTieBreak(results, query, intentWeights.lexicalTieBreakBoost);
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
  const normalized = normalizeComparableText(query);
  if (!normalized) return;
  const kebab = normalized.replace(/\s+/g, '-');

  for (const result of results) {
    const slug = normalizeComparableText(result.slug ?? '');
    const title = normalizeComparableText(result.title ?? '');
    if (slug === normalized || slug === kebab || slug.endsWith(`/${kebab}`) || title === normalized) {
      result.score *= boost;
    }
  }
}

function applyTitlePhraseBoost(results, query, boost) {
  if (boost === 1) return;
  const normalizedQuery = normalizeComparableText(query);
  if (!normalizedQuery) return;

  for (const result of results) {
    const normalizedTitle = normalizeComparableText(result.title ?? '');
    if (!normalizedTitle) continue;
    if (normalizedTitle.includes(normalizedQuery)) result.score *= boost;
  }
}

function applyTokenSetBoost(results, query, boost) {
  if (boost === 1) return;
  const queryTokens = comparableTokens(query);
  if (queryTokens.length < 2) return;

  for (const result of results) {
    const titleTokens = comparableTokens(result.title ?? '');
    if (titleTokens.length === 0) continue;
    if (containsOrderedTokenRun(titleTokens, queryTokens)) {
      result.score *= boost;
      continue;
    }
    if (hasFullTokenCoverage(titleTokens, queryTokens)) result.score *= Math.sqrt(boost);
  }
}

function applyLexicalTieBreak(results, query, boost) {
  if (boost === 1) return;
  const queryTokens = comparableTokens(query);
  if (queryTokens.length === 0) return;

  for (const result of results) {
    if (!result.lexicalHits) continue;
    const titleTokens = comparableTokens(result.title ?? '');
    if (containsOrderedTokenRun(titleTokens, queryTokens) || hasFullTokenCoverage(titleTokens, queryTokens)) {
      result.score *= boost;
    }
  }
}

function weightsForIntent(intent) {
  switch (intent) {
    case 'entity':
      return {
        keywordWeight: 1.2,
        vectorWeight: 0.95,
        exactMatchBoost: 1.35,
        titlePhraseBoost: 1.2,
        tokenSetBoost: 1.3,
        lexicalTieBreakBoost: 1.15,
      };
    case 'event':
      return {
        keywordWeight: 1.20,
        vectorWeight: 0.95,
        exactMatchBoost: 1.10,
        titlePhraseBoost: 1.08,
        tokenSetBoost: 1.05,
        lexicalTieBreakBoost: 1.05,
      };
    default:
      return {
        keywordWeight: 1.0,
        vectorWeight: 1.0,
        exactMatchBoost: 1.0,
        titlePhraseBoost: 1.0,
        tokenSetBoost: 1.0,
        lexicalTieBreakBoost: 1.0,
      };
  }
}

export function classifyQueryIntent(query) {
  if (looksLikeDirectLookup(query)) return 'entity';
  if (/\bwho\s+is\b/i.test(query) || /\bwhat\s+(is|does|are)\b/i.test(query) || /\btell\s+me\s+about\b/i.test(query)) {
    return 'entity';
  }
  if (/\bannounce[ds]?(ment)?\b/i.test(query) || /\blaunch(ed|es|ing)?\b/i.test(query) || /\bacquisition\b/i.test(query) || /\bhappened?\b/i.test(query)) {
    return 'event';
  }
  return 'general';
}

function countWords(query) {
  return query.trim().split(/\s+/).filter(Boolean).length;
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

function looksLikeDirectLookup(query) {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (/[?!]/.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 5) return false;

  const normalized = normalizeComparableText(trimmed);
  if (!normalized) return false;
  if (/\b(and|or|with|about|current|next|recent|recently|state|status|todo|mentioned|advised)\b/i.test(trimmed)) {
    return false;
  }

  const comparable = comparableTokens(trimmed);
  if (comparable.length === 0 || comparable.length > 5) return false;
  return true;
}

function normalizeComparableText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s/-]+/gu, ' ')
    .replace(/[-_/]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function comparableTokens(value) {
  return normalizeComparableText(value)
    .split(/\s+/)
    .filter(Boolean);
}

function containsOrderedTokenRun(haystack, needle) {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function hasFullTokenCoverage(titleTokens, queryTokens) {
  const titleSet = new Set(titleTokens);
  return queryTokens.every((token) => titleSet.has(token));
}
