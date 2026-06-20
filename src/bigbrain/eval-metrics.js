export const METRIC_GLOSSARY = Object.freeze({
  hit_at_1: 'Share of cases where a relevant source is ranked first.',
  hit_at_3: 'Share of cases where a relevant source appears in the top three results.',
  mrr: 'Mean reciprocal rank of the first relevant source; higher means relevant sources appear earlier.',
  recall_at_k: 'Share of relevant sources returned within the requested result limit.',
  negative_clean_rate: 'Share of hard-negative cases where forbidden sources do not appear.',
  jaccard_at_k: 'Overlap between two top-k result sets divided by their union.',
  top1_stability: 'Share of replayed cases where the top result is unchanged.',
  mean_latency_delta_ms: 'Average current latency minus baseline latency in milliseconds.',
});

export function metricGlossary(keys = Object.keys(METRIC_GLOSSARY)) {
  return Object.fromEntries(keys
    .filter((key) => METRIC_GLOSSARY[key])
    .map((key) => [key, METRIC_GLOSSARY[key]]));
}
