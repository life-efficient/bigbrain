import { allEmbeddings, lexicalSearch } from './db.js';
import { answerQuestion, embedTexts } from './openai.js';

export async function searchBrain({ db, config, query, limit = 10, apiKey = process.env.OPENAI_API_KEY }) {
  const lexical = lexicalSearch(db, safeFtsQuery(query), limit);
  const semantic = await semanticSearch({ db, config, query, limit, apiKey });
  const fused = fuseResults(lexical, semantic, limit);
  return { lexical, semantic, fused };
}

export async function queryBrain({ db, config, question, limit = 6, apiKey = process.env.OPENAI_API_KEY }) {
  const search = await searchBrain({ db, config, query: question, limit, apiKey });
  const context = search.fused
    .map((result, index) => `${index + 1}. ${result.slug}\nTitle: ${result.title}\nSummary: ${result.summary}\nSnippet: ${result.snippet || ''}`)
    .join('\n\n');
  const answer = await answerQuestion({ model: config.openaiQueryModel, apiKey, question, context });
  return { answer: answer || null, search };
}

async function semanticSearch({ db, config, query, limit, apiKey }) {
  if (!apiKey) return [];
  const embeddings = allEmbeddings(db);
  if (embeddings.length === 0) return [];
  const [queryVector] = await embedTexts([query], config.openaiEmbeddingModel, apiKey);
  return embeddings
    .map((row) => ({
      slug: row.page_slug,
      snippet: row.chunk_text.slice(0, 240),
      semantic_score: cosineSimilarity(queryVector, JSON.parse(row.embedding_json)),
    }))
    .sort((left, right) => right.semantic_score - left.semantic_score)
    .slice(0, limit);
}

export function fuseResults(lexical, semantic, limit) {
  const bySlug = new Map();
  const lexicalIndex = new Map(lexical.map((row, index) => [row.slug, index + 1]));
  const semanticIndex = new Map(semantic.map((row, index) => [row.slug, index + 1]));

  for (const row of lexical) {
    bySlug.set(row.slug, {
      slug: row.slug,
      title: row.title,
      type: row.type,
      summary: row.summary,
      snippet: row.snippet,
      lexical_rank: lexicalIndex.get(row.slug),
      semantic_rank: semanticIndex.get(row.slug) ?? null,
      score: 0,
    });
  }
  for (const row of semantic) {
    const existing = bySlug.get(row.slug) || {
      slug: row.slug,
      title: row.slug,
      type: null,
      summary: '',
      snippet: row.snippet,
      lexical_rank: lexicalIndex.get(row.slug) ?? null,
      semantic_rank: semanticIndex.get(row.slug),
      score: 0,
    };
    if (!existing.snippet) existing.snippet = row.snippet;
    existing.semantic_rank = semanticIndex.get(row.slug);
    bySlug.set(row.slug, existing);
  }
  for (const result of bySlug.values()) {
    result.score = (reciprocalRank(result.lexical_rank) * 2) + reciprocalRank(result.semantic_rank);
  }
  return [...bySlug.values()].sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug)).slice(0, limit);
}

function reciprocalRank(rank) {
  return rank ? 1 / (60 + rank) : 0;
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
  return value.trim().split(/\s+/).filter(Boolean).map((token) => token.replace(/"/g, '')).join(' ');
}
