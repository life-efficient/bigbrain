const DASHBOARD_ASSET_PATTERNS = [
  /three\/examples\/jsm/i,
  /Could not resolve .*three/i,
  /dashboard asset/i,
  /Build failed with \d+ errors?/i,
];

export function formatServiceInstallError(error, {
  brainName = 'this brain',
  port = null,
  installerPath = null,
} = {}) {
  const message = errorText(error);
  const displayName = JSON.stringify(String(brainName || 'this brain'));
  const portText = Number.isInteger(Number(port)) ? ` on local port ${port}` : '';

  if (isMissingInstaller(message, installerPath)) {
    return `BigBrain could not manage ${displayName} because this desktop build is missing its local service installer. Update or reinstall BigBrain, then try again.`;
  }

  if (/EADDRINUSE|port .*in use|port .*occupied|still in use/i.test(message)) {
    return `BigBrain could not update ${displayName}${portText} because another local service is still using that port. The existing service configuration was left in place. Close the conflicting service, then retry.`;
  }

  if (DASHBOARD_ASSET_PATTERNS.some((pattern) => pattern.test(message))) {
    return `BigBrain could not start ${displayName} because this desktop build is missing dashboard runtime assets. Update or reinstall BigBrain, then retry.`;
  }

  if (/did not become healthy|did not become ready|health check timed out|readiness/i.test(message)) {
    return `BigBrain could not start ${displayName}${portText} because the local service did not become ready. Restart BigBrain and retry.`;
  }

  return `BigBrain could not update ${displayName}${portText}. The local service was not verified. Restart BigBrain and retry.`;
}

function isMissingInstaller(message, installerPath) {
  if (installerPath && message.includes(installerPath) && /ENOENT|no such file|MODULE_NOT_FOUND/i.test(message)) return true;
  return /install-local-mcp-service\.mjs/i.test(message)
    && /Cannot find module|MODULE_NOT_FOUND|no such file|ENOENT|missing/i.test(message);
}

function errorText(error) {
  if (!error) return '';
  return [error.message, error.stderr, error.stdout]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join('\n');
}
