/**
 * VeriWrite Structured Logger
 * Logs lifecycle events in structured JSON or clean console format.
 * Redacts secrets, tokens, and private documents.
 */

const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "../../data/logs.jsonl");

// Ensure data dir exists
try {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
} catch (e) {
  // ignore
}

function sanitizeMeta(meta = {}) {
  const cleaned = { ...meta };
  // Redact potential secret keys
  for (const key of Object.keys(cleaned)) {
    if (/key|secret|token|password|auth/i.test(key)) {
      cleaned[key] = "[REDACTED]";
    } else if (key === "text" && typeof cleaned[key] === "string" && cleaned[key].length > 100) {
      cleaned[key] = cleaned[key].slice(0, 100) + "... [truncated]";
    }
  }
  return cleaned;
}

function logEvent(event, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...sanitizeMeta(meta)
  };

  const line = JSON.stringify(entry);
  console.log(`[VeriWrite:${event}]`, JSON.stringify(sanitizeMeta(meta)));

  try {
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch (err) {
    // Non-fatal if log file cannot be appended
  }
}

module.exports = {
  logEvent,
  info: (msg, meta) => logEvent("INFO", { message: msg, ...meta }),
  warn: (msg, meta) => logEvent("WARN", { message: msg, ...meta }),
  error: (msg, meta) => logEvent("ERROR", { message: msg, ...meta })
};
