/**
 * Checkra Search Provider Abstraction
 * Supports:
 * 1. Gemini Google Search Grounding (if supported and configured)
 * 2. External Search APIs (SearXNG, SerpAPI, Serper, Bing, Google Custom Search, or custom JSON endpoint)
 * 3. Public Web Search Fallback (Wikipedia Open Search API)
 * 4. Local Reference Comparison Mode when web search is unavailable
 *
 * Never fabricates web results.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { searchWebWithGeminiGrounding, isGeminiConfigured } = require("../services/geminiService");

const DEMO_SOURCE_PATH = path.join(__dirname, "../../data/demo-source.json");

function getLocalReferenceSources() {
  try {
    if (fs.existsSync(DEMO_SOURCE_PATH)) {
      const raw = fs.readFileSync(DEMO_SOURCE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.map((item, idx) => ({
        title: item.title || `Reference Document #${idx + 1}`,
        url: item.url || `local://reference-${idx + 1}`,
        snippet: (item.text || "").slice(0, 200),
        text: item.text || "",
        sourceType: item.sourceType || "Publication",
        isLocal: true
      }));
    }
  } catch (e) {
    // ignore
  }
  return [];
}

/**
 * Extracts representative search queries from submitted sentences
 */
function generateSearchQueries(sentences = [], maxQueries = 8) {
  const filtered = sentences
    .map(s => (typeof s === "string" ? s : s.raw || ""))
    .map(s => s.trim().replace(/["']/g, ""))
    .filter(s => s.length >= 25 && s.length <= 300);

  // Sort by informative length
  filtered.sort((a, b) => b.length - a.length);

  const selected = filtered.slice(0, maxQueries);
  return selected.map(sent => {
    // Take 8-14 distinctive words
    return sent.split(/\s+/).slice(0, 12).join(" ");
  });
}

/**
 * Fast reachability check for localhost search endpoints to prevent 96-second timeout hanging on Render
 */
async function isLocalhostReachable(url, timeoutMs = 1500) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return true; // External remote URL, proceed with normal execution
    }
    // Fast probe: /healthz responds in ~4ms when running, immediately ECONNREFUSED when offline
    try {
      const resHealth = await fetch(`${parsed.origin}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
      if (resHealth.ok) return true;
    } catch (e) {
      // fallback to origin probe
    }
    const res = await fetch(`${parsed.origin}/`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok || res.status === 404;
  } catch (e) {
    return false;
  }
}

/**
 * Queries local/self-hosted SearXNG metasearch instance
 * Endpoint: GET /search?q=<query>&format=json
 */
async function searchWebWithSearXNG(query, apiUrl = "http://localhost:8080/search") {
  if (!apiUrl) return [];
  const urlObj = new URL(apiUrl);
  urlObj.searchParams.set("q", query);
  urlObj.searchParams.set("format", "json");

  const res = await fetch(urlObj.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Checkra-AI-Web-Checker/2.5.0"
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!res.ok) {
    throw new Error(`SearXNG returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const results = data.results || [];
  return results.map(item => ({
    title: item.title || "Untitled Web Source",
    url: item.url || "",
    snippet: item.content || item.snippet || "",
    engine: item.engine || "searxng",
    isLocal: false
  })).filter(x => x.url && x.url.startsWith("http"));
}

/**
 * Public Web Search Fallback (Wikipedia Open Search API)
 * Enables zero-config, production-safe public web search without requiring a local Docker container.
 */
async function searchWebWithWikipedia(query) {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.replace(/[^\w\s]/g, " ").trim().split(/\s+/).slice(0, 8).join(" ");
  if (!cleanQuery) return [];

  const urlObj = new URL("https://en.wikipedia.org/w/api.php");
  urlObj.searchParams.set("action", "query");
  urlObj.searchParams.set("list", "search");
  urlObj.searchParams.set("srsearch", cleanQuery);
  urlObj.searchParams.set("utf8", "1");
  urlObj.searchParams.set("format", "json");
  urlObj.searchParams.set("origin", "*");

  const res = await fetch(urlObj.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; Checkra/2.5.0; +https://checkra.local/bot)"
    },
    signal: AbortSignal.timeout(8000)
  });

  if (!res.ok) {
    throw new Error(`Wikipedia search returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const searchResults = data.query?.search || [];
  return searchResults.map(item => ({
    title: item.title ? `${item.title} — Wikipedia` : "Wikipedia Web Source",
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
    snippet: (item.snippet || "").replace(/<[^>]+>/g, ""),
    engine: "wikipedia",
    isLocal: false
  })).filter(x => x.url && x.url.startsWith("http"));
}

/**
 * Queries an external search API (Serper, SerpAPI, Bing, Google CSE, custom)
 */
async function queryExternalSearchApi(query, apiUrl, apiKey, engine = "") {
  if (!apiUrl) return [];

  const urlObj = new URL(apiUrl);
  if (apiUrl.includes("wikipedia.org")) {
    urlObj.searchParams.set("srsearch", query);
  } else {
    urlObj.searchParams.set("q", query);
  }
  if (apiKey) urlObj.searchParams.set("key", apiKey);

  const headers = { Accept: "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["X-API-KEY"] = apiKey;
  }

  const res = await fetch(urlObj.toString(), { headers, signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    throw new Error(`Search provider returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const items = data.items || data.organic || data.results || data.webPages?.value || data.query?.search || [];
  return items
    .map(item => ({
      title: item.title || item.name || "Untitled Web Source",
      url: item.url || item.link || (item.title && item.pageid ? `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}` : ""),
      snippet: item.snippet || item.description || item.snippet_highlighted_words?.join(" ") || "",
      isLocal: false
    }))
    .filter(x => x.url && !x.url.startsWith("javascript:"));
}

/**
 * Unified Candidate Source Discovery
 * Provider Priority:
 * 1. Gemini Web Grounding
 * 2. SearXNG / Configured Search API
 * 3. Public Web Search Fallback (Wikipedia Open Search)
 * 4. Local Reference Comparison Mode
 */
async function discoverCandidateSources(documentText, sentences = [], options = {}) {
  const searchApiUrl = options.searchApiUrl || process.env.SEARCH_API_URL;
  const searchApiKey = options.searchApiKey || process.env.SEARCH_API_KEY;
  const searchEngine = options.searchEngine || process.env.SEARCH_ENGINE || "";
  const maxQueries = options.maxSearchQueries || Number(process.env.MAX_SEARCH_QUERIES || 8);
  const maxSources = options.maxSources || Number(process.env.MAX_SOURCES || 20);

  const queries = generateSearchQueries(sentences, maxQueries);

  let geminiGroundingStatus = isGeminiConfigured() ? "NOT_TESTED" : "NOT_CONFIGURED";
  let geminiGroundingError = null;

  // 1. Try Gemini Search Grounding if configured
  if (isGeminiConfigured() && (options.useGeminiGrounding !== false)) {
    const groundingResult = await searchWebWithGeminiGrounding(documentText, queries);
    if (groundingResult.supported && groundingResult.grounded && groundingResult.sources.length > 0) {
      logger.logEvent("search_grounding_success", { count: groundingResult.sources.length });
      return {
        mode: "GEMINI_GROUNDING",
        modeLabel: "Gemini Web Grounding",
        message: "Web sources discovered via official Gemini Google Search grounding.",
        groundingStatus: "AVAILABLE",
        queries: groundingResult.queries || queries,
        sources: groundingResult.sources.slice(0, maxSources)
      };
    } else {
      const errText = groundingResult.error || "";
      if (errText.includes("429") || errText.includes("RESOURCE_EXHAUSTED")) {
        geminiGroundingStatus = "QUOTA_EXHAUSTED";
        geminiGroundingError = "Gemini Web Grounding unavailable: API quota exhausted.";
      } else {
        geminiGroundingStatus = "UNAVAILABLE";
        geminiGroundingError = groundingResult.error || "Gemini web grounding returned no candidate sources.";
      }
    }
  }

  const candidates = [];
  const seenUrls = new Set();
  let searchFailed = false;

  // 2. Try SearXNG / External Search if configured
  if (searchApiUrl) {
    const isSearXNG = searchEngine.toLowerCase().includes("searx") || searchApiUrl.includes(":8080");
    const isLocalhost = searchApiUrl.includes("localhost") || searchApiUrl.includes("127.0.0.1");

    let canAttemptExternal = true;
    if (isLocalhost) {
      const reachable = await isLocalhostReachable(searchApiUrl, 400);
      if (!reachable) {
        canAttemptExternal = false;
        searchFailed = true;
        logger.warn("Local search endpoint unreachable on this host, skipping to production web search fallback", { url: searchApiUrl });
      }
    }

    if (canAttemptExternal) {
      logger.logEvent("search_external_started", { queryCount: queries.length, engine: isSearXNG ? "SearXNG" : searchEngine });

      const perQueryLimit = Math.max(4, Math.ceil(maxSources / Math.max(1, queries.length)));
      for (const q of queries) {
        try {
          let items = [];
          if (isSearXNG) {
            items = await searchWebWithSearXNG(q, searchApiUrl);
          } else {
            items = await queryExternalSearchApi(q, searchApiUrl, searchApiKey, searchEngine);
          }
          let queryAdded = 0;
          for (const it of items) {
            if (!seenUrls.has(it.url)) {
              seenUrls.add(it.url);
              candidates.push(it);
              queryAdded++;
            }
            if (queryAdded >= perQueryLimit || candidates.length >= maxSources) break;
          }
        } catch (err) {
          searchFailed = true;
          logger.warn("External search query failed", { query: q, error: err.message });
        }
        if (candidates.length >= maxSources) break;
      }

      if (candidates.length > 0) {
        const modeLabel = isSearXNG ? "SearXNG Web Search" : "External Web Search";
        let statusMsg = `Retrieved ${candidates.length} candidate source URLs via ${isSearXNG ? "SearXNG" : "configured external search"}.`;
        if (geminiGroundingStatus === "QUOTA_EXHAUSTED" || geminiGroundingError) {
          statusMsg = "Gemini Grounding unavailable — using SearXNG fallback.";
        }
        return {
          mode: "EXTERNAL_SEARCH",
          modeLabel,
          message: statusMsg,
          groundingStatus: geminiGroundingStatus,
          groundingError: geminiGroundingError,
          queries,
          sources: candidates
        };
      }
    }
  }

  // 2b. Public Web Search Fallback (Wikipedia Open Search)
  // Provides production-ready public web search when NO external search URL is configured or when wikipedia search is requested
  const isExplicitExternalSearchFailure = Boolean(searchApiUrl && searchFailed);
  if (candidates.length === 0 && !isExplicitExternalSearchFailure && (options.disablePublicWebSearch !== true)) {
    try {
      logger.logEvent("public_web_search_started", { queryCount: queries.length, engine: "Wikipedia" });
      const perQueryLimit = Math.max(4, Math.ceil(maxSources / Math.max(1, queries.length)));
      for (const q of queries) {
        try {
          const wikiItems = await searchWebWithWikipedia(q);
          let queryAdded = 0;
          for (const it of wikiItems) {
            if (!seenUrls.has(it.url)) {
              seenUrls.add(it.url);
              candidates.push(it);
              queryAdded++;
            }
            if (queryAdded >= perQueryLimit || candidates.length >= maxSources) break;
          }
        } catch (e) {
          // continue with remaining queries
        }
        if (candidates.length >= maxSources) break;
      }

      if (candidates.length > 0) {
        let statusMsg = `Retrieved ${candidates.length} candidate source URLs via public web search.`;
        if (geminiGroundingStatus === "QUOTA_EXHAUSTED" || geminiGroundingError) {
          statusMsg = "Gemini Grounding unavailable — using public web search fallback.";
        }
        return {
          mode: "EXTERNAL_SEARCH",
          modeLabel: "Public Web Search",
          message: statusMsg,
          groundingStatus: geminiGroundingStatus,
          groundingError: geminiGroundingError,
          queries,
          sources: candidates
        };
      }
    } catch (wikiErr) {
      logger.warn("Public web search fallback encountered error", { error: wikiErr.message });
    }
  }

  // 3. Fallback: Neither Gemini Grounding, nor External Search, nor Public Search produced candidates
  logger.logEvent("search_mode_fallback", { mode: "local_comparison_mode" });
  const localSources = getLocalReferenceSources();

  let fallbackMessage = "Web search unavailable. Local similarity analysis completed against reference corpus.";
  if (geminiGroundingStatus === "QUOTA_EXHAUSTED") {
    fallbackMessage = "Web search unavailable (Gemini quota exhausted and external search offline). Local similarity analysis completed against reference corpus.";
  }

  return {
    mode: "LOCAL_COMPARISON",
    modeLabel: "Local Comparison — Web checking unavailable",
    message: fallbackMessage,
    groundingStatus: geminiGroundingStatus,
    groundingError: geminiGroundingError,
    queries,
    sources: localSources
  };
}

module.exports = {
  generateSearchQueries,
  discoverCandidateSources,
  getLocalReferenceSources,
  queryExternalSearchApi,
  searchWebWithSearXNG,
  searchWebWithWikipedia,
  isLocalhostReachable
};
