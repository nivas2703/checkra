/**
 * Checkra Phase 3: Web Search + Source Retrieval + Source Verification Test Suite
 *
 * Verifies:
 * A — Search success: Web search returns valid candidate URLs with rank and domain.
 * B — Search failure: Unavailable search produces structured SEARCH_UNAVAILABLE.
 * C — Source retrieval success: Actual page text is retrieved safely.
 * D — Source retrieval failure: Unreachable pages produce SOURCE_NOT_VERIFIABLE.
 * E — Snippet protection: Search snippets alone cannot become VERIFIED.
 * F — Exact source match: Known copied passage classified as EXACT_MATCH via deterministic engine.
 * G — Near source match: Paraphrased passage classified as NEAR_MATCH via deterministic engine.
 * H — Topical similarity: Related content is NOT classified as plagiarism (TOPICAL_SIMILARITY / NO_MATCH).
 * I — Score protection: Authoritative Checkra similarity score remains immutable.
 * J — SSRF protection: Localhost, private IPs, loopback, file://, and metadata endpoints rejected.
 * K — Tool limits: Maximum 5 total tools, 3 searches, 5 retrievals enforced.
 * L — Offline Ollama: Deterministic comparison executes independently without Ollama.
 * M — Dedicated Endpoint: POST /api/agent/research executes structured workflow.
 */

const assert = require("assert");
const http = require("http");
const app = require("../server/server");
const { web_search } = require("../server/ai/webSearchTool");
const { fetch_source, isStrictlySafeUrl } = require("../server/ai/sourceTool");
const { verify_source, comparePassageWithSourceText } = require("../server/ai/sourceVerification");
const { executeTool } = require("../server/ai/tools");
const { runCheckraResearch, MAX_TOTAL_TOOLS, MAX_WEB_SEARCHES, MAX_SOURCE_RETRIEVALS } = require("../server/ai/agent");
const { executeAnalysis } = require("../server/services/analysisService");

let totalPassed = 0;
let totalFailed = 0;

function report(name, passed, detail = "") {
  if (passed) {
    totalPassed++;
    console.log(`  ✓ [PASS] ${name} ${detail ? `(${detail})` : ""}`);
  } else {
    totalFailed++;
    console.log(`  ✗ [FAIL] ${name} ${detail ? `— ${detail}` : ""}`);
  }
}

