/**
 * Checkra AI Agent — Web Search Tool
 *
 * Provider-agnostic web search for candidate source discovery.
 * STRICT RULE: Search results and snippets are for DISCOVERY ONLY.
 * Search result snippets MUST NEVER be marked or claimed as VERIFIED.
 *
 * Reuses existing Checkra search infrastructure:
 * 1. SearXNG (if reachable and configured)
 * 2. Wikipedia Public Web Search Fallback
 * 3. External configured search API (if specified)
 */

const { URL } = require("url");
const {
  searchWebWithSearXNG,
  searchWebWithWikipedia,
  queryExternalSearchApi,
  isLocalhostReachable
} = require("../providers/searchProvider");
const logger = require("../utils/logger");

/**
 * Extracts a safe hostname domain from a URL string
 * @param {string} urlStr
 * @returns {string}
 */
function extractDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch (e) {
    return "unknown";
  }
}

/**
 * Searches the web for candidate sources matching a query.
 *
 * @param {string} query Search query string
 * @param {Object} [options] Search options
 * @param {number} [options.maxResults=5] Maximum number of results to return
 * @param {string} [options.provider] Optional provider override
 * @param {number} [options.timeoutMs=3000] Timeout budget for the search
 * @returns {Promise<Object>} Structured search result or structured SEARCH_UNAVAILABLE error
 */
async function web_search(query, options = {}) {
  if (!query || typeof query !== "string" || !query.trim()) {
    return {
      ok: false,
      status: "INVALID_QUERY",
      message: "A non-empty query string is required for web search."
    };
  }

  const cleanQuery = query.trim();
  const maxResults = Math.min(10, Math.max(1, options.maxResults || 5));
  const timeoutMs = options.timeoutMs || 3000;

  const searxngUrl = options.searxngUrl || process.env.SEARCH_API_URL;
  const searchEngine = options.searchEngine || process.env.SEARCH_ENGINE || "";
  const searchApiKey = options.searchApiKey || process.env.SEARCH_API_KEY;

  let providerUsed = "unknown";
  let rawResults = [];

  try {
    // 1. Try SearXNG if configured
    if (searxngUrl && searxngUrl.includes(":8080")) {
      const reachable = await isLocalhostReachable(searxngUrl, 800);
      if (reachable) {
        try {
          rawResults = await searchWebWithSearXNG(cleanQuery, searxngUrl);
          providerUsed = "searxng";
        } catch (searxErr) {
          logger.warn("SearXNG search failed, falling back to public web search", { error: searxErr.message });
        }
      }
    }

    // 2. Try External Search API if configured (e.g. SerpAPI, Google CSE)
    if (rawResults.length === 0 && searxngUrl && !searxngUrl.includes(":8080") && !searxngUrl.includes("wikipedia.org")) {
      try {
        rawResults = await queryExternalSearchApi(cleanQuery, searxngUrl, searchApiKey, searchEngine);
        providerUsed = searchEngine || "external_api";
      } catch (extErr) {
        logger.warn("External search API failed, falling back to public web search", { error: extErr.message });
      }
    }

    // 3. Public Web Search Fallback (Wikipedia Open Search & Query Search)
    if (rawResults.length === 0) {
      try {
        rawResults = await searchWebWithWikipedia(cleanQuery);
        providerUsed = "wikipedia";
      } catch (wikiErr) {
        logger.warn("Wikipedia fallback search failed", { error: wikiErr.message });
      }
    }

    // If all providers yielded zero results or failed
    if (!rawResults || rawResults.length === 0) {
      return {
        ok: false,
        status: "SEARCH_UNAVAILABLE",
        message: "Web search is temporarily unavailable."
      };
    }

    // Format structured output with strict rank and discovery status
    const formattedResults = rawResults
      .slice(0, maxResults)
      .map((item, index) => ({
        title: item.title || "Untitled Web Source",
        url: item.url || "",
        snippet: (item.snippet || "").trim(),
        sourceDomain: extractDomain(item.url),
        rank: index + 1
      }))
      .filter(item => item.url && (item.url.startsWith("http://") || item.url.startsWith("https://")));

    if (formattedResults.length === 0) {
      return {
        ok: false,
        status: "SEARCH_UNAVAILABLE",
        message: "Web search is temporarily unavailable."
      };
    }

    return {
      ok: true,
      provider: providerUsed,
      query: cleanQuery,
      results: formattedResults
    };
  } catch (err) {
    logger.error("Web search tool encountered an unexpected error", { error: err.message, query: cleanQuery });
    return {
      ok: false,
      status: "SEARCH_UNAVAILABLE",
      message: "Web search is temporarily unavailable."
    };
  }
}

module.exports = {
  web_search,
  extractDomain
};
