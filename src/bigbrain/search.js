import { allEmbeddings, getPagesBySlugs, lexicalSearch, listPageSlugs, semanticSearch } from './db.js';
import { answerQuestion, embedTexts, expandQueryVariants, rerankSearchResults } from './openai.js';

const RRF_K = 60;
const HIGH_MATCH_FLOOR = 0.85;
const SOLID_MATCH_FLOOR = 0.6;

export const DEFAULT_SEARCH_MODE = 'balanced';
export const SEARCH_MODE_BUNDLES = Object.freeze({
  conservative: Object.freeze({
    expansion: false,
    rerank: false,
    searchLimit: 10,
    innerLimit: 30,
    tokenBudget: 4000,
    titleBoost: 1.25,
  }),
  balanced: Object.freeze({
    expansion: false,
    rerank: true,
    searchLimit: 10,
    innerLimit: 30,
    tokenBudget: 12000,
    titleBoost: 1.25,
  }),
  tokenmax: Object.freeze({
    expansion: true,
    rerank: true,
    searchLimit: 25,
    innerLimit: 50,
    tokenBudget: null,
    titleBoost: 1.25,
  }),
});

export function searchModesReport(activeMode = DEFAULT_SEARCH_MODE) {
  return {
    default_mode: DEFAULT_SEARCH_MODE,
    active_mode: normalizeSearchMode(activeMode),
    bundles: SEARCH_MODE_BUNDLES,
  };
}

export async function searchBrain({
  db,
  config,
  query,
  limit = null,
  mode = DEFAULT_SEARCH_MODE,
  expand = undefined,
  explain = false,
  apiKey = process.env.OPENAI_API_KEY,
  reranker = rerankSearchResults,
} = {}) {
  const warnings = [];
  const resolvedMode = normalizeSearchMode(mode);
  const modeBundle = SEARCH_MODE_BUNDLES[resolvedMode];
  const resolvedLimit = normalizeLimit(limit, modeBundle.searchLimit);
  const intent = classifyQueryIntent(query);
  const expansionEnabled = expand === undefined ? modeBundle.expansion : Boolean(expand);
  const queries = await resolveQueries({ query, config, apiKey, warnings, expansionEnabled });
  const innerLimit = Math.max(resolvedLimit * 3, modeBundle.innerLimit);
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
  const intentWeights = weightsForIntent(intent, modeBundle);
  let fused = fuseRankedLists(
    [
      ...semanticLists.map((rows) => ({ list: rows, k: effectiveRrfK(RRF_K, intentWeights.vectorWeight), source: 'semantic' })),
      ...lexicalLists.map((rows) => ({ list: rows, k: effectiveRrfK(RRF_K, intentWeights.keywordWeight), source: 'lexical' })),
    ],
    Math.max(resolvedLimit, innerLimit),
  );
  await addAliasCandidates({ db, results: fused, query });
  applyAliasHits(fused, query);
  boostResultsForQuery(fused, query, intentWeights);
  stampEvidence(fused);
  fused.sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));
  if (modeBundle.rerank) {
    try {
      if (apiKey) {
        fused = await rerankResults({ config, apiKey, query, results: fused, reranker });
      } else {
        warnings.push('OpenAI reranking skipped because OPENAI_API_KEY is not set.');
      }
    } catch (error) {
      warnings.push(formatWarning('OpenAI reranking unavailable; using pre-rerank order', error));
    }
  }
  const finalResults = fused.slice(0, resolvedLimit);
  return {
    mode: resolvedMode,
    intent,
    expanded: queries.length > 1,
    queries,
    lexical: lexicalLists[0] ?? [],
    semantic: semanticLists[0] ?? [],
    fused: explain ? finalResults : finalResults.map(compactResult),
    ...(explain ? { explain: { mode: resolvedMode, intent, rerank_enabled: modeBundle.rerank, expansion_enabled: expansionEnabled } } : {}),
    warnings,
  };
}

