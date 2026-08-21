function dashboardReadyUrl(dashboardUrl) {
  const readyUrl = new URL(dashboardUrl);
  readyUrl.pathname = '/ready';
  readyUrl.search = '';
  readyUrl.hash = '';
  return readyUrl.toString();
}

async function waitForDashboardReady(dashboardUrl, {
  fetchImpl = fetch,
  attempts = 90,
  intervalMs = 500,
  requestTimeoutMs = 2_000,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  const readyUrl = dashboardReadyUrl(dashboardUrl);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(readyUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) {
        const readiness = await response.json();
        if (readiness?.ok === true && readiness?.status === 'ready') return readiness;
      }
    } catch {
      // Connection refusal and short service restarts are normal during desktop startup.
    }
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw new Error('BigBrain is taking longer than expected to start. Try opening it again in a moment.');
}

module.exports = { dashboardReadyUrl, waitForDashboardReady };
