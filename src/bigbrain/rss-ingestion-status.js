// Configuration owns feed identity. Verified ingestion remains authoritative in
// the operational ledger, so reads project it without rewriting configuration.
export async function withRssIngestionStatus(listeners, { readLedgerStatus = readRssLedgerStatus } = {}) {
  if (!listeners.some((listener) => listener.type === 'rss')) return listeners;
  let snapshot;
  let unavailable = false;
  try {
    snapshot = await readLedgerStatus();
  } catch {
    unavailable = true;
  }
  const feeds = new Map((snapshot?.feeds || []).map((feed) => [feed.feed_id, feed]));
  return listeners.map((listener) => {
    if (listener.type !== 'rss') return listener;
    const feed = feeds.get(listener.id);
    return {
      ...listener,
      ingestion: {
        status: unavailable ? 'unavailable' : feed ? 'tracked' : 'uninitialized',
        filed_low_watermark: feed?.filed_low_watermark ?? null,
        filed_high_watermark: feed?.filed_high_watermark ?? null,
        outstanding_count: feed?.outstanding_count ?? null,
        coverage: 'verified_articles_with_possible_gaps',
      },
    };
  });
}

async function readRssLedgerStatus() {
  const { openRssLedger } = await import('./rss-ledger.js');
  const ledger = openRssLedger({ readOnly: true });
  if (!ledger) return null;
  try {
    return ledger.status();
  } finally {
    ledger.close();
  }
}
