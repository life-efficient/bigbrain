const STORAGE_KEY = 'bigbrain:error-reports';
const MAX_REPORTS = 25;
const DEDUPE_WINDOW_MS = 10_000;

export function recordDashboardError({ source, error, errorInfo } = {}) {
  const normalized = normalizeError(error);
  const report = {
    id: `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: new Date().toISOString(),
    source: source || 'dashboard',
    error: normalized,
    componentStack: trim(errorInfo?.componentStack),
    appVersion: document.querySelector('meta[name="bigbrain-version"]')?.content || null,
    userAgent: trim(window.navigator?.userAgent, 500),
    url: trim(window.location?.href, 500),
  };

  try {
    const previous = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    const last = previous[previous.length - 1];
    if (last && last.error?.message === report.error.message && last.error?.stack === report.error.stack
      && Date.now() - Date.parse(last.recordedAt) < DEDUPE_WINDOW_MS) {
      return last;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...previous, report].slice(-MAX_REPORTS)));
  } catch {
    // Diagnostics must never prevent the recovery UI from rendering.
  }
  return report;
}

function normalizeError(error) {
  if (error instanceof Error) return { name: error.name, message: trim(error.message), stack: trim(error.stack) };
  if (error && typeof error === 'object') return { message: trim(error.message || error.reason || JSON.stringify(error)) };
  return { message: trim(error) };
}

function trim(value, max = 8_000) {
  if (value == null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
