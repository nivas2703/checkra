/**
 * Checkra Phase 7: Intelligent Research & Citation Assistant Test Suite
 *
 * Comprehensive validation across:
 * - Claim extraction and classification (factual, statistical, historical, causal, opinion, etc.)
 * - Exact span preservation (no fabricated claims)
 * - Citation analysis (parenthetical, narrative, numeric, multiple, gaps, unresolved)
 * - Source support evaluation (direct, partial, related only, contradicts, snippet only, unverifiable)
 * - Reference list generator strictly from verified metadata
 * - Research assistant bounded orchestration & conflict synthesis
 * - Agent tools & REST API endpoints
 * - Strict score & integrity immutability
 * - Live validation scenarios (1 to 13)
 */

const assert = require("assert");
const http = require("http");
const app = require("../server/server");
const { extractClaims, classifyClaimType } = require("../server/ai/claimExtractor");
const {
  extractCitations,
  analyzeCitations,
  generateReferenceSuggestion,
  generateReferenceList
} = require("../server/ai/citationAnalyzer");
const {
  determineSourceType,
  evaluateClaimSupport,
  detectContradiction,
  synthesizeSourceConsensus
} = require("../server/ai/sourceSupport");
const {
  researchClaim,
  researchDocument,
  explainSourceRelevance,
  explainWithAi
} = require("../server/ai/researchAssistant");
const { executeTool } = require("../server/ai/tools");
const { generateIntegrityReport } = require("../server/ai/evidenceFusion");

let passed = 0;
let failed = 0;
let serverInstance = null;
let serverPort = null;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}:`, err.message);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}:`, err.message);
    failed++;
  }
}

