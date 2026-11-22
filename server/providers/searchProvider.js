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
function generateSearchQueries(sentences = [], maxQueries = 4) {
  const filtered = sentences
    .map(s => (typeof s === "string" ? s : s.raw || ""))
    .map(s => s.trim().replace(/["']/g, ""))
    .filter(s => s.length >= 25 && s.length <= 400);

  if (filtered.length === 0) return [];

  // Sample across the document: always include lead sentence, then sample evenly
  const selected = [];
  if (filtered.length <= maxQueries) {
    selected.push(...filtered);
  } else {
    selected.push(filtered[0]);
    const step = (filtered.length - 1) / (maxQueries - 1);
    for (let i = 1; i < maxQueries; i++) {
      const idx = Math.min(filtered.length - 1, Math.round(i * step));
      if (!selected.includes(filtered[idx])) {
        selected.push(filtered[idx]);
      }
    }
  }

  return selected.map(sent => {
    return sent.split(/\s+/).slice(0, 14).join(" ");
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
    signal: AbortSignal.timeout(2000)
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
 * Public Web Search Fallback (Wikipedia Open Search & Query Search)
 * Enables zero-config, production-safe public web search without requiring a local Docker container.
 */
async function searchWebWithWikipedia(query) {
  if (!query || !query.trim()) return [];

  const words = query.replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];

  // Filter noise words for targeted entity and topical matching
  const QUERY_NOISE = new Set([
    "the", "this", "that", "these", "those", "in", "on", "at", "to", "for", "from",
    "by", "with", "about", "into", "through", "during", "before", "after", "is", "are",
    "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
    "can", "could", "should", "would", "may", "might", "must", "and", "or", "but", "so",
    "also", "sometimes", "called", "known", "named", "often", "usually"
  ]);
  const cleanWords = words.filter(w => !QUERY_NOISE.has(w.toLowerCase()));

  const topicQuery = (cleanWords.length > 0 ? cleanWords : words).slice(0, 3).join(" ");
  const fullQuery = (cleanWords.length > 0 ? cleanWords : words).slice(0, 7).join(" ");

  const results = [];
  const seenUrls = new Set();

  // 1. Entity/Topic Prefix Search via Wikipedia Opensearch (fast, high precision)
  if (topicQuery) {
    try {
      const osUrl = new URL("https://en.wikipedia.org/w/api.php");
      osUrl.searchParams.set("action", "opensearch");
      osUrl.searchParams.set("search", topicQuery);
      osUrl.searchParams.set("limit", "5");
      osUrl.searchParams.set("namespace", "0");
      osUrl.searchParams.set("format", "json");

      const resOs = await fetch(osUrl.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Checkra/2.5.0; +https://checkra.local/bot)"
        },
        signal: AbortSignal.timeout(1500)
      });

      if (resOs.ok) {
        const dataOs = await resOs.json();
        const titles = dataOs[1] || [];
        const snippets = dataOs[2] || [];
        const urls = dataOs[3] || [];
        for (let i = 0; i < urls.length; i++) {
          if (urls[i] && !seenUrls.has(urls[i])) {
            seenUrls.add(urls[i]);
            results.push({
              title: titles[i] ? `${titles[i]} — Wikipedia` : "Wikipedia Web Source",
              url: urls[i],
              snippet: snippets[i] || "",
              engine: "wikipedia",
              isLocal: false
            });
          }
        }
      }
    } catch (e) {
      // Opensearch probe non-fatal
    }
  }

  // 2. Full-text search via Wikipedia Query Search (broader article discovery)
  if (fullQuery) {
    try {
      const urlObj = new URL("https://en.wikipedia.org/w/api.php");
      urlObj.searchParams.set("action", "query");
      urlObj.searchParams.set("list", "search");
      urlObj.searchParams.set("srsearch", fullQuery);
      urlObj.searchParams.set("utf8", "1");
      urlObj.searchParams.set("format", "json");
      urlObj.searchParams.set("origin", "*");

      const res = await fetch(urlObj.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Checkra/2.5.0; +https://checkra.local/bot)"
        },
        signal: AbortSignal.timeout(1800)
      });

      if (res.ok) {
        const data = await res.json();
        const searchResults = data.query?.search || [];
        for (const item of searchResults) {
          const u = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`;
          if (u && !seenUrls.has(u)) {
            seenUrls.add(u);
            results.push({
              title: item.title ? `${item.title} — Wikipedia` : "Wikipedia Web Source",
              url: u,
              snippet: (item.snippet || "").replace(/<[^>]+>/g, ""),
              engine: "wikipedia",
              isLocal: false
            });
          }
        }
      }
    } catch (e) {
      // Search non-fatal
    }
  }

  return results;
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

  const res = await fetch(urlObj.toString(), { headers, signal: AbortSignal.timeout(2000) });
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
 * Executes a list of search queries concurrently bounded by a strict time budget
 */
async function executeQueriesWithBudget(queries, searchFn, maxSources, budgetMs = 2500) {
  const candidates = [];
  const seenUrls = new Set();
  const perQueryLimit = Math.max(3, Math.ceil(maxSources / Math.max(1, queries.length)));

  const searchPromises = queries.map(async (q) => {
    try {
      return (await searchFn(q)) || [];
    } catch (e) {
      return [];
    }
  });

  let timedOut = false;
  const timeoutPromise = new Promise((resolve) => setTimeout(() => {
    timedOut = true;
    resolve(null);
  }, budgetMs));

  const raceResult = await Promise.race([
    Promise.allSettled(searchPromises),
    timeoutPromise
  ]);

  if (Array.isArray(raceResult)) {
    const queryResults = raceResult
      .filter(r => r.status === "fulfilled" && Array.isArray(r.value))
      .map(r => r.value);

    let maxDepth = 0;
    queryResults.forEach(arr => {
      if (arr.length > maxDepth) maxDepth = arr.length;
    });

    // Round-robin interleave results so every query gets represented in candidate pool
    for (let depth = 0; depth < maxDepth; depth++) {
      for (const list of queryResults) {
        if (depth < list.length) {
          const it = list[depth];
          if (it && it.url && !seenUrls.has(it.url)) {
            seenUrls.add(it.url);
            candidates.push(it);
          }
        }
        if (candidates.length >= maxSources) break;
      }
      if (candidates.length >= maxSources) break;
    }
  }

  return { candidates, timedOut };
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
  const maxQueries = options.maxSearchQueries || Number(process.env.MAX_SEARCH_QUERIES || 4);
  const maxSources = options.maxSources || Number(process.env.MAX_SOURCES || 8);

  const queries = generateSearchQueries(sentences, maxQueries);

  let geminiGroundingStatus = isGeminiConfigured() ? "NOT_TESTED" : "NOT_CONFIGURED";
  let geminiGroundingError = null;

  // 1. Try Gemini Search Grounding if configured
  if (isGeminiConfigured() && (options.useGeminiGrounding !== false)) {
    try {
      const groundingResult = await Promise.race([
        searchWebWithGeminiGrounding(documentText, queries),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Grounding timeout")), 2500))
      ]);
      if (groundingResult && groundingResult.supported && groundingResult.grounded && groundingResult.sources.length > 0) {
        logger.logEvent("search_grounding_success", { count: groundingResult.sources.length });
        return {
          mode: "GEMINI_GROUNDING",
          modeLabel: "Gemini Web Grounding",
          message: "Web sources discovered via official Gemini Google Search grounding.",
          groundingStatus: "AVAILABLE",
          queries: groundingResult.queries || queries,
          sources: groundingResult.sources.slice(0, maxSources)
        };
      } else if (groundingResult) {
        const errText = groundingResult.error || "";
        if (errText.includes("429") || errText.includes("RESOURCE_EXHAUSTED")) {
          geminiGroundingStatus = "QUOTA_EXHAUSTED";
          geminiGroundingError = "Gemini Web Grounding unavailable: API quota exhausted.";
        } else {
          geminiGroundingStatus = "UNAVAILABLE";
          geminiGroundingError = groundingResult.error || "Gemini web grounding returned no candidate sources.";
        }
      }
    } catch (gErr) {
      geminiGroundingStatus = "TIMEOUT";
      geminiGroundingError = "Gemini Web Grounding timed out.";
    }
  }

  let candidates = [];
  let searchFailed = false;

  // 2. Try SearXNG / External Search if configured
  if (searchApiUrl) {
    const isSearXNG = searchEngine.toLowerCase().includes("searx") || searchApiUrl.includes(":8080");
    const isLocalhost = searchApiUrl.includes("localhost") || searchApiUrl.includes("127.0.0.1");

    let canAttemptExternal = true;
    if (isLocalhost) {
      const reachable = await isLocalhostReachable(searchApiUrl, 300);
      if (!reachable) {
        canAttemptExternal = false;
        searchFailed = true;
        logger.warn("Local search endpoint unreachable on this host, skipping to production web search fallback", { url: searchApiUrl });
      }
    }

    if (canAttemptExternal) {
      logger.logEvent("search_external_started", { queryCount: queries.length, engine: isSearXNG ? "SearXNG" : searchEngine });

      const searchFn = (q) => isSearXNG
        ? searchWebWithSearXNG(q, searchApiUrl)
        : queryExternalSearchApi(q, searchApiUrl, searchApiKey, searchEngine);

      const batchResult = await executeQueriesWithBudget(queries, searchFn, maxSources, 2500);
      candidates = batchResult.candidates;
      if (batchResult.timedOut || candidates.length === 0) {
        searchFailed = true;
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
      const batchResult = await executeQueriesWithBudget(queries, searchWebWithWikipedia, maxSources, 2500);
      candidates = batchResult.candidates;

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
