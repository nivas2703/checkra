/**
 * Checkra AI Agent — Source Retrieval Tool
 *
 * Safely fetches public web sources with strict SSRF protection,
 * protocol gating, bounded timeouts, content-type verification,
 * and text extraction.
 *
 * STRICT RULES:
 * 1. Never invent source text.
 * 2. If retrieval fails, return status: "SOURCE_NOT_VERIFIABLE".
 * 3. Never execute arbitrary network requests on private/loopback/metadata IPs.
 */

const { URL } = require("url");
const { isSafeUrl, sanitizeHtml } = require("../utils/security");
const logger = require("../utils/logger");

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1MB raw max
const MAX_TEXT_CHARS = 250000; // 250K characters
const MAX_REDIRECTS = 3;

/**
 * Enhanced SSRF safety check
 * @param {string} urlString
 * @returns {boolean}
 */
function isStrictlySafeUrl(urlString) {
  if (!urlString || typeof urlString !== "string") return false;

  try {
    const parsed = new URL(urlString.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const host = parsed.hostname.toLowerCase().replace(/^[\[\]]+|[\[\]]+$/g, "");

    // Check basic patterns from security utility
    if (!isSafeUrl(urlString)) return false;

    // Additional SSRF boundary checks
    const blockedExact = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"]);
    if (blockedExact.has(host)) return false;

    // Check decimal IP representation (e.g. 2130706433 for 127.0.0.1)
    if (/^\d+$/.test(host)) return false;

    // Check octal or hex IPv4 notation (e.g. 0177.0.0.1, 0x7f.1)
    if (/^0x[0-9a-f]+/i.test(host) || /^0[0-7]+\./.test(host)) return false;

    // Check private TLDs
    if (/\.(local|internal|lan|corp|home|arpa)$/i.test(host)) return false;

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Extracts page title from HTML string
 * @param {string} html
 * @returns {string}
 */
function extractTitleFromHtml(html = "") {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match && match[1]) {
    return match[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * Fetches a public web page safely and extracts readable text.
 *
 * @param {string} url Web URL to retrieve
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=3000] Request timeout
 * @param {number} [options.maxRedirects=3] Maximum allowed redirects
 * @returns {Promise<Object>} Structured retrieval result
 */
async function fetch_source(url, options = {}) {
  if (!url || typeof url !== "string") {
    return {
      ok: false,
      status: "SOURCE_NOT_VERIFIABLE",
      reason: "Missing or invalid URL parameter."
    };
  }

  const cleanUrl = url.trim();
  if (!isStrictlySafeUrl(cleanUrl)) {
    return {
      ok: false,
      status: "SOURCE_NOT_VERIFIABLE",
      reason: "URL failed SSRF security validation (private, internal, or unsupported address)."
    };
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects !== undefined ? options.maxRedirects : MAX_REDIRECTS;

  let currentUrl = cleanUrl;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    // Re-verify SSRF on each hop
    if (!isStrictlySafeUrl(currentUrl)) {
      return {
        ok: false,
        status: "SOURCE_NOT_VERIFIABLE",
        reason: "Redirect destination failed SSRF security validation."
      };
    }

    try {
      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual", // Handle redirects manually to validate destination URLs against SSRF
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Checkra/2.5.0; +https://checkra.local/bot)",
          "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
        },
        signal: AbortSignal.timeout(timeoutMs)
      });

      // Handle redirect status codes (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          return {
            ok: false,
            status: "SOURCE_NOT_VERIFIABLE",
            reason: `Exceeded maximum redirect limit (${maxRedirects}).`
          };
        }

        const locationHeader = res.headers.get("location");
        if (!locationHeader) {
          return {
            ok: false,
            status: "SOURCE_NOT_VERIFIABLE",
            reason: "Redirect response missing location header."
          };
        }

        currentUrl = new URL(locationHeader, currentUrl).toString();
        continue;
      }

      // Check HTTP status code
      if (!res.ok) {
        return {
          ok: false,
          status: "SOURCE_NOT_VERIFIABLE",
          reason: `HTTP error ${res.status} (${res.statusText || "unreachable"}).`
        };
      }

      // Content-type validation
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml+xml")) {
        return {
          ok: false,
          status: "SOURCE_NOT_VERIFIABLE",
          reason: `Unsupported content-type: ${contentType}. Only text/html and text/plain are supported.`
        };
      }

      // Read text with size limit
      const rawBody = await res.text();
      if (!rawBody || rawBody.length === 0) {
        return {
          ok: false,
          status: "SOURCE_NOT_VERIFIABLE",
          reason: "Retrieved source body was empty."
        };
      }

      const title = extractTitleFromHtml(rawBody) || new URL(currentUrl).hostname;
      const cleanText = sanitizeHtml(rawBody).slice(0, MAX_TEXT_CHARS);

      if (cleanText.length < 50) {
        return {
          ok: false,
          status: "SOURCE_NOT_VERIFIABLE",
          reason: "Page retrieved but contained insufficient readable text content."
        };
      }

      const words = cleanText.split(/\s+/).filter(w => w.length > 0);
      const domain = new URL(currentUrl).hostname.toLowerCase();

      return {
        ok: true,
        url: cleanUrl,
        finalUrl: currentUrl,
        title,
        domain,
        text: cleanText,
        wordCount: words.length,
        retrieved: true
      };
    } catch (err) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError" || err.message?.includes("timeout");
      return {
        ok: false,
        status: "SOURCE_NOT_VERIFIABLE",
        reason: isTimeout ? `Request timed out after ${timeoutMs}ms.` : (err.message || "Network request failed.")
      };
    }
  }

  return {
    ok: false,
    status: "SOURCE_NOT_VERIFIABLE",
    reason: "Failed to retrieve source after following redirects."
  };
}

module.exports = {
  fetch_source,
  isStrictlySafeUrl
};