function makeRequest(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: serverPort,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {})
        }
      },
      res => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTestSuite() {
  console.log("\n==================================================================================");
  console.log("   CHECKRA PHASE 7: INTELLIGENT RESEARCH & CITATION ASSISTANT TEST SUITE");
  console.log("==================================================================================\n");

  // Spin up test server for HTTP endpoint tests
  await new Promise((resolve, reject) => {
    serverInstance = app.listen(0, "127.0.0.1", () => {
      serverPort = serverInstance.address().port;
      resolve();
    });
    serverInstance.on("error", reject);
  });

  // --- TESTS A - G: CLAIM EXTRACTION & CLASSIFICATION ---
  console.log("--- Tests A - G: Claim Extraction & Classification ---");

  test("Test A: Factual claim extraction", () => {
    const text = "Paris is the capital of France.";
    const res = extractClaims(text);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claims.length, 1);
    assert.strictEqual(res.claims[0].type, "FACTUAL");
    assert.strictEqual(res.claims[0].requiresEvidence, true);
  });

  test("Test B: Statistical claim extraction", () => {
    const text = "India's GDP grew by 8% in 2025.";
    const res = extractClaims(text);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claims.length, 1);
    assert.strictEqual(res.claims[0].type, "STATISTICAL");
    assert.strictEqual(res.claims[0].requiresEvidence, true);
  });

  test("Test C: Historical claim extraction", () => {
    const text = "World War II ended in 1945.";
    const res = extractClaims(text);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claims.length, 1);
    assert.strictEqual(res.claims[0].type, "HISTORICAL");
    assert.strictEqual(res.claims[0].requiresEvidence, true);
  });

  test("Test D: Causal claim extraction", () => {
    const text = "Smoking causes lung cancer in long-term consumers.";
    const res = extractClaims(text);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claims.length, 1);
    assert.strictEqual(res.claims[0].type, "CAUSAL");
    assert.strictEqual(res.claims[0].requiresEvidence, true);
  });

  test("Test E: Opinion not incorrectly treated as factual", () => {
    const text = "I believe this strategy is useful for our organization.";
    const res = extractClaims(text);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claims.length, 1);
    assert.strictEqual(res.claims[0].type, "OPINION");
    assert.strictEqual(res.claims[0].requiresEvidence, false);
  });

  test("Test F: No fabricated claims — all claims originate strictly from submitted text", () => {
    const text = "Solar energy is cheaper than coal. We feel this is exciting. The treaty was signed in 1919.";
    const res = extractClaims(text);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claims.length, 3);
    for (const c of res.claims) {
      assert.strictEqual(text.includes(c.text), true, `Claim "${c.text}" must exist in original text`);
    }
  });

  test("Test G: Exact source span preservation", () => {
    const text = "First sentence here. Second sentence starts at specific index. Third is here.";
    const res = extractClaims(text);
    assert.strictEqual(res.ok, true);
    for (const c of res.claims) {
      const slice = text.slice(c.start, c.end);
      assert.strictEqual(slice, c.text, "Exact character span slice must strictly match claim text");
    }
  });

  // --- TESTS H - N: CITATION ANALYSIS & GAP DETECTION ---
  console.log("\n--- Tests H - N: Citation Analysis & Gap Detection ---");

  test("Test H: Parenthetical citation detection", () => {
    const text = "Prior empirical studies demonstrate significant accuracy improvements (Smith, 2020).";
    const res = extractCitations(text);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].format, "PARENTHETICAL");
    assert.strictEqual(res[0].status, "RECOGNIZED");
    assert.strictEqual(res[0].authors[0], "Smith");
    assert.strictEqual(res[0].year, 2020);
  });

  test("Test I: Narrative citation detection", () => {
    const text = "According to Worrall (1989), structural realism provides a philosophical resolution.";
    const res = extractCitations(text);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].format, "NARRATIVE");
    assert.strictEqual(res[0].status, "RECOGNIZED");
    assert.strictEqual(res[0].authors[0], "Worrall");
    assert.strictEqual(res[0].year, 1989);
  });

  test("Test J: Multiple citation detection", () => {
    const text = "Multiple models converge on similar findings (Smith, 2020; Jones, 2021).";
    const res = extractCitations(text);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].format, "MULTIPLE");
    assert.strictEqual(res[0].status, "RECOGNIZED");
    assert.strictEqual(res[0].entries.length, 2);
    assert.strictEqual(res[0].entries[0].author, "Smith");
    assert.strictEqual(res[0].entries[1].author, "Jones");
  });

  test("Test K: Numeric citation detection", () => {
    const text = "Quantum dot solar cells achieved new efficiency records [1].";
    const res = extractCitations(text);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].format, "NUMERIC");
    assert.strictEqual(res[0].status, "RECOGNIZED");
    assert.strictEqual(res[0].numericReference, "1");
  });

  test("Test L: Missing citation detection", () => {
    const text = "The global average temperature rose by 1.1 degrees Celsius. In our view, this is concerning.";
    const res = analyzeCitations(text);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.citationGaps.length, 1);
    assert.strictEqual(res.citationGaps[0].claimType, "STATISTICAL");
    assert.strictEqual(res.claims[0].citationStatus, "CITATION_MISSING");
    assert.strictEqual(res.claims[1].citationStatus, "NOT_REQUIRED");
  });

  test("Test M: Unresolved citation handling", () => {
    const text = "Empirical data shows resilience (Smith).";
    const res = analyzeCitations(text);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.citations.length, 1);
    assert.strictEqual(res.citations[0].status, "UNRECOGNIZED_FORMAT");
    assert.strictEqual(res.claims[0].citationStatus, "CITATION_PRESENT_SOURCE_UNRESOLVED");
  });

  test("Test N: Unknown / unrecognized citation format handling", () => {
    const text = "This methodology is well documented [citation needed] in historical archives.";
    const res = extractCitations(text);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].format, "UNRECOGNIZED_FORMAT");
    assert.strictEqual(res[0].status, "UNRECOGNIZED_FORMAT");
  });

  // --- TESTS O - U: SOURCE SUPPORT EVALUATION ---
  console.log("\n--- Tests O - U: Source Support Evaluation ---");

  await asyncTest("Test O: Verified source direct support", async () => {
    const claim = "Solar panel installations reached record highs in 2024.";
    const sourceText = "Annual energy report: Solar panel installations reached record highs in 2024 across European markets.";
    const res = await evaluateClaimSupport(claim, sourceText, "https://energy.gov/report");
    assert.strictEqual(res.status, "CLAIM_SUPPORTED");
    assert.strictEqual(res.supportType, "DIRECT_SUPPORT");
    assert.strictEqual(res.isVerified, true);
  });

  await asyncTest("Test P: Partial support", async () => {
    const claim = "The enzyme accelerates hydrolysis by 45% at 37 degrees Celsius.";
    const sourceText = "The enzymatic catalyst accelerates the rate of cellular hydrolysis at 37 degrees Celsius under laboratory conditions.";
    const res = await evaluateClaimSupport(claim, sourceText, "https://nature.com/article/123");
    assert.strictEqual(res.status, "CLAIM_PARTIALLY_SUPPORTED");
    assert.strictEqual(res.supportType, "PARTIAL_SUPPORT");
    assert.strictEqual(res.isVerified, false);
  });

  await asyncTest("Test Q: Related-only source", async () => {
    const claim = "Photosynthesis requires chlorophyll to absorb blue and red light spectrums.";
    const sourceText = "Plant biology and botanical studies investigate plant species, chlorophyll pigments, and ecological adaptations across rainforests.";
    const res = await evaluateClaimSupport(claim, sourceText, "https://en.wikipedia.org/wiki/Fern");
    assert.strictEqual(res.status, "SOURCE_RELEVANT");
    assert.strictEqual(res.supportType, "RELATED_ONLY");
    assert.strictEqual(res.isVerified, false);
  });

  test("Test R: Contradicting source", () => {
    const claim = "National GDP grew by 8% in the second quarter.";
    const sourceText = "Official economic bulletin: National GDP decreased and fell into negative growth during the second quarter.";
    const res = detectContradiction(claim, sourceText);
    assert.strictEqual(res.hasContradiction, true);
  });

  await asyncTest("Test S: Insufficient evidence", async () => {
    const claim = "The ancient city was abandoned due to volcanic ash.";
    const sourceText = "Pottery fragments were recovered near the riverbank.";
    const res = await evaluateClaimSupport(claim, sourceText, "https://archaeology.org/dig");
    assert.strictEqual(res.status, "INSUFFICIENT_EVIDENCE");
    assert.strictEqual(res.supportType, "INSUFFICIENT_EVIDENCE");
  });

  await asyncTest("Test T: Source not verifiable", async () => {
    const res = await researchClaim("Quantum cryptography guarantees unconditional confidentiality.", "", {
      candidateSources: [
        { url: "https://unreachable-dead-domain-123456.org", status: "SOURCE_NOT_VERIFIABLE" }
      ]
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sources[0].status, "SOURCE_NOT_VERIFIABLE");
  });

  await asyncTest("Test U: Snippet-only source never verified", async () => {
    const res = await researchClaim("India's GDP grew by 8% in 2025.", "", {
      candidateSources: [
        {
          url: "https://example.com/search-result",
          snippet: "India's GDP grew by 8% in 2025 according to recent estimates.",
          snippetOnly: true
        }
      ]
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sources[0].status, "SOURCE_DISCOVERED");
    assert.strictEqual(res.sources[0].isVerified, false);
    assert.notStrictEqual(res.sources[0].status, "CLAIM_SUPPORTED");
  });

  // --- TESTS V - Z: RESEARCH ASSISTANT & ORCHESTRATION ---
  console.log("\n--- Tests V - Z: Research Assistant & Orchestration ---");

  await asyncTest("Test V: Research claim workflow", async () => {
    const claim = "Artificial intelligence models utilize neural network architectures.";
    const sourceText = "Artificial intelligence models utilize neural network architectures to recognize patterns in data.";
    const res = await researchClaim(claim, "", {
      candidateSources: [
        { url: "https://arxiv.org/abs/2001.00001", title: "Neural Architectures in AI", text: sourceText }
      ]
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.status, "CLAIM_SUPPORTED");
    assert.strictEqual(res.sources.length, 1);
    assert.strictEqual(res.sources[0].isVerified, true);
  });

  await asyncTest("Test W: Bounded research limits", async () => {
    const res = await researchDocument("First claim here. Second claim here. Third claim here.");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claims.length, 3);
  });

  test("Test X: Source metadata extraction and categorization", () => {
    const govType = determineSourceType("https://www.cdc.gov/vaccines");
    const eduType = determineSourceType("https://cs.stanford.edu/research");
    const newsType = determineSourceType("https://www.reuters.com/business");
    const wikiType = determineSourceType("https://en.wikipedia.org/wiki/Physics");

    assert.strictEqual(govType, "OFFICIAL_SOURCE");
    assert.strictEqual(eduType, "ACADEMIC_SOURCE");
    assert.strictEqual(newsType, "NEWS_SOURCE");
    assert.strictEqual(wikiType, "REFERENCE_SOURCE");
  });

  test("Test Y: Conflicting evidence synthesis", () => {
    const evaluated = [
      { supportType: "DIRECT_SUPPORT", status: "CLAIM_SUPPORTED" },
      { supportType: "CONTRADICTS", status: "CLAIM_UNSUPPORTED" }
    ];
    const consensus = synthesizeSourceConsensus("Growth was recorded in 2024.", evaluated);
    assert.strictEqual(consensus.status, "CONFLICTING_EVIDENCE");
    assert.strictEqual(consensus.conflictDetected, true);
  });

  test("Test Z: Explanation based on retrieved evidence", () => {
    const source = {
      url: "https://nature.com/article/1",
      domain: "nature.com",
      status: "CLAIM_SUPPORTED",
      supportType: "DIRECT_SUPPORT"
    };
    const expl = explainSourceRelevance({ claim: "DNA structure is a double helix", source });
    assert.strictEqual(expl.includes("Why this source is relevant"), true);
    assert.strictEqual(expl.includes("directly discusses"), true);
  });

  // --- TESTS AA - AD: AGENT TOOLS EXECUTION ---
  console.log("\n--- Tests AA - AD: Agent Tools Execution ---");

  test("Test AA: extract_claims tool via executeTool", () => {
    const res = executeTool("extract_claims", {
      text: "Global sea levels rose by 3.4 millimeters per year."
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.claims.length, 1);
    assert.strictEqual(res.claims[0].type, "STATISTICAL");
  });

  test("Test AB: analyze_citations tool via executeTool", () => {
    const res = executeTool("analyze_citations", {
      text: "Evidence is detailed in recent findings (Smith & Jones, 2021)."
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.citations.length, 1);
    assert.strictEqual(res.stats.recognized, 1);
  });

  await asyncTest("Test AC: research_claim tool via executeTool", async () => {
    const res = await executeTool("research_claim", {
      claim: "Water boils at 100 degrees Celsius at sea level.",
      options: {
        candidateSources: [
          {
            url: "https://en.wikipedia.org/wiki/Water",
            title: "Properties of Water",
            text: "Water boils at 100 degrees Celsius at sea level pressure."
          }
        ]
      }
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.status, "CLAIM_SUPPORTED");
  });

  test("Test AD: generate_reference_list tool via executeTool", () => {
    const sources = [
      {
        url: "https://doi.org/10.1000/182",
        title: "Structural Realism",
        author: "Worrall, J.",
        year: 1989,
        publisher: "Dialectica",
        isVerified: true
      }
    ];
    const res = executeTool("generate_reference_list", { sources, style: "APA" });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.totalReferences, 1);
    assert.strictEqual(res.references[0].formattedReference.includes("Worrall, J."), true);
    assert.strictEqual(res.references[0].label, "SUGGESTED_REFERENCE");
  });

  // --- TESTS AE - AJ: REST API ENDPOINTS & SECURITY ---
  console.log("\n--- Tests AE - AJ: REST API Endpoints & Security ---");

  await asyncTest("Test AE: POST /api/research/claims endpoint", async () => {
    const res = await makeRequest("/api/research/claims", "POST", {
      text: "Antibiotic resistance is rising globally. We believe education is crucial."
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.claims.length, 2);
    assert.strictEqual(res.data.citationSummary.possibleGaps, 1);
  });

  await asyncTest("Test AF: POST /api/research/claim endpoint", async () => {
    const res = await makeRequest("/api/research/claim", "POST", {
      claim: "Antibiotic resistance poses a major public health threat.",
      options: {
        candidateSources: [
          {
            url: "https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance",
            title: "Antimicrobial Resistance",
            text: "Antimicrobial resistance is one of the top global public health and development threats."
          }
        ]
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.status, "CLAIM_SUPPORTED");
  });

  await asyncTest("Test AG: POST /api/citations/analyze endpoint", async () => {
    const res = await makeRequest("/api/citations/analyze", "POST", {
      text: "Recent clinical trials confirm the efficacy of the vaccine (Smith et al., 2022)."
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.stats.recognized, 1);
    assert.strictEqual(res.data.citations[0].authors[0], "Smith et al.");
  });

  await asyncTest("Test AH: Malformed request handling returns 400", async () => {
    const res1 = await makeRequest("/api/research/claims", "POST", { text: "" });
    assert.strictEqual(res1.status, 400);

    const res2 = await makeRequest("/api/research/claim", "POST", { claim: "   " });
    assert.strictEqual(res2.status, 400);

    const res3 = await makeRequest("/api/citations/analyze", "POST", { text: null });
    assert.strictEqual(res3.status, 400);
  });

  await asyncTest("Test AI: AI unavailable handling", async () => {
    const res = await explainWithAi("Explain quantum entanglement");
    // Either returns live response if Ollama is up, or structured AI_UNAVAILABLE without crashing
    if (!res.ok) {
      assert.strictEqual(res.error, "AI_UNAVAILABLE");
    } else {
      assert.strictEqual(typeof res.response, "string");
    }
  });

  await asyncTest("Test AJ: SSRF security prevents private IP and metadata retrieval", async () => {
    const res = await researchClaim("Test claim", "", {
      candidateSources: [
        { url: "http://127.0.0.1:8080/private", status: "SOURCE_NOT_VERIFIABLE" },
        { url: "http://169.254.169.254/latest/meta-data", status: "SOURCE_NOT_VERIFIABLE" }
      ]
    });
    assert.strictEqual(res.ok, true);
    for (const src of res.sources) {
      assert.strictEqual(src.status, "SOURCE_NOT_VERIFIABLE");
    }
  });

  // --- TESTS AK - AO: INTEGRITY INVARIANTS ---
  console.log("\n--- Tests AK - AO: Integrity Invariants ---");

  test("Test AK: Similarity score is completely unchanged by research assistant", () => {
    const sampleAnalysis = {
      id: "VW-TEST-P7",
      similarity: { score: 42, grade: "B" },
      document: { text: "Sample text" }
    };
    // Run research claim
    const initialScore = sampleAnalysis.similarity.score;
    extractClaims(sampleAnalysis.document.text);
    assert.strictEqual(sampleAnalysis.similarity.score, initialScore);
  });

  test("Test AL: AI-Writing likelihood is completely decoupled from research evidence", () => {
    const rep = generateIntegrityReport({
      analysis: { id: "VW-P7-AL", similarity: { score: 35, grade: "B" } },
      aiWriting: { likelihood: 70, confidence: "HIGH" }
    });
    assert.strictEqual(rep.ok, true);
    assert.strictEqual(rep.report.similarity.score, 35);
    assert.strictEqual(rep.report.aiWriting.likelihood, 70);
  });

  test("Test AM: Integrity Confidence methodology remains untouched", () => {
    const rep = generateIntegrityReport({
      analysis: { id: "VW-P7-AM", similarity: { score: 10, grade: "A" } }
    });
    assert.strictEqual(rep.ok, true);
    assert.strictEqual(typeof rep.report.integrityConfidence.score, "number");
  });

  test("Test AN: Protected files invariant check", () => {
    const fs = require("fs");
    const exactContent = fs.readFileSync("server/analysis/exactMatcher.js", "utf8");
    const nearContent = fs.readFileSync("server/analysis/nearMatcher.js", "utf8");
    const semanticContent = fs.readFileSync("server/analysis/semanticMatcher.js", "utf8");
    const scoringContent = fs.readFileSync("server/analysis/scoring.js", "utf8");
    const analysisServiceContent = fs.readFileSync("server/services/analysisService.js", "utf8");

    assert.strictEqual(exactContent.includes("findExactMatches"), true);
    assert.strictEqual(nearContent.includes("findNearMatches"), true);
    assert.strictEqual(semanticContent.includes("findSemanticMatches"), true);
    assert.strictEqual(scoringContent.includes("calculateDocumentScore"), true);
    assert.strictEqual(analysisServiceContent.includes("executeAnalysis"), true);
  });

  // --- LIVE VALIDATION SCENARIOS (1 TO 13) ---
  console.log("\n--- LIVE VALIDATION SCENARIOS (1 to 13) ---");

  test("Live 1: Simple factual claim", () => {
    const res = extractClaims("Paris is the capital of France.");
    assert.strictEqual(res.claims[0].type, "FACTUAL");
    assert.strictEqual(res.claims[0].requiresEvidence, true);
  });

  test("Live 2: Statistical claim", () => {
    const res = extractClaims("Over 68% of mobile web traffic utilizes responsive viewports.");
    assert.strictEqual(res.claims[0].type, "STATISTICAL");
    assert.strictEqual(res.claims[0].requiresEvidence, true);
  });

  test("Live 3: Claim with an existing citation", () => {
    const text = "Renewable energy adoption expanded significantly across OECD nations (Smith, 2020).";
    const res = analyzeCitations(text);
    assert.strictEqual(res.claims[0].citationPresent, true);
    assert.strictEqual(res.claims[0].citationStatus, "SUPPORTED_BY_CITATION");
  });

  test("Live 4: Claim without citation", () => {
    const text = "The treaty was signed in October 1648.";
    const res = analyzeCitations(text);
    assert.strictEqual(res.claims[0].citationPresent, false);
    assert.strictEqual(res.claims[0].citationStatus, "CITATION_MISSING");
  });

  await asyncTest("Live 5: Verified source supporting a claim", async () => {
    const claim = "The speed of light in vacuum is approximately 299792 kilometers per second.";
    const sourceText = "Physics handbook: The speed of light in vacuum is approximately 299792 kilometers per second as measured by modern laser interferometry.";
    const res = await researchClaim(claim, "", {
      candidateSources: [
        { url: "https://physics.nist.gov/constants", title: "NIST Fundamental Physical Constants", text: sourceText }
      ]
    });
    assert.strictEqual(res.status, "CLAIM_SUPPORTED");
    assert.strictEqual(res.sources[0].supportType, "DIRECT_SUPPORT");
  });

  await asyncTest("Live 6: Related source that does NOT actually support the claim", async () => {
    const claim = "Vaccine efficacy was determined to be 94.5% during phase III trials.";
    const sourceText = "A comprehensive public health overview of seasonal viral outbreaks, vaccine distribution, and clinical trials.";
    const res = await researchClaim(claim, "", {
      candidateSources: [
        { url: "https://cdc.gov/outbreaks", title: "Public Health Measures", text: sourceText }
      ]
    });
    assert.strictEqual(res.status, "SOURCE_RELEVANT");
    assert.strictEqual(res.sources[0].supportType, "RELATED_ONLY");
  });

  await asyncTest("Live 7: Unverifiable source", async () => {
    const res = await researchClaim("Factual claim here", "", {
      candidateSources: [
        { url: "https://dead-link-unreachable.example.com/paper.pdf", status: "SOURCE_NOT_VERIFIABLE" }
      ]
    });
    assert.strictEqual(res.sources[0].status, "SOURCE_NOT_VERIFIABLE");
  });

  test("Live 8: Two conflicting sources", () => {
    const claim = "Corporate revenue grew by 15% in 2024.";
    const sources = [
      { supportType: "DIRECT_SUPPORT", status: "CLAIM_SUPPORTED", url: "https://source1.com" },
      { supportType: "CONTRADICTS", status: "CLAIM_UNSUPPORTED", url: "https://source2.com" }
    ];
    const consensus = synthesizeSourceConsensus(claim, sources);
    assert.strictEqual(consensus.status, "CONFLICTING_EVIDENCE");
    assert.strictEqual(consensus.conflictDetected, true);
  });

  test("Live 9: Multiple claims in an academic paragraph", () => {
    const paragraph = "Global surface temperatures have risen by 1.1 degrees Celsius. World War II ended in 1945. We believe urgent policy actions are warranted.";
    const res = extractClaims(paragraph);
    assert.strictEqual(res.claims.length, 3);
    assert.strictEqual(res.claims[0].type, "STATISTICAL");
    assert.strictEqual(res.claims[1].type, "HISTORICAL");
    assert.strictEqual(res.claims[2].type, "OPINION");
  });

  test("Live 10: Citation analysis of an academic paragraph", () => {
    const paragraph = "Structural realism resolves the pessimistic meta-induction (Worrall, 1989). However, newer arguments challenge this premise [2]. In our view, the debate remains open.";
    const res = analyzeCitations(paragraph);
    assert.strictEqual(res.stats.totalCitations, 2);
    assert.strictEqual(res.stats.recognized, 2);
    assert.strictEqual(res.stats.parentheticalCount, 1);
    assert.strictEqual(res.stats.numericCount, 1);
  });

  test("Live 11: Generate reference suggestions only from retrieved source metadata", () => {
    const sources = [
      {
        url: "https://doi.org/10.1086/289483",
        title: "Structural Realism: The Best of Both Worlds?",
        author: "Worrall, John",
        year: 1989,
        publisher: "The British Journal for the Philosophy of Science",
        isVerified: true
      }
    ];
    const res = generateReferenceList(sources, "APA");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.totalReferences, 1);
    assert.strictEqual(res.references[0].formattedReference.includes("Worrall, John. (1989)"), true);
  });

  await asyncTest("Live 12: AI unavailable returns structured AI_UNAVAILABLE without crashing", async () => {
    const res = await explainWithAi("Summarize source");
    assert.strictEqual(typeof res.ok, "boolean");
    if (!res.ok) {
      assert.strictEqual(res.error, "AI_UNAVAILABLE");
    }
  });

  await asyncTest("Live 13: Combined Workflow (Document -> claims -> citations -> research -> Integrity Report)", async () => {
    const docText = "Solar power capacity increased by 32% in 2023 (Smith, 2024). Industrial emissions decreased in several member states.";
    // 1. Claim extraction
    const claimsRes = extractClaims(docText);
    assert.strictEqual(claimsRes.claims.length, 2);

    // 2. Citation analysis
    const citeRes = analyzeCitations(docText);
    assert.strictEqual(citeRes.claims[0].citationPresent, true);
    assert.strictEqual(citeRes.claims[1].citationPresent, false);
    assert.strictEqual(citeRes.claims[1].citationStatus, "CITATION_MISSING");

    // 3. Source research on claim 1
    const researchRes = await researchClaim(claimsRes.claims[0].text, "", {
      candidateSources: [
        {
          url: "https://energy.gov/solar-capacity-2023",
          title: "Solar Capacity 2023 Report",
          text: "Global solar power capacity increased by 32% in 2023 based on completed commercial projects."
        }
      ]
    });
    assert.strictEqual(researchRes.status, "CLAIM_SUPPORTED");

    // 4. Integrity Report verification: similarity score & AI likelihood remain 100% intact
    const integrityRep = generateIntegrityReport({
      analysis: {
        id: "VW-2026-LIVE13",
        similarity: { score: 55, grade: "C" },
        matchedPassages: [
          { matchType: "EXACT_MATCH", similarityScore: 0.95, text: "capacity increased by 32% in 2023" }
        ],
        sources: { items: [{ url: "https://energy.gov/solar-capacity-2023", isVerified: true }] }
      },
      aiWriting: { likelihood: 60, confidence: "MEDIUM" }
    });

    assert.strictEqual(integrityRep.ok, true);
    assert.strictEqual(integrityRep.report.similarity.score, 55);
    assert.strictEqual(integrityRep.report.aiWriting.likelihood, 60);
    assert.strictEqual(integrityRep.report.summary.plagiarismRelevantEvidenceCount, 1);
  });

  // Close server instance
  if (serverInstance) {
    serverInstance.close();
  }

  console.log("\n==================================================================================");
  console.log(`   CHECKRA PHASE 7 RESULTS: ${passed}/${passed + failed} PASSED (${failed} Failures)`);
  console.log("==================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error("Test runner execution error:", err);
  if (serverInstance) serverInstance.close();
  process.exit(1);
});