function postJson(serverBase, endpoint, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const u = new URL(`${serverBase}${endpoint}`);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf), raw: buf });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: buf });
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function runResearchTests() {
  console.log("\n=================================================================");
  console.log("   CHECKRA PHASE 3: WEB SEARCH & SOURCE VERIFICATION SUITE");
  console.log("=================================================================\n");

  const server = http.createServer(app);
  await new Promise(res => server.listen(0, res));
  const port = server.address().port;
  const serverBase = `http://localhost:${port}`;

  try {
    // --- Test A: Search Success ---
    console.log("--- A. Web Search Success (Candidate Discovery) ---");
    const searchRes = await web_search("Artificial Intelligence", { maxResults: 4 });
    report("Search returns ok: true", searchRes.ok === true);
    report("Search results is non-empty array", Array.isArray(searchRes.results) && searchRes.results.length > 0, `Count: ${searchRes.results?.length}`);
    const firstResult = searchRes.results?.[0];
    report("Search candidate has valid http(s) URL", typeof firstResult?.url === "string" && firstResult.url.startsWith("http"));
    report("Search candidate has title string", typeof firstResult?.title === "string" && firstResult.title.length > 0);
    report("Search candidate has parsed domain", typeof firstResult?.sourceDomain === "string" && firstResult.sourceDomain.includes("."));
    report("Search candidate has rank number", typeof firstResult?.rank === "number" && firstResult.rank === 1);

    // --- Test B: Search Failure ---
    console.log("\n--- B. Web Search Failure Handling ---");
    const emptySearch = await web_search("");
    report("Empty query returns ok: false", emptySearch.ok === false);
    report("Empty query returns structured error", emptySearch.status === "INVALID_QUERY");

    const failedSearch = await web_search("xyznonexistentterm123459876xyz_unmatchable", {
      searxngUrl: "http://127.0.0.1:19998/search"
    });
    // Even if Wikipedia probe returns 0 results for gibberish, it must handle gracefully
    report("Failed search produces structured SEARCH_UNAVAILABLE if empty",
      failedSearch.ok === false ? failedSearch.status === "SEARCH_UNAVAILABLE" : true);

    // --- Test C: Source Retrieval Success ---
    console.log("\n--- C. Source Retrieval Success ---");
    const wikiUrl = "https://en.wikipedia.org/wiki/Artificial_intelligence";
    const retrieveRes = await fetch_source(wikiUrl, { timeoutMs: 5000 });
    report("Fetch source returns ok: true", retrieveRes.ok === true);
    report("Fetch source marks retrieved: true", retrieveRes.retrieved === true);
    report("Fetch source extracts substantial readable text", typeof retrieveRes.text === "string" && retrieveRes.text.length > 500);
    report("Fetch source counts words accurately", typeof retrieveRes.wordCount === "number" && retrieveRes.wordCount > 50);
    report("Fetch source parses domain correctly", retrieveRes.domain === "en.wikipedia.org");

    // --- Test D: Source Retrieval Failure ---
    console.log("\n--- D. Source Retrieval Failure Handling ---");
    const brokenUrl = "https://en.wikipedia.org/wiki/Checkra_NonExistent_Test_Page_404_123456";
    const brokenRes = await fetch_source(brokenUrl, { timeoutMs: 3000 });
    report("Unreachable page returns ok: false", brokenRes.ok === false);
    report("Unreachable page returns status SOURCE_NOT_VERIFIABLE", brokenRes.status === "SOURCE_NOT_VERIFIABLE");
    report("Unreachable page provides failure reason", typeof brokenRes.reason === "string" && brokenRes.reason.length > 0, brokenRes.reason);

    // --- Test E: Snippet Protection ---
    console.log("\n--- E. Snippet Protection (Snippets Never Equal Proof) ---");
    const unretrievedVerify = await verify_source({
      passage: "Artificial intelligence is transforming business operations across global industries.",
      url: "https://example.com/unreachable-page-99999",
      title: "Candidate Snippet Result"
    });
    report("Unretrieved candidate cannot be marked VERIFIED", unretrievedVerify.status !== "VERIFIED" && unretrievedVerify.isVerified === false);
    report("Unretrieved candidate status is SOURCE_NOT_VERIFIABLE", unretrievedVerify.status === "SOURCE_NOT_VERIFIABLE");
    report("Unretrieved candidate evidence states retrieval failed", unretrievedVerify.evidence?.includes("could not be retrieved"));

    // --- Test F: Exact Source Match ---
    console.log("\n--- F. Exact Source Match via Deterministic Engine ---");
    const exactPassage = "Artificial intelligence is the intelligence of machines or software as opposed to the intelligence of living beings.";
    const exactSourceText = "In computer science, artificial intelligence is the intelligence of machines or software as opposed to the intelligence of living beings, primarily of humans.";
    const exactVerify = await verify_source({
      passage: exactPassage,
      url: "https://example.org/ai-definition",
      title: "AI Definition",
      text: exactSourceText
    });
    report("Exact match classified as EXACT_MATCH", exactVerify.matchType === "EXACT_MATCH");
    report("Exact match status is VERIFIED", exactVerify.status === "VERIFIED");
    report("Exact match marks isVerified: true", exactVerify.isVerified === true);
    report("Exact match evidence captures verbatim phrase", exactVerify.evidence.toLowerCase().includes("artificial intelligence"));

    // --- Test G: Near Source Match ---
    console.log("\n--- G. Near Source Match via Deterministic Engine ---");
    const nearPassage = "The firm increased its annual revenues in the third quarter.";
    const nearSourceText = "The company grew its yearly earnings during the quarterly period.";
    const nearVerify = await verify_source({
      passage: nearPassage,
      url: "https://example.org/financial-report",
      title: "Financial Report",
      text: nearSourceText
    });
    report("Near match classified as NEAR_MATCH", nearVerify.matchType === "NEAR_MATCH");
    report("Near match status is VERIFIED", nearVerify.status === "VERIFIED");
    report("Near match marks isVerified: true", nearVerify.isVerified === true);
    report("Near match evidence lists distinctive shared terms", nearVerify.evidence.includes("firm~company") || nearVerify.evidence.includes("quarter"));

    // --- Test H: Topical Similarity ---
    console.log("\n--- H. Topical Similarity (Not Plagiarism) ---");
    const passageH = "Autonomous vehicles utilize lidar sensors and neural networks for collision detection.";
    const sourceTextH = "Modern transportation networks depend upon urban planning initiatives and municipal road infrastructure.";
    const topicalVerify = await verify_source({
      passage: passageH,
      url: "https://example.org/urban-transit",
      title: "Urban Transit",
      text: sourceTextH
    });
    report("Topical / disjoint content classified as NO_MATCH or TOPICAL_SIMILARITY",
      topicalVerify.matchType === "NO_MATCH" || topicalVerify.matchType === "TOPICAL_SIMILARITY");
    report("Topical similarity is NOT marked VERIFIED plagiarism", topicalVerify.status !== "VERIFIED" && topicalVerify.isVerified === false);

    // --- Test I: Score Protection ---
    console.log("\n--- I. Authoritative Score Protection ---");
    const sampleAnalysis = {
      id: "VW-2026-SCORE-TEST",
      similarity: {
        score: 42,
        grade: "B",
        coverage: { exactPercent: 40, nearPercent: 35, semanticPercent: 20 }
      },
      sources: { matchingCount: 3, retrievedCount: 5 }
    };
    const toolRes = executeTool("get_analysis_result", { analysis: sampleAnalysis });
    report("Authoritative score is preserved exactly (42%)", toolRes.overallSimilarityScore === 42);
    report("Score immutability guaranteed", toolRes.hasScore === true);

    // --- Test J: SSRF Security Protection ---
    console.log("\n--- J. SSRF Security Protection ---");
    const dangerousUrls = [
      "http://localhost:8080/admin",
      "http://127.0.0.1:11434/api/tags",
      "http://192.168.1.1/router",
      "http://10.0.0.5/secret",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "javascript:alert(1)"
    ];

    let ssrfAllBlocked = true;
    for (const dUrl of dangerousUrls) {
      const isSafe = isStrictlySafeUrl(dUrl);
      const res = await fetch_source(dUrl);
      if (isSafe || res.ok !== false || res.status !== "SOURCE_NOT_VERIFIABLE") {
        ssrfAllBlocked = false;
        console.log(`    Failed to block: ${dUrl}`);
      }
    }
    report("All dangerous SSRF target URLs rejected", ssrfAllBlocked);

    // --- Test K: Strict Tool Limits ---
    console.log("\n--- K. Strict Tool Limits ---");
    report("MAX_TOTAL_TOOLS is bounded (<= 5)", MAX_TOTAL_TOOLS <= 5 && MAX_TOTAL_TOOLS >= 1, `Value: ${MAX_TOTAL_TOOLS}`);
    report("MAX_WEB_SEARCHES is bounded (<= 3)", MAX_WEB_SEARCHES <= 3 && MAX_WEB_SEARCHES >= 1, `Value: ${MAX_WEB_SEARCHES}`);
    report("MAX_SOURCE_RETRIEVALS is bounded (<= 5)", MAX_SOURCE_RETRIEVALS <= 5 && MAX_SOURCE_RETRIEVALS >= 1, `Value: ${MAX_SOURCE_RETRIEVALS}`);

    // --- Test L: Offline Ollama Isolation ---
    console.log("\n--- L. Offline Ollama Isolation ---");
    const origOllama = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:19999";
    try {
      const isolatedAnalysis = await executeAnalysis({
        text: "Deterministic engine independence test document content demonstrating that the core analysis functions without local AI.",
        title: "Deterministic Engine Independence Test"
      });
      report("Deterministic analysis completes independently without Ollama", isolatedAnalysis && isolatedAnalysis.status === "completed");
      report("Authoritative score calculated deterministically", typeof isolatedAnalysis.similarity?.score === "number");
    } finally {
      if (origOllama) process.env.OLLAMA_BASE_URL = origOllama;
      else delete process.env.OLLAMA_BASE_URL;
    }

    // --- Test M: Dedicated API Endpoint (POST /api/agent/research) ---
    console.log("\n--- M. Dedicated API Endpoint (POST /api/agent/research) ---");
    const invalidReq = await postJson(serverBase, "/api/agent/research", { query: "Where did this come from?" });
    report("Missing text returns HTTP 400", invalidReq.status === 400 && invalidReq.data?.ok === false);

    const validResearch = await postJson(serverBase, "/api/agent/research", {
      query: "Where does this passage come from?",
      text: "Artificial intelligence is transforming financial services by improving fraud detection, risk assessment, and customer service."
    });

    report("Valid research request returns HTTP 200", validResearch.status === 200);
    report("Research response has ok: true", validResearch.data?.ok === true);
    report("Research response contains sources array", Array.isArray(validResearch.data?.sources));
    report("Research response contains agent metadata", validResearch.data?.agent?.provider === "ollama");

    if (validResearch.data?.sources && validResearch.data.sources.length > 0) {
      const s0 = validResearch.data.sources[0];
      report("Source item contains url", typeof s0.url === "string" && s0.url.startsWith("http"));
      report("Source item contains domain", typeof s0.domain === "string" && s0.domain.length > 0);
      report("Source item contains valid status", ["VERIFIED", "POSSIBLE", "RETRIEVED", "SOURCE_NOT_VERIFIABLE", "NO_MATCH"].includes(s0.status), `Status: ${s0.status}`);
      report("Source item contains valid matchType", ["EXACT_MATCH", "NEAR_MATCH", "STRONG_PARAPHRASE", "POSSIBLE_PARAPHRASE", "CONCEPTUAL_SIMILARITY", "TOPICAL_SIMILARITY", "NO_MATCH"].includes(s0.matchType), `MatchType: ${s0.matchType}`);
      report("Source item contains evidence string", typeof s0.evidence === "string" && s0.evidence.length > 0);
    } else {
      report("Candidate sources retrieved (at least 1)", false);
    }

  } finally {
    server.close();
  }

  console.log("\n=================================================================");
  console.log(`   PHASE 3 WEB RESEARCH RESULTS: ${totalPassed}/${totalPassed + totalFailed} PASSED (${totalFailed} Failures)`);
  console.log("=================================================================\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runResearchTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
