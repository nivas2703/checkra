/**
 * VeriWrite Security & Sanitization Utilities
 * SSRF protection, URL validation, and HTML sanitization.
 */

const { URL } = require("url");

// Private IPv4 ranges, loopback, link-local, cloud metadata
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./, // AWS / cloud metadata
  /^\[?::1\]?$/, // IPv6 loopback
  /^\[?(fc00|fd00):/i, // IPv6 Unique local address
  /^\[?fe80:/i, // IPv6 Link-local
  /^instance-data$/i, // AWS metadata alias
  /^metadata$/i, // Cloud metadata alias
  /\.local$/i,
  /\.internal$/i,
  /\.corp$/i,
  /\.lan$/i
];

function isSafeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        return false;
      }
    }
    // Reject single-label internal hosts (e.g. http://instance-data or http://router)
    if (!hostname.includes(".") && hostname !== "localhost") {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function sanitizeHtml(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<sup[\s\S]*?<\/sup>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = {
  isSafeUrl,
  sanitizeHtml,
  escapeHtml
};
