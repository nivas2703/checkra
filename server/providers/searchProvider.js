/**
 * VeriWrite Search Provider Abstraction
 * Supports:
 * 1. Gemini Google Search Grounding (if supported and configured)
 * 2. External Search APIs (SerpAPI, Serper, Bing, Google Custom Search, or custom JSON endpoint)
 * 3. Local Comparison Mode when no search provider is configured
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
    .filter(s => s.length >= 35 && s.length <= 260);

  // Sort by informative length
  filtered.sort((a, b) => b.length - a.length);

  const selected = filtered.slice(0, maxQueries);
  return selected.map(sent => {
    // Take 8-14 distinctive words
    return sent.split(/\s+/).slice(0, 12).join(" ");
  });
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
 * 2. SearXNG
 * 3. Local Comparison Mode
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

  // 2. Try SearXNG / External Search if configured
  if (searchApiUrl) {
    const isSearXNG = searchEngine.toLowerCase().includes("searx") || searchApiUrl.includes(":8080");
    logger.logEvent("search_external_started", { queryCount: queries.length, engine: isSearXNG ? "SearXNG" : searchEngine });
    const candidates = [];
    const seenUrls = new Set();
    let searchFailed = false;

    for (const q of queries) {
      try {
        let items = [];
        if (isSearXNG) {
          items = await searchWebWithSearXNG(q, searchApiUrl);
        } else {
          items = await queryExternalSearchApi(q, searchApiUrl, searchApiKey, searchEngine);
        }
        for (const it of items) {
          if (!seenUrls.has(it.url)) {
            seenUrls.add(it.url);
            candidates.push(it);
          }
          if (candidates.length >= maxSources) break;
        }
      } catch (err) {
        searchFailed = true;
        logger.warn("External search query failed", { query: q, error: err.message });
      }
      if (candidates.length >= maxSources) break;
    }

    if (candidates.length > 0 || !searchFailed) {
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

  // 3. Fallback: Neither Gemini Grounding NOR External Search / SearXNG is available
  logger.logEvent("search_mode_fallback", { mode: "local_comparison_mode" });
  const localSources = getLocalReferenceSources();

  let fallbackMessage = "Web checking unavailable. Running local comparison against reference corpus.";
  if (geminiGroundingStatus === "QUOTA_EXHAUSTED") {
    fallbackMessage = "Web checking unavailable. Gemini web grounding is unavailable (API quota exhausted) and SearXNG is unavailable. Running local comparison against reference corpus.";
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
  searchWebWithSearXNG
};
