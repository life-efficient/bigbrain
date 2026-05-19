export async function embedTexts(texts, model, apiKey) {
  if (!apiKey || texts.length === 0) return [];
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!response.ok) throw new Error(`OpenAI embeddings failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return payload.data.map((entry) => entry.embedding);
}

export async function expandQueryVariants({ query, model, apiKey }) {
  if (!apiKey) return [query];
  if (countWords(query) < 3) return [query];

  const sanitized = sanitizeQueryForPrompt(query);
  if (!sanitized) return [query];

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: 'Return a JSON array with up to 2 short alternate search queries that preserve the original meaning. No explanations.',
          }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: sanitized }],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI expansion failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  const parsed = parseExpansionOutput(extractOutputText(payload));
  const alternatives = sanitizeExpansionOutput(Array.isArray(parsed) ? parsed : []);
  return dedupeQueries([query, ...alternatives]).slice(0, 3);
}

export async function answerQuestion({ model, apiKey, question, context }) {
  if (!apiKey) return null;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: [
              'Answer only from the provided bigbrain context.',
              'Prefer the top-ranked sources when they support the answer.',
              'Cite supporting source slugs inline in parentheses.',
              'If the retrieved context is insufficient or conflicting, say so instead of guessing.',
              'Be concise and concrete.',
            ].join(' '),
          }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: `Question:\n${question}\n\nContext:\n${context}` }],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI query failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return extractOutputText(payload) || null;
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.length > 0) return payload.output_text;
  return payload?.output
    ?.flatMap((item) => item?.content ?? [])
    ?.filter((item) => item?.type === 'output_text')
    ?.map((item) => item.text)
    ?.join('\n')
    ?.trim() || '';
}

function parseExpansionOutput(text) {
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
}

function dedupeQueries(queries) {
  const seen = new Set();
  const unique = [];
  for (const query of queries) {
    const normalized = query.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(query.trim());
  }
  return unique;
}

function countWords(query) {
  return query.trim().split(/\s+/).filter(Boolean).length;
}

function sanitizeQueryForPrompt(query) {
  const maxQueryChars = 500;
  let sanitized = query;
  if (sanitized.length > maxQueryChars) sanitized = sanitized.slice(0, maxQueryChars);
  sanitized = sanitized.replace(/```[\s\S]*?```/g, ' ');
  sanitized = sanitized.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  sanitized = sanitized.replace(/^(\s*(ignore|forget|disregard|override|system|assistant|human)[\s:]+)+/gi, '');
  return sanitized.replace(/\s+/g, ' ').trim();
}

function sanitizeExpansionOutput(alternatives) {
  const maxQueryChars = 500;
  const seen = new Set();
  const output = [];

  for (const raw of alternatives) {
    if (typeof raw !== 'string') continue;
    let sanitized = raw.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!sanitized) continue;
    if (sanitized.length > maxQueryChars) sanitized = sanitized.slice(0, maxQueryChars);
    const key = sanitized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(sanitized);
    if (output.length >= 2) break;
  }

  return output;
}