export async function queryBrain({
  db,
  config,
  question,
  query = null,
  limit = 6,
  mode = DEFAULT_SEARCH_MODE,
  expand = undefined,
  explain = false,
  apiKey = process.env.OPENAI_API_KEY,
  reranker = rerankSearchResults,
} = {}) {
  const effectiveQuestion = question || query;
  const search = await searchBrain({ db, config, query: effectiveQuestion, limit, mode, expand, explain: true, apiKey, reranker });
  const context = formatAnswerContext(search.fused);
  const preferredSources = search.fused.slice(0, 3).map((result) => result.slug);
  const warnings = [...search.warnings];
  let answer = null;
  if (!apiKey) {
    warnings.push('OpenAI answer generation skipped because OPENAI_API_KEY is not set.');
  }
  try {
    if (apiKey) answer = await answerQuestion({ model: config.openaiQueryModel, apiKey, question: effectiveQuestion, context });
  } catch (error) {
    warnings.push(formatWarning('OpenAI answer generation unavailable; returning retrieved context only', error));
  }
  if (!explain) search.fused = search.fused.map(compactResult);
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

async function resolveQueries({ query, config, apiKey, warnings, expansionEnabled }) {
  if (!expansionEnabled || !shouldAutoExpandQuery(query)) return [query];
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
      lists: (await Promise.all(queryVectors.map((queryVector) => semanticSearch(db, queryVector, Math.max(limit * 2, limit)))))
        .map((rows) => poolBestChunkPerPage(rows).slice(0, limit)),
      skippedReason: null,
    };
  }

  const metadataBySlug = new Map(
    (await getPagesBySlugs(db, [...new Set(embeddings.map((row) => row.page_slug))])).map((row) => [row.slug, row]),
  );

  return {
    lists: queryVectors.map((queryVector) => poolBestChunkPerPage(embeddings
      .map((row) => {
        const metadata = metadataBySlug.get(row.page_slug);
        return {
          slug: row.page_slug,
          title: metadata?.title ?? row.page_slug,
          type: metadata?.type ?? null,
          summary: metadata?.summary ?? '',
          frontmatter_json: metadata?.frontmatter_json,
          snippet: row.chunk_text.slice(0, 240),
          chunk_id: row.chunk_id,
          chunk_text: row.chunk_text,
          semantic_score: cosineSimilarity(queryVector, JSON.parse(row.embedding_json)),
        };
      })
      .sort((left, right) => right.semantic_score - left.semantic_score))
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
        existing.base_score = existing.score;
        existing.rank_contributions.push({ source, rank: rank + 1, contribution });
        if (!existing.snippet && row.snippet) existing.snippet = row.snippet;
        if (!existing.summary && row.summary) existing.summary = row.summary;
        if (!existing.title && row.title) existing.title = row.title;
        if (!existing.type && row.type) existing.type = row.type;
        if (!existing.frontmatter_json && row.frontmatter_json) existing.frontmatter_json = row.frontmatter_json;
        if (source === 'semantic' && (!existing.chunk_id || Number(row.semantic_score ?? 0) > Number(existing.semantic_score ?? 0))) {
          existing.chunk_id = row.chunk_id ?? existing.chunk_id ?? null;
          existing.chunk_text = row.chunk_text ?? row.snippet ?? existing.chunk_text ?? '';
          existing.semantic_score = Number(row.semantic_score ?? existing.semantic_score ?? 0);
          if (row.snippet) existing.snippet = row.snippet;
        }
        if (source === 'lexical') existing.lexical_score = row.lexical_score ?? existing.lexical_score ?? null;
        if (source === 'lexical') existing.lexicalHits += 1;
        if (source === 'semantic') existing.semanticHits += 1;
      } else {
        scores.set(row.slug, {
          slug: row.slug,
          title: row.title ?? row.slug,
          type: row.type ?? null,
          summary: row.summary ?? '',
          frontmatter_json: row.frontmatter_json,
          snippet: row.snippet ?? '',
          chunk_id: row.chunk_id ?? null,
          chunk_text: row.chunk_text ?? row.snippet ?? '',
          score: contribution,
          base_score: contribution,
          lexical_score: row.lexical_score ?? null,
          semantic_score: row.semantic_score ?? null,
          lexicalHits: source === 'lexical' ? 1 : 0,
          semanticHits: source === 'semantic' ? 1 : 0,
          boosts: [],
          rank_contributions: [{ source, rank: rank + 1, contribution }],
        });
      }
    }
  }

  const entries = [...scores.values()];
  if (entries.length === 0) return [];

  const maxScore = Math.max(...entries.map((entry) => entry.score));
  if (maxScore > 0) {
    for (const entry of entries) {
      entry.score /= maxScore;
      entry.base_score = entry.score;
    }
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

function poolBestChunkPerPage(rows) {
  const best = new Map();
  for (const row of rows) {
    const existing = best.get(row.slug);
    if (!existing || Number(row.semantic_score ?? 0) > Number(existing.semantic_score ?? 0)) {
      best.set(row.slug, row);
    }
  }
  return [...best.values()].sort((left, right) => Number(right.semantic_score ?? 0) - Number(left.semantic_score ?? 0));
}

async function rerankResults({ config, apiKey, query, results, reranker }) {
  const scores = await reranker({ model: config.openaiQueryModel, apiKey, query, results });
  if (!Array.isArray(scores) || scores.length === 0) return results;
  const byIndex = new Map(scores.map((entry) => [entry.index, entry.score]));
  for (let index = 0; index < results.length; index += 1) {
    if (!byIndex.has(index)) continue;
    const rerankScore = byIndex.get(index);
    results[index].rerank_score = rerankScore;
    results[index].score = (results[index].score * 0.35) + (rerankScore * 0.65);
    results[index].boosts.push({ type: 'openai_rerank', score: rerankScore });
  }
  return results.sort((left, right) => (
    right.score - left.score
    || Number(right.rerank_score ?? 0) - Number(left.rerank_score ?? 0)
    || left.slug.localeCompare(right.slug)
  ));
}

function normalizeSearchMode(mode) {
  const value = String(mode || DEFAULT_SEARCH_MODE).trim().toLowerCase();
  if (Object.hasOwn(SEARCH_MODE_BUNDLES, value)) return value;
  throw new Error(`Invalid search mode: ${mode}. Expected one of: ${Object.keys(SEARCH_MODE_BUNDLES).join(', ')}.`);
}

function normalizeLimit(limit, fallback) {
  const value = Number(limit ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), 100);
}

