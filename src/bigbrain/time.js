export function parseDuration(value) {
  const trimmed = String(value).trim();
  const match = /^(\d+)([mhd])$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use 15m, 24h, or 7d.`);
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  const unitMs = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * unitMs;
}

export function parseInstant(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName} "${value}". Use an ISO timestamp.`);
  }
  return date;
}

export function resolveWindow({ since, until, stateLastCheckedAt, fallbackDuration, now = new Date() }) {
  const windowEnd = until ? parseInstant(until, '--until') : now;
  const fallbackMs = parseDuration(fallbackDuration);

  let windowStart;
  if (since) {
    windowStart = resolveSinceInput(since, windowEnd);
  } else if (stateLastCheckedAt) {
    windowStart = parseInstant(stateLastCheckedAt, 'last_checked_at');
  } else {
    windowStart = new Date(windowEnd.getTime() - fallbackMs);
  }

  if (windowStart.getTime() > windowEnd.getTime()) {
    throw new Error(`Invalid window: start ${windowStart.toISOString()} is after end ${windowEnd.toISOString()}.`);
  }

  return { windowStart, windowEnd };
}

function resolveSinceInput(value, windowEnd) {
  const trimmed = String(value).trim();
  if (/^\d+[mhd]$/.test(trimmed)) {
    const durationMs = parseDuration(trimmed);
    return new Date(windowEnd.getTime() - durationMs);
  }
  return parseInstant(trimmed, '--since');
}
