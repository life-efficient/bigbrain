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
          content: [{ type: 'input_text', text: 'Answer only from the provided bigbrain context. Be concise and mention source slugs when relevant.' }],
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
  return payload.output_text || null;
}
