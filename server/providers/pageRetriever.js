/**
 * Checkra Web Page Retriever
 * Safely fetches public web sources with SSRF protection, timeouts,
 * controlled concurrency, and HTML text extraction.
 *
 * Strict Rule: Search results / snippets are NOT evidence.
 * Unreachable pages (403, 404, 500, timeouts) are marked SOURCE_NOT_VERIFIABLE.
 */

const { isSafeUrl, sanitizeHtml } = require("../utils/security");
const logger = require("../utils/logger");

async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
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

async function retrievePage(url, timeoutMs = 2000) {
  if (!isSafeUrl(url)) {
    return {
      status: "SOURCE_NOT_VERIFIABLE",
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
      timeoutMs
    );

    if (!res.ok) {
      return {
        status: "SOURCE_NOT_VERIFIABLE",
        reason: `HTTP ${res.status} ${res.statusText}`,
        text: "",
        retrievedAt: new Date().toISOString()
      };
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return {
        status: "SOURCE_NOT_VERIFIABLE",
        reason: `Unsupported content-type: ${contentType}`,
        text: "",
        retrievedAt: new Date().toISOString()
      };
    }

    const rawHtml = await res.text();
    const cleanText = sanitizeHtml(rawHtml).slice(0, 250000);

    if (cleanText.length < 80) {
      return {
        status: "SOURCE_NOT_VERIFIABLE",
        reason: "Page retrieved but contained insufficient readable text",
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
      status: "SOURCE_NOT_VERIFIABLE",
      reason: err.name === "AbortError" ? "Request timed out" : err.message,
      text: "",
      retrievedAt: new Date().toISOString()
    };
  }
}

/**
 * Concurrently retrieves candidate sources with bounded concurrency and strict overall time budget
 */
async function retrieveMultipleSources(candidates = [], maxConcurrent = 4, overallBudgetMs = 3200) {
  const targetCandidates = (candidates || []).slice(0, 8);
  const results = [];
  const queue = [...targetCandidates];

  let budgetExpired = false;

  async function worker() {
    while (queue.length > 0 && !budgetExpired) {
      const item = queue.shift();
      if (!item) break;
      const res = await retrievePage(item.url, 1800);
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
  const workerCount = Math.min(maxConcurrent, targetCandidates.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  const timeoutPromise = new Promise((resolve) => setTimeout(() => {
    budgetExpired = true;
    resolve("TIMEOUT");
  }, overallBudgetMs));

  await Promise.race([
    Promise.all(workers),
    timeoutPromise
  ]);

  // For any remaining items in queue that were not processed before budget expired
  while (queue.length > 0) {
    const remaining = queue.shift();
    if (remaining) {
      results.push({
        ...remaining,
        status: "SOURCE_NOT_VERIFIABLE",
        reason: "Retrieval timed out",
        text: "",
        retrievedAt: new Date().toISOString()
      });
    }
  }

  return results;
}

module.exports = {
  retrievePage,
  retrieveMultipleSources
};
