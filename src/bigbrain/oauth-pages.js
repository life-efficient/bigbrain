function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderOAuthCompletePage() {
  return renderOAuthPage({
    title: 'Authorization complete',
    badge: 'Authorization complete',
    heading: 'You can close this page',
    message: 'Sign-in completed successfully. Return to the app to continue.',
  });
}

export function renderOAuthCallbackErrorPage(error) {
  const message = error instanceof Error ? error.message : String(error || 'Authorization could not be completed.');
  return renderOAuthPage({
    title: 'Authorization could not be completed',
    badge: 'Authorization issue',
    heading: 'We could not finish sign-in',
    message,
    error: true,
  });
}

function renderOAuthPage({ title, badge, heading, message, error = false }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #18181b; --muted: #71717a; --line: #e4e4e7; --surface: #fff; --accent: #18181b; --error: #991b1b; --error-bg: #fef2f2; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; color: var(--ink); background: #f4f4f5; font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .card { width: min(100%, 560px); padding: 40px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); box-shadow: 0 24px 70px rgba(24, 24, 27, 0.12); }
    .badge { display: inline-flex; margin-bottom: 20px; padding: 5px 10px; border: 1px solid ${error ? '#fecaca' : '#d4d4d8'}; border-radius: 999px; color: ${error ? 'var(--error)' : 'var(--muted)'}; background: ${error ? 'var(--error-bg)' : '#fafafa'}; font-size: 13px; font-weight: 700; }
    h1 { margin: 0 0 12px; font-size: clamp(30px, 7vw, 48px); line-height: 1.05; letter-spacing: -0.04em; }
    p { margin: 0; color: ${error ? 'var(--error)' : 'var(--muted)'}; }
    .hint { margin-top: 24px; color: var(--muted); font-size: 14px; }
    .button { margin-top: 28px; padding: 11px 16px; border: 1px solid var(--accent); border-radius: 9px; color: #fff; background: var(--accent); font: inherit; font-weight: 700; cursor: pointer; }
    .button:hover { opacity: 0.9; }
    @media (max-width: 560px) { .card { padding: 28px; } .button { width: 100%; } }
  </style>
</head>
<body>
  <main class="card" aria-labelledby="oauth-heading">
    <div class="badge">${escapeHtml(badge)}</div>
    <h1 id="oauth-heading">${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    <button class="button" type="button" onclick="window.close()">Close this page</button>
    <p class="hint">If the page does not close automatically, it is safe to close this tab manually.</p>
  </main>
</body>
</html>`;
}