function compactResult(result) {
  const {
    frontmatter_json,
    rank_contributions,
    chunk_text,
    ...rest
  } = result;
  return rest;
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
    ensureBoosts(result);
    const slug = normalizeComparableText(result.slug ?? '');
    const title = normalizeComparableText(result.title ?? '');
    if (slug === normalized || slug === kebab || slug.endsWith(`/${kebab}`) || title === normalized) {
      result.score *= boost;
      result.boosts.push({ type: 'exact_match', multiplier: boost });
    }
  }
}

function applyTitlePhraseBoost(results, query, boost) {
  if (boost === 1) return;
  const normalizedQuery = normalizeComparableText(query);
  if (!normalizedQuery) return;

  for (const result of results) {
    ensureBoosts(result);
    const normalizedTitle = normalizeComparableText(result.title ?? '');
    if (!normalizedTitle) continue;
    if (normalizedTitle.includes(normalizedQuery)) {
      result.score *= boost;
      result.title_match_boost = boost;
      result.boosts.push({ type: 'title_phrase', multiplier: boost });
    }
  }
}

function applyTokenSetBoost(results, query, boost) {
  if (boost === 1) return;
  const queryTokens = comparableTokens(query);
  if (queryTokens.length < 2) return;

  for (const result of results) {
    ensureBoosts(result);
    const titleTokens = comparableTokens(result.title ?? '');
    if (titleTokens.length === 0) continue;
    if (containsOrderedTokenRun(titleTokens, queryTokens)) {
      result.score *= boost;
      result.boosts.push({ type: 'title_token_run', multiplier: boost });
      continue;
    }
    if (hasFullTokenCoverage(titleTokens, queryTokens)) {
      const multiplier = Math.sqrt(boost);
      result.score *= multiplier;
      result.boosts.push({ type: 'title_token_coverage', multiplier });
    }
  }
}

function applyLexicalTieBreak(results, query, boost) {
  if (boost === 1) return;
  const queryTokens = comparableTokens(query);
  if (queryTokens.length === 0) return;

  for (const result of results) {
    ensureBoosts(result);
    if (!result.lexicalHits) continue;
    const titleTokens = comparableTokens(result.title ?? '');
    if (containsOrderedTokenRun(titleTokens, queryTokens) || hasFullTokenCoverage(titleTokens, queryTokens)) {
      result.score *= boost;
      result.boosts.push({ type: 'lexical_tiebreak', multiplier: boost });
    }
  }
}

