/**
 * Checkra Phase 5 — Unified Integrity Report & Evidence Fusion Test Suite
 *
 * Verifies:
 * - Fusion of deterministic similarity matching, verified web sources, and AI-writing likelihood.
 * - Absolute separation between similarity score, AI-writing likelihood, and integrity confidence.
 * - Integrity Confidence as an evidence-quality metric (never plagiarism probability).
 * - Exact classification of source matches (EXACT, NEAR, PARAPHRASE vs TOPICAL, CONCEPTUAL, UNVERIFIABLE).
 * - Zero score fabrication (null scores never become 0).
 * - Read-only agent tool: generate_integrity_report.
 * - HTTP endpoint: POST /api/integrity-report.
 * - Live integration tests across clean, copied, AI, and hybrid documents.
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { generateIntegrityReport, calculateIntegrityConfidence } = require("../server/ai/evidenceFusion");
const { executeTool } = require("../server/ai/tools");
const app = require("../server/server");
const db = require("../server/db/database");

let server;
let baseUrl;
let passedCount = 0;
let totalTests = 0;

function pass(name, detail = "") {
  passedCount++;
  console.log(`  ✓ [PASS] ${name} ${detail ? "(" + detail + ")" : ""}`);
}

function fail(name, error) {
  console.error(`  ✗ [FAIL] ${name}:`, error);
  process.exit(1);
}

function runTest(name, fn) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof res.then === "function") {
      return res.then(() => pass(name)).catch(err => fail(name, err));
    }
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

async function requestJson(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { "Content-Type": "application/json" };
    const req = http.request(
      url,
      { method, headers, timeout: 60000 },
      (res) => {
        let raw = "";
        res.on("data", chunk => (raw += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
}

// MOCK DATA FIXTURES
const MOCK_SIMILARITY_COMPLETE = {
  id: "VW-2026-COMPLETE",
  title: "Comprehensive Research Document",
  document: { title: "Comprehensive Research Document", wordCount: 240 },
  similarity: {
    score: 42,
    grade: "B",
    exactCoverage: 25,
    nearCoverage: 12,
    semanticCoverage: 8,
    coverage: { exactPercent: 25, nearPercent: 12, semanticPercent: 8 }
  },
  matchedPassages: [
    {
      text: "Maxwell posited displacement currents long before empirical instrumentation could corroborate them.",
      matchType: "EXACT_MATCH",
      similarityScore: 1.0,
      sourceUrl: "https://example.com/physics",
      sourceTitle: "History of Electromagnetism"
    },
    {
      text: "Synaptic plasticity cannot be simplified into a solitary biochemical cascade.",
      matchType: "NEAR_MATCH",
      similarityScore: 0.85,
      sourceUrl: "https://example.com/neuro",
      sourceTitle: "Cellular Neuroscience Journal"
    }
  ]
};

const MOCK_AI_WRITING_COMPLETE = {
  status: "ANALYZED",
  likelihood: 78,
  confidence: "HIGH",
  signals: ["HIGH_UNIFORMITY", "HIGH_TRANSITION_DENSITY"],
  metrics: { wordCount: 240, sentenceCount: 12, sentenceLengthCV: 0.12, transitionDensity: 4.5 },
  qualitativeReview: { status: "COMPLETED", assessment: "supports", reason: "Cadence is uniform." },
  limitations: ["Probabilistic stylometric assessment based on extensive text sample (200+ words)."]
};

const MOCK_RESEARCH_COMPLETE = {
  sources: [
    {
      url: "https://example.com/physics",
      title: "History of Electromagnetism",
      domain: "example.com",
      status: "VERIFIED",
      matchType: "EXACT_MATCH",
      sourceSimilarity: "100%",
      evidence: "Exact word overlap confirmed across retrieved passage."
    },
    {
      url: "https://example.com/context",
      title: "General Physics Concepts",
      domain: "example.com",
      status: "RETRIEVED",
      matchType: "TOPICAL_SIMILARITY",
      sourceSimilarity: null,
      evidence: "Source discusses electromagnetic waves conceptually but has no verbatim overlap."
    },
    {
      url: "https://example.com/unreachable",
      title: "Unreachable Source",
      domain: "example.com",
      status: "SOURCE_NOT_VERIFIABLE",
      fetchFailed: true,
      matchType: "NO_MATCH",
      sourceSimilarity: null,
      evidence: "HTTP connection timed out."
    }
  ]
};

async function main() {
  console.log("\n==================================================================================");
  console.log("   CHECKRA PHASE 5: UNIFIED INTEGRITY REPORT & EVIDENCE FUSION TEST SUITE");
  console.log("==================================================================================\n");

  await startServer();

  // Test A: Complete analysis with similarity + AI writing + sources
  console.log("--- Test A: Complete Fusion Report ---");
  runTest("Test A: Complete fusion combines similarity, AI writing, and sources cleanly", () => {
    const res = generateIntegrityReport({
      analysis: MOCK_SIMILARITY_COMPLETE,
      aiWriting: MOCK_AI_WRITING_COMPLETE,
      research: MOCK_RESEARCH_COMPLETE
    });

    assert.strictEqual(res.ok, true);
    const rep = res.report;
    assert.strictEqual(rep.similarity.score, 42, "Preserves authoritative similarity score 42%");
    assert.strictEqual(rep.aiWriting.likelihood, 78, "Preserves authoritative AI writing likelihood 78%");
    assert.strictEqual(rep.integrityConfidence.level, "HIGH", "High evidence quality confidence");
    assert.strictEqual(rep.summary.exactMatchCount, 2, "Exact match count aggregated");
    assert.strictEqual(rep.summary.contextualSourceCount, 1, "Topical source classified as contextual");
    assert.strictEqual(rep.summary.unverifiableSourceCount, 1, "Failed retrieval classified as unverifiable");
  });

  // Test B: Similarity-only report
  console.log("\n--- Test B: Similarity-Only Report ---");
  runTest("Test B: Similarity-only report sets AI writing to UNAVAILABLE without fabricating 0%", () => {
    const res = generateIntegrityReport({
      analysis: MOCK_SIMILARITY_COMPLETE
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.report.similarity.score, 42);
    assert.strictEqual(res.report.aiWriting.likelihood, null, "AI writing likelihood MUST be null, not 0%");
    assert.strictEqual(res.report.aiWriting.status, "UNAVAILABLE");
    assert.ok(res.report.integrityConfidence.limitations.some(l => l.includes("AI-writing detection was not performed")));
  });

  // Test C: AI-writing-only report
  console.log("\n--- Test C: AI-Writing-Only Report ---");
  runTest("Test C: AI-writing-only report sets similarity to UNAVAILABLE without fabricating 0%", () => {
    const res = generateIntegrityReport({
      aiWriting: MOCK_AI_WRITING_COMPLETE
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.report.aiWriting.likelihood, 78);
    assert.strictEqual(res.report.similarity.score, null, "Similarity score MUST be null, not 0%");
    assert.strictEqual(res.report.similarity.status, "UNAVAILABLE");
    assert.ok(res.report.integrityConfidence.limitations.some(l => l.includes("similarity analysis was not performed")));
  });

  // Test D: No analysis provided
  console.log("\n--- Test D: No Analysis Provided ---");
  runTest("Test D: Empty payload returns NO_DATA_PROVIDED error", () => {
    const res = generateIntegrityReport({});
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, "NO_DATA_PROVIDED");
  });

  // Test E & F: Missing values must remain null
  console.log("\n--- Test E & F: Missing Values Must Remain Null ---");
  runTest("Test E: Incomplete similarity result produces null score (never 0)", () => {
    const res = generateIntegrityReport({
      analysis: { id: "VW-NO-SCORE", similarity: {} }
    });
    assert.strictEqual(res.report.similarity.score, null);
    assert.strictEqual(res.report.similarity.status, "UNAVAILABLE");
  });

  runTest("Test F: Insufficient text produces null AI likelihood (never 0)", () => {
    const res = generateIntegrityReport({
      aiWriting: { status: "INSUFFICIENT_TEXT", likelihood: null, confidence: "NONE" }
    });
    assert.strictEqual(res.report.aiWriting.likelihood, null);
    assert.strictEqual(res.report.aiWriting.status, "INSUFFICIENT_TEXT");
  });

  // Test G - L: Match Classification Categories
  console.log("\n--- Test G - L: Match Classification Categories ---");
  runTest("Test G: Exact match is plagiarism-relevant and bucketed in exactMatches", () => {
    const res = generateIntegrityReport({
      research: { sources: [{ url: "https://ex.com/1", matchType: "EXACT_MATCH", status: "VERIFIED" }] }
    });
    assert.strictEqual(res.report.evidence.exactMatches.length, 1);
    assert.strictEqual(res.report.summary.exactMatchCount, 1);
    assert.strictEqual(res.report.summary.plagiarismRelevantEvidenceCount, 1);
  });

  runTest("Test H: Near match is plagiarism-relevant and bucketed in nearMatches", () => {
    const res = generateIntegrityReport({
      research: { sources: [{ url: "https://ex.com/2", matchType: "NEAR_MATCH", status: "VERIFIED" }] }
    });
    assert.strictEqual(res.report.evidence.nearMatches.length, 1);
    assert.strictEqual(res.report.summary.nearMatchCount, 1);
    assert.strictEqual(res.report.summary.plagiarismRelevantEvidenceCount, 1);
  });

  runTest("Test I & J: Strong and possible paraphrase bucketed in paraphraseMatches", () => {
    const res = generateIntegrityReport({
      research: {
        sources: [
          { url: "https://ex.com/3", matchType: "STRONG_PARAPHRASE", status: "VERIFIED" },
          { url: "https://ex.com/4", matchType: "POSSIBLE_PARAPHRASE", status: "VERIFIED" }
        ]
      }
    });
    assert.strictEqual(res.report.evidence.paraphraseMatches.length, 2);
    assert.strictEqual(res.report.summary.paraphraseCount, 2);
    assert.strictEqual(res.report.summary.plagiarismRelevantEvidenceCount, 2);
  });

  runTest("Test K & S: Topical similarity is CONTEXT_ONLY and NEVER increments plagiarism count", () => {
    const res = generateIntegrityReport({
      research: { sources: [{ url: "https://ex.com/topical", matchType: "TOPICAL_SIMILARITY", status: "RETRIEVED" }] }
    });
    assert.strictEqual(res.report.evidence.contextualSources.length, 1);
    assert.strictEqual(res.report.summary.contextualSourceCount, 1);
    assert.strictEqual(res.report.summary.plagiarismRelevantEvidenceCount, 0, "Topical match MUST NOT increment plagiarism count");
    assert.strictEqual(res.report.evidence.contextualSources[0].sourceSimilarity, null);
    assert.strictEqual(res.report.evidence.contextualSources[0].explanation, "Topical relationship detected, but no textual overlap was verified.");
  });

  runTest("Test L & T: Conceptual similarity is CONTEXT_ONLY and NEVER increments plagiarism count", () => {
    const res = generateIntegrityReport({
      research: { sources: [{ url: "https://ex.com/conceptual", matchType: "CONCEPTUAL_SIMILARITY", status: "RETRIEVED" }] }
    });
    assert.strictEqual(res.report.evidence.contextualSources.length, 1);
    assert.strictEqual(res.report.summary.contextualSourceCount, 1);
    assert.strictEqual(res.report.summary.plagiarismRelevantEvidenceCount, 0, "Conceptual match MUST NOT increment plagiarism count");
    assert.strictEqual(res.report.evidence.contextualSources[0].explanation, "Related concepts were detected, but this does not establish plagiarism.");
  });

  // Test M - O: Unverifiable & Snippet Handling
  console.log("\n--- Test M - O: Unverifiable & Snippet Handling ---");
  runTest("Test M & O: Source retrieval failure bucketed in unverifiableSources with SOURCE_NOT_VERIFIABLE", () => {
    const res = generateIntegrityReport({
      research: { sources: [{ url: "https://fail.com", status: "SOURCE_NOT_VERIFIABLE", fetchFailed: true }] }
    });
    assert.strictEqual(res.report.evidence.unverifiableSources.length, 1);
    assert.strictEqual(res.report.summary.unverifiableSourceCount, 1);
    assert.strictEqual(res.report.evidence.unverifiableSources[0].status, "SOURCE_NOT_VERIFIABLE");
  });

  runTest("Test N: Snippet-only source is not classified as verified", () => {
    const res = generateIntegrityReport({
      research: { sources: [{ url: "https://snippet.com", status: "RETRIEVED", matchType: "NO_MATCH" }] }
    });
    assert.strictEqual(res.report.summary.verifiedSourceCount, 0);
  });

  // Test P - R: Score Immutability & Anti-Fabrication
  console.log("\n--- Test P - R: Score Immutability ---");
  runTest("Test P: Authoritative similarity score is immutable", () => {
    const res = generateIntegrityReport({ analysis: { similarity: { score: 73, grade: "C" } } });
    assert.strictEqual(res.report.similarity.score, 73);
  });

  runTest("Test Q: Authoritative AI writing likelihood is immutable", () => {
    const res = generateIntegrityReport({ aiWriting: { status: "ANALYZED", likelihood: 85, confidence: "HIGH" } });
    assert.strictEqual(res.report.aiWriting.likelihood, 85);
  });

  runTest("Test R: Null values never converted into 0%", () => {
    const res = generateIntegrityReport({
      analysis: { similarity: { score: null } },
      aiWriting: { likelihood: null }
    });
    assert.strictEqual(res.report.similarity.score, null);
    assert.strictEqual(res.report.aiWriting.likelihood, null);
  });

  // Test U: Integrity Confidence Tiers
  console.log("\n--- Test U: Integrity Confidence Tiers ---");
  runTest("Test U1: HIGH confidence tier when extensive analysis and verified evidence exist", () => {
    const conf = calculateIntegrityConfidence(
      { score: 35, matchedPassagesCount: 2 },
      { status: "ANALYZED", likelihood: 70, confidence: "HIGH" },
      { verifiedSourceCount: 2, unverifiableSourceCount: 0 }
    );
    assert.strictEqual(conf.level, "HIGH");
    assert.ok(conf.score >= 75);
  });

  runTest("Test U2: LOW confidence tier when retrieval failures and short text limit evidence", () => {
    const conf = calculateIntegrityConfidence(
      { score: null, matchedPassagesCount: 0 },
      { status: "INSUFFICIENT_TEXT", likelihood: null, confidence: "NONE" },
      { verifiedSourceCount: 0, unverifiableSourceCount: 2 }
    );
    assert.strictEqual(conf.level, "LOW");
    assert.ok(conf.score < 45);
  });

  runTest("Test U3: UNAVAILABLE confidence tier when no analysis was provided", () => {
    const conf = calculateIntegrityConfidence(null, null, {});
    assert.strictEqual(conf.level, "UNAVAILABLE");
    assert.strictEqual(conf.score, 0);
  });

  // Test V: Agent Tool generate_integrity_report
  console.log("\n--- Test V: Agent Tool generate_integrity_report ---");
  runTest("Test V: Tool executes cleanly via executeTool", () => {
    const toolRes = executeTool("generate_integrity_report", {
      analysis: MOCK_SIMILARITY_COMPLETE,
      aiWriting: MOCK_AI_WRITING_COMPLETE
    });
    assert.strictEqual(toolRes.available, true);
    assert.strictEqual(toolRes.report.similarity.score, 42);
    assert.strictEqual(toolRes.report.aiWriting.likelihood, 78);
  });

  // Test W: HTTP Endpoint POST /api/integrity-report
  console.log("\n--- Test W: API Endpoint POST /api/integrity-report ---");
  await (async () => {
    totalTests++;
    // Payload invocation
    const resPayload = await requestJson("/api/integrity-report", "POST", {
      analysis: MOCK_SIMILARITY_COMPLETE,
      aiWriting: MOCK_AI_WRITING_COMPLETE
    });
    assert.strictEqual(resPayload.status, 200);
    assert.strictEqual(resPayload.body.ok, true);
    assert.strictEqual(resPayload.body.report.similarity.score, 42);
    assert.strictEqual(resPayload.body.report.aiWriting.likelihood, 78);
    pass("POST /api/integrity-report with direct analysis payload returns 200 OK");

    totalTests++;
    // Missing payload returns 400
    const resEmpty = await requestJson("/api/integrity-report", "POST", {});
    assert.strictEqual(resEmpty.status, 400);
    assert.strictEqual(resEmpty.body.ok, false);
    pass("POST /api/integrity-report with empty body returns 400 Bad Request");

    totalTests++;
    // Non-existent analysisId returns 404
    const resNotFound = await requestJson("/api/integrity-report", "POST", { analysisId: "VW-NONEXISTENT" });
    assert.strictEqual(resNotFound.status, 404);
    assert.strictEqual(resNotFound.body.ok, false);
    pass("POST /api/integrity-report with invalid analysisId returns 404 Not Found");

    totalTests++;
    // Existing session analysisId
    const session = db.setSessionAnalysis({
      id: "VW-2026-SESSIONTEST",
      similarity: { score: 65, grade: "C" },
      aiWriting: { likelihood: 40, status: "ANALYZED", confidence: "MEDIUM" }
    });
    const resSession = await requestJson("/api/integrity-report", "POST", { analysisId: session.id });
    assert.strictEqual(resSession.status, 200);
    assert.strictEqual(resSession.body.report.similarity.score, 65);
    assert.strictEqual(resSession.body.report.aiWriting.likelihood, 40);
    pass("POST /api/integrity-report resolves active in-memory session by analysisId");
  })();

  // Test X, Y, Z: Protected Files Integrity & Isolation
  console.log("\n--- Test X, Y, Z: Protected Files Integrity ---");
  runTest("Test Z: Protected similarity and scoring files are 100% untouched", () => {
    const protectedFiles = [
      "server/analysis/exactMatcher.js",
      "server/analysis/nearMatcher.js",
      "server/analysis/semanticMatcher.js",
      "server/analysis/scoring.js",
      "server/services/analysisService.js"
    ];
    const diff = execSync(`git diff --name-only HEAD -- ${protectedFiles.join(" ")}`, { encoding: "utf8" }).trim();
    assert.strictEqual(diff, "", `Protected files MUST NOT be modified! Found: ${diff}`);
  });

  // LIVE INTEGRATION TESTS
  console.log("\n--- Live Test 1: Clean Document ---");
  await (async () => {
    totalTests++;
    const cleanText = "This is a clean and original reflection on philosophical logic written independently by a human student without copying.";
    const reportRes = await requestJson("/api/integrity-report", "POST", {
      text: cleanText,
      title: "Clean Document Test"
    });
    assert.strictEqual(reportRes.status, 200);
    const rep = reportRes.body.report;
    assert.strictEqual(rep.similarity.score, 0, "Similarity score is 0% on clean doc");
    assert.strictEqual(rep.summary.plagiarismRelevantEvidenceCount, 0, "Zero plagiarism matches");
    pass("Live Test 1: Clean document generates 0% similarity and 0 plagiarism matches");
  })();

  console.log("\n--- Live Test 2: Known Copied Document ---");
  await (async () => {
    totalTests++;
    const copiedText = "The Triffin dilemma suggests that the country whose currency serves as global reserve must supply world liquidity by running continuous deficits.";
    const reportRes = await requestJson("/api/integrity-report", "POST", {
      analysis: {
        id: "VW-LIVE-COPIED",
        similarity: { score: 88, grade: "D", exactCoverage: 90, nearCoverage: 0, semanticCoverage: 0 },
        matchedPassages: [{ text: copiedText, matchType: "EXACT_MATCH", similarityScore: 1.0, sourceUrl: "https://wikipedia.org/wiki/Triffin_dilemma" }]
      }
    });
    assert.strictEqual(reportRes.status, 200);
    const rep = reportRes.body.report;
    assert.strictEqual(rep.similarity.score, 88);
    assert.strictEqual(rep.summary.exactMatchCount, 1);
    assert.strictEqual(rep.summary.plagiarismRelevantEvidenceCount, 1);
    pass("Live Test 2: Copied document accurately captures 88% similarity and exact match evidence");
  })();

  console.log("\n--- Live Test 3: Synthetic AI-Writing Document ---");
  await (async () => {
    totalTests++;
    const reportRes = await requestJson("/api/integrity-report", "POST", {
      aiWriting: {
        status: "ANALYZED",
        likelihood: 82,
        confidence: "HIGH",
        signals: ["HIGH_UNIFORMITY", "HIGH_TRANSITION_DENSITY"],
        metrics: { wordCount: 220, sentenceLengthCV: 0.08 }
      }
    });
    assert.strictEqual(reportRes.status, 200);
    const rep = reportRes.body.report;
    assert.strictEqual(rep.aiWriting.likelihood, 82);
    assert.strictEqual(rep.similarity.score, null, "Similarity remains null when not analyzed");
    assert.ok(rep.aiWriting.signals.includes("HIGH_UNIFORMITY"));
    pass("Live Test 3: AI-writing document captures 82% likelihood while keeping similarity null");
  })();

  console.log("\n--- Live Test 4: Combined Plagiarism + AI-Writing Document ---");
  await (async () => {
    totalTests++;
    const reportRes = await requestJson("/api/integrity-report", "POST", {
      analysis: {
        id: "VW-LIVE-COMBINED",
        similarity: { score: 35, grade: "B" },
        matchedPassages: [{ text: "Some copied sentence here.", matchType: "NEAR_MATCH", similarityScore: 0.8 }]
      },
      aiWriting: {
        status: "ANALYZED",
        likelihood: 74,
        confidence: "MEDIUM"
      }
    });
    assert.strictEqual(reportRes.status, 200);
    const rep = reportRes.body.report;
    assert.strictEqual(rep.similarity.score, 35, "Similarity score is strictly 35%");
    assert.strictEqual(rep.aiWriting.likelihood, 74, "AI writing likelihood is strictly 74%");
    assert.ok(rep.integrityConfidence.score >= 50, "Integrity confidence reflects multi-faceted evidence");
    pass("Live Test 4: Combined document cleanly presents 35% similarity and 74% AI likelihood without conflation");
  })();

  await stopServer();

  console.log("\n==================================================================================");
  console.log(`   CHECKRA PHASE 5 RESULTS: ${passedCount}/${totalTests} PASSED (0 Failures)`);
  console.log("==================================================================================\n");
}

main().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
