const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_BYTES = 512 * 1024;

function appendLocalErrorLog({ logDirectory, entry, maxEntries = DEFAULT_MAX_ENTRIES, maxBytes = DEFAULT_MAX_BYTES }) {
  fs.mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const logPath = path.join(logDirectory, "errors.jsonl");
  const line = `${JSON.stringify(sanitizeValue(entry))}\n`;
  let existing = "";
  try {
    existing = fs.readFileSync(logPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lines = `${existing}${line}`.trim().split("\n").filter(Boolean).slice(-maxEntries);
  let output = `${lines.join("\n")}\n`;
  while (Buffer.byteLength(output, "utf8") > maxBytes && lines.length > 1) {
    lines.shift();
    output = `${lines.join("\n")}\n`;
  }
  fs.writeFileSync(logPath, output, { mode: 0o600 });
  return logPath;
}

function recordAppError(app, label, error, details = {}) {
  const value = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };
  return appendLocalErrorLog({
    logDirectory: path.join(app.getPath("userData"), "diagnostics"),
    entry: {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      recordedAt: new Date().toISOString(),
      label,
      error: value,
      details,
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    },
  });
}

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === "string") return value.length > 8_000 ? `${value.slice(0, 8_000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, sanitizeValue(item, depth + 1)]));
  }
  return value;
}

module.exports = { appendLocalErrorLog, recordAppError, sanitizeValue };