function weightsForIntent(intent, modeBundle = SEARCH_MODE_BUNDLES[DEFAULT_SEARCH_MODE]) {
  switch (intent) {
    case 'entity':
      return {
        keywordWeight: 1.2,
        vectorWeight: 0.95,
        exactMatchBoost: 1.35,
        titlePhraseBoost: modeBundle.titleBoost,
        tokenSetBoost: 1.3,
        lexicalTieBreakBoost: 1.15,
      };
    case 'temporal':
      return {
        keywordWeight: 1.05,
        vectorWeight: 1.05,
        exactMatchBoost: 1.0,
        titlePhraseBoost: 1.05,
        tokenSetBoost: 1.0,
        lexicalTieBreakBoost: 1.0,
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
  if (/\b(today|right now|recent(ly)?|latest|last\s+(week|month|quarter|year)|this\s+(week|month|quarter|year)|timeline|history|meeting notes?)\b/i.test(query)) {
    return 'temporal';
  }
  if (/\bwho\s+is\b/i.test(query) || /\bwhat\s+(is|does|are)\b/i.test(query) || /\btell\s+me\s+about\b/i.test(query)) {
    return 'entity';
  }
  if (/\bannounce[ds]?(ment)?\b/i.test(query) || /\blaunch(ed|es|ing)?\b/i.test(query) || /\bacquisition\b/i.test(query) || /\bhappened?\b/i.test(query)) {
    return 'event';
  }
  return 'general';
}

function applyAliasHits(results, query) {
  const normalizedQuery = normalizeComparableText(query);
  if (!normalizedQuery) return;
  for (const result of results) {
    ensureBoosts(result);
    const aliases = aliasesFromFrontmatter(result.frontmatter_json);
    if (!aliases.some((alias) => normalizeComparableText(alias) === normalizedQuery)) continue;
    const multiplier = 1.4;
    result.alias_hit = true;
    result.score *= multiplier;
    result.boosts.push({ type: 'alias_hit', multiplier });
  }
}

function ensureBoosts(result) {
  if (!Array.isArray(result.boosts)) result.boosts = [];
}

async function addAliasCandidates({ db, results, query }) {
  const normalizedQuery = normalizeComparableText(query);
  if (!normalizedQuery) return;
  const existingSlugs = new Set(results.map((result) => result.slug));
  const slugs = await listPageSlugs(db);
  const pages = await getPagesBySlugs(db, slugs);
  const topScore = results.length ? Math.max(...results.map((result) => Number(result.score) || 0)) : 1;
  const aliasCandidateScore = Math.max(topScore * 2, 2);
  for (const page of pages) {
    if (existingSlugs.has(page.slug)) continue;
    const aliases = aliasesFromFrontmatter(page.frontmatter_json);
    if (!aliases.some((alias) => normalizeComparableText(alias) === normalizedQuery)) continue;
    results.push({
      slug: page.slug,
      title: page.title ?? page.slug,
      type: page.type ?? null,
      summary: page.summary ?? '',
      frontmatter_json: page.frontmatter_json,
      snippet: page.summary || page.compiled_truth?.slice(0, 240) || '',
      chunk_id: null,
      chunk_text: '',
      score: aliasCandidateScore,
      base_score: aliasCandidateScore,
      lexical_score: null,
      semantic_score: null,
      lexicalHits: 0,
      semanticHits: 0,
      alias_hit: true,
      boosts: [{ type: 'alias_candidate', multiplier: 2 }],
      rank_contributions: [{ source: 'alias', rank: 1, contribution: aliasCandidateScore }],
    });
    existingSlugs.add(page.slug);
  }
}

function aliasesFromFrontmatter(frontmatterJson) {
  if (!frontmatterJson) return [];
  let parsed = frontmatterJson;
  if (typeof frontmatterJson === 'string') {
    try {
      parsed = JSON.parse(frontmatterJson);
    } catch {
      return [];
    }
  }
  const aliases = parsed?.aliases;
  if (typeof aliases === 'string') return [aliases];
  if (Array.isArray(aliases)) return aliases.filter((alias) => typeof alias === 'string' && alias.trim());
  return [];
}

function stampEvidence(results) {
  for (const result of results) {
    const evidence = classifyEvidence(result);
    result.evidence = evidence;
    result.create_safety = createSafetyForEvidence(evidence);
  }
}

function classifyEvidence(result) {
  if (result.alias_hit) return 'alias_hit';
  if (Number(result.title_match_boost ?? 1) > 1) return 'exact_title_match';
  const base = Number(result.base_score ?? result.score);
  if (Number.isFinite(base) && base >= HIGH_MATCH_FLOOR) return 'high_vector_match';
  if (Number.isFinite(base) && base >= SOLID_MATCH_FLOOR) return 'keyword_exact';
  return 'weak_semantic';
}

function createSafetyForEvidence(evidence) {
  switch (evidence) {
    case 'alias_hit':
    case 'exact_title_match':
    case 'high_vector_match':
      return 'exists';
    case 'keyword_exact':
      return 'probable';
    default:
      return 'unknown';
  }
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
