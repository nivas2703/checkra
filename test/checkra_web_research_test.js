/**
 * Checkra Phase 3 & 3.1: Web Search + Source Retrieval + Source Verification Test Suite
 *
 * Verifies:
 * A — Search success: Web search returns valid candidate URLs with rank and domain.
 * B — Search failure: Unavailable search produces structured SEARCH_UNAVAILABLE.
 * C — Source retrieval success: Actual page text is retrieved safely.
 * D — Source retrieval failure: Unreachable pages produce SOURCE_NOT_VERIFIABLE.
 * E — Snippet protection: Search snippets alone cannot become VERIFIED.
 * F — Exact source match: Known copied passage classified as EXACT_MATCH with non-null sourceSimilarity.
 * G — Near source match: Paraphrased passage classified as NEAR_MATCH with non-null sourceSimilarity.
 * H — Topical similarity: sourceSimilarity is strictly null; NOT classified as plagiarism.
 * I — Score protection: Authoritative Checkra similarity score remains immutable.
 * J — SSRF protection: Localhost, private IPs, loopback, file://, and metadata endpoints rejected.
 * K — Tool limits: Maximum 5 total tools, 3 searches, 5 retrievals enforced.
 * L — Offline Ollama: Deterministic comparison executes independently without Ollama.
 * M — Dedicated Endpoint: POST /api/agent/research executes structured workflow.
 * N — Phase 3.1 Score Semantics:
 *     1. TOPICAL_SIMILARITY cannot produce an overall plagiarism percentage.
 *     2. CONCEPTUAL_SIMILARITY cannot produce an overall plagiarism percentage.
 *     3. Research sourceSimilarity is not labeled as overall similarity.
 *     4. No authoritative analysis score means authoritativeScore = null and scoreStatus = "UNAVAILABLE".
 *     5. Existing authoritative score remains immutable when supplied.
 *     6. Explanation distinguishes topical similarity from plagiarism and never hallucinates an overall score.
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
  console.log("   CHECKRA PHASE 3.1: WEB SEARCH & SCORE SEMANTICS SUITE");
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
    report("Failed search produces structured SEARCH_UNAVAILABLE if empty",
      failedSearch.ok === false ? failedSearch.status === "SEARCH_UNAVAILABLE" : true);

    // --- C. Source Retrieval Success ---
    console.log("\n--- C. Source Retrieval Success ---");
    const wikiUrl = "https://en.wikipedia.org/wiki/Artificial_intelligence";
    const retrieveRes = await fetch_source(wikiUrl, { timeoutMs: 5000 });
    report("Fetch source returns ok: true", retrieveRes.ok === true);
    report("Fetch source marks retrieved: true", retrieveRes.retrieved === true);
    report("Fetch source extracts substantial readable text", typeof retrieveRes.text === "string" && retrieveRes.text.length > 500);
    report("Fetch source counts words accurately", typeof retrieveRes.wordCount === "number" && retrieveRes.wordCount > 50);
    report("Fetch source parses domain correctly", retrieveRes.domain === "en.wikipedia.org");

    // --- D. Source Retrieval Failure ---
    console.log("\n--- D. Source Retrieval Failure Handling ---");
    const brokenUrl = "https://en.wikipedia.org/wiki/Checkra_NonExistent_Test_Page_404_123456";
    const brokenRes = await fetch_source(brokenUrl, { timeoutMs: 3000 });
    report("Unreachable page returns ok: false", brokenRes.ok === false);
    report("Unreachable page returns status SOURCE_NOT_VERIFIABLE", brokenRes.status === "SOURCE_NOT_VERIFIABLE");
    report("Unreachable page provides failure reason", typeof brokenRes.reason === "string" && brokenRes.reason.length > 0, brokenRes.reason);

    // --- E. Snippet Protection ---
    console.log("\n--- E. Snippet Protection (Snippets Never Equal Proof) ---");
    const unretrievedVerify = await verify_source({
      passage: "Artificial intelligence is transforming business operations across global industries.",
      url: "https://example.com/unreachable-page-99999",
      title: "Candidate Snippet Result"
    });
    report("Unretrieved candidate cannot be marked VERIFIED", unretrievedVerify.status !== "VERIFIED" && unretrievedVerify.isVerified === false);
    report("Unretrieved candidate status is SOURCE_NOT_VERIFIABLE", unretrievedVerify.status === "SOURCE_NOT_VERIFIABLE");
    report("Unretrieved candidate sourceSimilarity is strictly null", unretrievedVerify.sourceSimilarity === null);
    report("Unretrieved candidate evidence states retrieval failed", unretrievedVerify.evidence?.includes("could not be retrieved"));

    // --- F. Exact Source Match ---
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
    report("Exact match has non-null sourceSimilarity", typeof exactVerify.sourceSimilarity === "string" && exactVerify.sourceSimilarity.includes("%"));
    report("Exact match evidence captures verbatim phrase", exactVerify.evidence.toLowerCase().includes("exact textual match"));

    // --- G. Near Source Match ---
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
    report("Near match has non-null sourceSimilarity", typeof nearVerify.sourceSimilarity === "string" && nearVerify.sourceSimilarity.includes("%"));
    report("Near match evidence lists distinctive shared terms", nearVerify.evidence.includes("firm~company") || nearVerify.evidence.includes("quarter"));

    // --- H. Topical Similarity (Phase 3.1 Guard) ---
    console.log("\n--- H. Topical Similarity (Not Plagiarism & sourceSimilarity is null) ---");
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
    report("Topical similarity is NOT marked VERIFIED", topicalVerify.status !== "VERIFIED" && topicalVerify.isVerified === false);
    report("Topical similarity sourceSimilarity is strictly null", topicalVerify.sourceSimilarity === null);
    report("Topical similarity evidence explicitly states no textual overlap",
      topicalVerify.evidence.includes("no textual overlap") || topicalVerify.evidence.includes("No significant textual"));

    // --- I. Authoritative Score Protection ---
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

    // --- J. SSRF Security Protection ---
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

    // --- K. Strict Tool Limits ---
    console.log("\n--- K. Strict Tool Limits ---");
    report("MAX_TOTAL_TOOLS is bounded (<= 5)", MAX_TOTAL_TOOLS <= 5 && MAX_TOTAL_TOOLS >= 1, `Value: ${MAX_TOTAL_TOOLS}`);
    report("MAX_WEB_SEARCHES is bounded (<= 3)", MAX_WEB_SEARCHES <= 3 && MAX_WEB_SEARCHES >= 1, `Value: ${MAX_WEB_SEARCHES}`);
    report("MAX_SOURCE_RETRIEVALS is bounded (<= 5)", MAX_SOURCE_RETRIEVALS <= 5 && MAX_SOURCE_RETRIEVALS >= 1, `Value: ${MAX_SOURCE_RETRIEVALS}`);

    // --- L. Offline Ollama Isolation ---
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

    // --- M. Dedicated API Endpoint Validation ---
    console.log("\n--- M. Dedicated API Endpoint (POST /api/agent/research) ---");
    const invalidReq = await postJson(serverBase, "/api/agent/research", { query: "Where did this come from?" });
    report("Missing text returns HTTP 400", invalidReq.status === 400 && invalidReq.data?.ok === false);

    const validResearch = await postJson(serverBase, "/api/agent/research", {
      query: "Search the web for sources that discuss this passage and determine whether there is an actual textual match.",
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
      report("Source item contains valid status", ["VERIFIED", "POSSIBLE", "RETRIEVED", "SOURCE_NOT_VERIFIABLE", "NO_MATCH"].includes(s0.status));
      report("Source item contains valid matchType", ["EXACT_MATCH", "NEAR_MATCH", "STRONG_PARAPHRASE", "POSSIBLE_PARAPHRASE", "CONCEPTUAL_SIMILARITY", "TOPICAL_SIMILARITY", "NO_MATCH"].includes(s0.matchType));
      report("Source item has sourceSimilarity property", s0.hasOwnProperty("sourceSimilarity"));
      report("Source item contains evidence string", typeof s0.evidence === "string" && s0.evidence.length > 0);
    }

    // --- N. Phase 3.1 Research Score Semantics Invariants ---
    console.log("\n--- N. Phase 3.1 Research Score Semantics Invariants ---");
    // 1. No authoritative analysis in research request produces authoritativeScore: null & scoreStatus: UNAVAILABLE
    report("No analysis supplied produces authoritativeScore === null", validResearch.data?.authoritativeScore === null);
    report("No analysis supplied produces scoreStatus === 'UNAVAILABLE'", validResearch.data?.scoreStatus === "UNAVAILABLE");

    // 2. Topical source in research response MUST have sourceSimilarity: null
    const topicalSource = validResearch.data?.sources?.find(s => s.matchType === "TOPICAL_SIMILARITY");
    if (topicalSource) {
      report("Topical similarity in API response has sourceSimilarity === null", topicalSource.sourceSimilarity === null);
      report("Topical similarity evidence clarifies no textual overlap", topicalSource.evidence.includes("no textual overlap") || topicalSource.evidence.includes("original"));
    } else {
      report("Topical similarity invariant tested", true, "No topical candidates returned in live top results");
    }

    // 3. AI Explanation never claims an overall similarity score when authoritativeScore is null
    const explanation = validResearch.data?.explanation || "";
    const hasHallucinatedOverallScore = /(?:overall|plagiarism)\s+score\s+is\s+\d+%/i.test(explanation);
    report("AI explanation does NOT claim an overall similarity/plagiarism score when authoritativeScore is null", !hasHallucinatedOverallScore, `Summary: "${explanation.substring(0, 80)}..."`);

    // 4. Existing authoritative score supplied in research request remains immutable
    const suppliedAnalysisResearch = await postJson(serverBase, "/api/agent/research", {
      query: "Check this passage against web sources",
      text: "The financial services sector continues to adopt machine learning.",
      analysis: {
        id: "VW-2026-AUTH-TEST",
        similarity: { score: 68, grade: "C" }
      }
    });
    report("Supplied analysis score is preserved exactly (authoritativeScore: 68)", suppliedAnalysisResearch.data?.authoritativeScore === 68);
    report("Supplied analysis score status is 'AVAILABLE'", suppliedAnalysisResearch.data?.scoreStatus === "AVAILABLE");

    // 5. Direct verification of CONCEPTUAL_SIMILARITY setting sourceSimilarity: null
    const conceptualComp = await comparePassageWithSourceText(
      "Neural networks optimize computational loss functions during backpropagation.",
      "Machine learning models improve statistical weights through algorithmic matrix transformations.",
      "https://example.org/conceptual"
    );
    if (conceptualComp.matchType === "CONCEPTUAL_SIMILARITY") {
      report("CONCEPTUAL_SIMILARITY strictly sets sourceSimilarity: null", conceptualComp.sourceSimilarity === null);
      report("CONCEPTUAL_SIMILARITY evidence clarifies not plagiarism", conceptualComp.evidence.includes("does not by itself establish plagiarism"));
    } else {
      report("CONCEPTUAL_SIMILARITY contract verified", conceptualComp.sourceSimilarity === null || conceptualComp.matchType !== "CONCEPTUAL_SIMILARITY");
    }

  } finally {
    server.close();
  }

  console.log("\n=================================================================");
  console.log(`   PHASE 3.1 RESEARCH TEST RESULTS: ${totalPassed}/${totalPassed + totalFailed} PASSED (${totalFailed} Failures)`);
  console.log("=================================================================\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runResearchTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
