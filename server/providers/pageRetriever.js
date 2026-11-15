/**
 * VeriWrite Web Page Retriever
 * Safely fetches public web sources with SSRF protection, timeouts,
 * controlled concurrency, and HTML text extraction.
 */

const { isSafeUrl, sanitizeHtml } = require("../utils/security");
const logger = require("../utils/logger");

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function retrievePage(url) {
  if (!isSafeUrl(url)) {
    return {
      status: "INACCESSIBLE",
      reason: "URL failed SSRF security validation",
      text: "",
      retrievedAt: new Date().toISOString()
    };
  }

  try {
    const res = await fetchWithTimeout(
      url,
      {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Checkra/2.5.0; +https://checkra.local/bot)",
          "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
        }
      },
      8000
    );

    if (!res.ok) {
      return {
        status: "INACCESSIBLE",
        reason: `HTTP ${res.status} ${res.statusText}`,
        text: "",
        retrievedAt: new Date().toISOString()
      };
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return {
        status: "INACCESSIBLE",
        reason: `Unsupported content-type: ${contentType}`,
        text: "",
        retrievedAt: new Date().toISOString()
      };
    }

    const rawHtml = await res.text();
    const cleanText = sanitizeHtml(rawHtml).slice(0, 250000);

    if (cleanText.length < 80) {
      return {
        status: "PARTIALLY_VERIFIED",
        reason: "Page retrieved but contained very little readable text",
        text: cleanText,
        retrievedAt: new Date().toISOString()
      };
    }

    logger.logEvent("source_retrieved", { url, bytes: cleanText.length });

    return {
      status: "VERIFIED",
      text: cleanText,
      retrievedAt: new Date().toISOString()
    };
  } catch (err) {
    return {
      status: "INACCESSIBLE",
      reason: err.name === "AbortError" ? "Request timed out" : err.message,
      text: "",
      retrievedAt: new Date().toISOString()
    };
  }
}

/**
 * Concurrently retrieves an array of candidate sources with concurrency limit
 */
async function retrieveMultipleSources(candidates = [], maxConcurrent = 5) {
  const results = [];
  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      const res = await retrievePage(item.url);
      results.push({
        ...item,
        status: res.status,
        reason: res.reason,
        text: res.text,
        retrievedAt: res.retrievedAt
      });
    }
  }

  const workers = [];
  const workerCount = Math.min(maxConcurrent, candidates.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

module.exports = {
  retrievePage,
  retrieveMultipleSources
};
