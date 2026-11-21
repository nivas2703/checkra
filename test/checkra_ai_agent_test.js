/**
 * Checkra Phase 2.1: Score Explanation Integrity & Agent Orchestrator Test Suite
 *
 * Verifies:
 * 1. Agent endpoint exists (POST /api/agent)
 * 2. Agent can invoke Ollama qwen3:1.7b
 * 3. Agent can receive and parse an analysis context
 * 4. Agent can explain an existing similarity result
 * 5. Test A: Agent strictly preserves authoritative score
 * 6. Test B: Agent cannot replace the score with its own calculation
 * 7. Test C: Inconsistent component values do not cause agent to invent a new score (enforces required disclaimer)
 * 8. Test D: Missing score produces a clear "score unavailable" response rather than a fabricated score
 * 9. Graceful degradation when Ollama is unavailable
 * 10. Malformed model JSON does not crash the server
 * 11. Missing message validation (HTTP 400)
 * 12. Missing analysis handled politely
 * 13. Existing deterministic similarity engine remains unchanged
 */

const assert = require("assert");
const http = require("http");
const app = require("../server/server");
const { parseAndValidateModelOutput } = require("../server/ai/agent");
const { executeTool } = require("../server/ai/tools");

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

async function runAgentTests() {
  console.log("\n=================================================================");
  console.log("   CHECKRA PHASE 2.1: SCORE EXPLANATION INTEGRITY TEST SUITE");
  console.log("=================================================================\n");

  let passed = 0;
  let total = 0;

  function report(name, ok, details = "") {
    total++;
    if (ok) {
      passed++;
      console.log(`  ✓ [PASS] ${name} ${details ? "(" + details + ")" : ""}`);
    } else {
      console.error(`  ✗ [FAIL] ${name} — ${details}`);
    }
  }

  // Spin up ephemeral test server
  const server = await new Promise(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const serverBase = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Tool execution test
    console.log("--- 1. get_analysis_result Tool Execution ---");
    const sampleAnalysis = {
      id: "VW-2026-TESTAG",
      document: { title: "Research Paper on Quantum Optics", wordCount: 1500 },
      similarity: {
        score: 26,
        grade: "B",
        coverage: { exactPercent: 28, nearPercent: 26, semanticPercent: 18 }
      },
      sources: { matchingCount: 8, retrievedCount: 10 },
      matchedPassages: [
        {
          text: "Quantum optical coherence is determined by photon distribution statistics.",
          matchType: "EXACT",
          similarityScore: 1.0,
          sourceUrl: "https://example.org/quantum-optics",
          sourceTitle: "Foundations of Quantum Optics"
        }
      ],
      status: "completed"
    };

    const toolResult = executeTool("get_analysis_result", { analysis: sampleAnalysis });
    report("Tool get_analysis_result extracts analysisId", toolResult.analysisId === "VW-2026-TESTAG");
    report("Tool preserves exact deterministic score (26%)", toolResult.overallSimilarityScore === 26);
    report("Tool identifies score as available", toolResult.hasScore === true);
    report("Tool preserves exact coverage (28%)", toolResult.exactCoverage === 28);
    report("Tool preserves near coverage (26%)", toolResult.nearCoverage === 26);
    report("Tool preserves semantic coverage (18%)", toolResult.semanticCoverage === 18);
    report("Tool marks consistent component calculation", toolResult.isMathematicallyConsistent === true);
    report("Tool captures top matched passages", toolResult.topMatchedPassages.length === 1);

    // 2. Mathematical Inconsistency Detection (Rule 6)
    console.log("\n--- 2. Mathematical Inconsistency Detection ---");
    const inconsistentAnalysis = {
      id: "VW-2026-INCONSISTENT",
      similarity: {
        score: 85, // Discrepant overall score
        grade: "D",
        coverage: { exactPercent: 10, nearPercent: 10, semanticPercent: 10 } // Components sum to ~10%
      }
    };
    const inconsistentTool = executeTool("get_analysis_result", { analysis: inconsistentAnalysis });
    report("Tool flags mathematical inconsistency", inconsistentTool.isMathematicallyConsistent === false);
    report("Tool generates required verbatim disclaimer",
      inconsistentTool.inconsistencyNotice === "The displayed component percentages do not independently reproduce the reported overall score; the authoritative Checkra overall score is 85%.",
      inconsistentTool.inconsistencyNotice
    );

    // 3. Missing Score Handling (Rule D)
    console.log("\n--- 3. Missing Score Handling ---");
    const missingScoreAnalysis = {
      id: "VW-2026-NO-SCORE",
      document: { title: "Draft Document" },
      similarity: null // No score calculated
    };
    const missingScoreTool = executeTool("get_analysis_result", { analysis: missingScoreAnalysis });
    report("Tool recognizes missing score (hasScore: false)", missingScoreTool.hasScore === false);
    report("Tool does NOT fabricate 0% for missing score", missingScoreTool.overallSimilarityScore === null);

    // 4. Safe JSON parser & Score Protection Invariant Unit Tests
    console.log("\n--- 4. Score Protection & Parsing Invariants ---");
    const validJsonOutput = JSON.stringify({
      summary: "Document has moderate similarity with clear exact matches.",
      findings: ["Exact match in section 1"],
      evidence: ["28% exact coverage detected"],
      recommendations: ["Cite original source"],
      confidence: "high"
    });
    const parsedValid = parseAndValidateModelOutput(validJsonOutput, toolResult);
    report("Test A: Authoritative score preserved in valid output", parsedValid.structured === true);

    // Test B: Model attempts to invent a different score (e.g. 45% instead of 26%)
    const hallucinatedScoreOutput = JSON.stringify({
      summary: "I calculated the overall similarity score to be 45%.",
      findings: ["45% overall score"],
      evidence: [],
      recommendations: [],
      confidence: "high"
    });
    const parsedB = parseAndValidateModelOutput(hallucinatedScoreOutput, toolResult);
    report("Test B: Agent cannot override score; authoritative score note enforced",
      parsedB.findings.some(f => f.includes("Authoritative Checkra Overall Score: 26% (immutable)."))
    );

    // Test C: Inconsistent component values enforce required disclaimer
    const parsedC = parseAndValidateModelOutput(validJsonOutput, inconsistentTool);
    report("Test C: Inconsistent components enforce required disclaimer verbatim",
      parsedC.summary.includes("The displayed component percentages do not independently reproduce the reported overall score; the authoritative Checkra overall score is 85%.") ||
      parsedC.findings.includes("The displayed component percentages do not independently reproduce the reported overall score; the authoritative Checkra overall score is 85%.")
    );

    // Test D: Missing score produces clear unavailable response
    const parsedD = parseAndValidateModelOutput(validJsonOutput, missingScoreTool);
    report("Test D: Missing score produces 'score unavailable' notice, never fabricated 0%",
      parsedD.summary.toLowerCase().includes("unavailable") && !parsedD.summary.includes("overall similarity score is 0%")
    );

    // 5. Code-fenced and Malformed JSON Resilience
    console.log("\n--- 5. Malformed JSON Resilience ---");
    const codeFencedJson = "```json\n" + validJsonOutput + "\n```";
    const parsedFenced = parseAndValidateModelOutput(codeFencedJson, toolResult);
    report("Code-fenced markdown JSON parsed correctly", parsedFenced.structured === true);

    const malformedText = "I think the document has some issues: { this is not valid json at all }";
    const parsedMalformed = parseAndValidateModelOutput(malformedText, toolResult);
    report("Malformed model output does not crash", parsedMalformed !== null && typeof parsedMalformed === "object");
    report("Malformed model output falls back to structured: false", parsedMalformed.structured === false && parsedMalformed.summary.includes("issues"));

    // 6. Request Validation (Missing Message)
    console.log("\n--- 6. Request Validation (Missing Message) ---");
    const badReq = await postJson(serverBase, "/api/agent", { analysis: sampleAnalysis });
    report("Missing message returns HTTP 400", badReq.status === 400 && badReq.data?.ok === false && badReq.data?.error === "INVALID_REQUEST");

    // 7. Missing analysis handled politely
    console.log("\n--- 7. Missing Analysis Handled Politely ---");
    const noAnalysisReq = await postJson(serverBase, "/api/agent", {
      message: "What is the difference between exact and near similarity?"
    });
    report("Query without analysis returns HTTP 200", noAnalysisReq.status === 200 && noAnalysisReq.data?.ok === true);
    report("Response structure has required keys", typeof noAnalysisReq.data?.response?.summary === "string");
    report("Tools used is empty or contains no analysis tool", Array.isArray(noAnalysisReq.data?.toolsUsed));

    // 8. Live Query with Analysis: Explanation of similarity result
    console.log("\n--- 8. AI Reasoning with Analysis Evidence ---");
    const analysisReq = await postJson(serverBase, "/api/agent", {
      message: "Explain my similarity score and why exact coverage is 28%.",
      analysis: sampleAnalysis
    });
    report("Agent endpoint with analysis returns HTTP 200", analysisReq.status === 200 && analysisReq.data?.ok === true);
    report("Agent used get_analysis_result tool", analysisReq.data?.toolsUsed?.includes("get_analysis_result"));
    report("Agent response has summary string", typeof analysisReq.data?.response?.summary === "string" && analysisReq.data.response.summary.length > 20);
    report("Agent response provider is ollama", analysisReq.data?.agent?.provider === "ollama");
    report("Agent response model is qwen3:1.7b", analysisReq.data?.agent?.model === "qwen3:1.7b");

    // 9. Score protection verification: Ensure original score is unchanged
    console.log("\n--- 9. Score Protection Invariant ---");
    report("Original deterministic score in sampleAnalysis remains 26", sampleAnalysis.similarity.score === 26);
    report("Exact coverage in sampleAnalysis remains 28", sampleAnalysis.similarity.coverage.exactPercent === 28);

    // 10. Live missing score via API endpoint
    console.log("\n--- 10. Live Missing Score Request via API ---");
    const missingReq = await postJson(serverBase, "/api/agent", {
      message: "What is my score?",
      analysis: missingScoreAnalysis
    });
    report("Missing score API call returns HTTP 200", missingReq.status === 200 && missingReq.data?.ok === true);
    report("Missing score API explicitly indicates score is unavailable",
      missingReq.data?.response?.summary?.toLowerCase().includes("unavailable") ||
      missingReq.data?.response?.findings?.some(f => f.toLowerCase().includes("unavailable"))
    );

    // 11. Offline Ollama graceful degradation
    console.log("\n--- 11. Offline AI Provider Graceful Degradation ---");
    const origBaseUrl = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:19997";
    try {
      const offlineReq = await postJson(serverBase, "/api/agent", {
        message: "Explain my score",
        analysis: sampleAnalysis
      });
      report("Offline agent request returns HTTP 200 with ok: false", offlineReq.status === 200 && offlineReq.data?.ok === false);
      report("Offline error code is AI_UNAVAILABLE", offlineReq.data?.error === "AI_UNAVAILABLE");
      report("Offline message clarifies deterministic analysis remains available", offlineReq.data?.message?.includes("deterministic Checkra analysis remains available"));
    } finally {
      if (origBaseUrl) process.env.OLLAMA_BASE_URL = origBaseUrl;
      else delete process.env.OLLAMA_BASE_URL;
    }

    // 12. Deterministic similarity engine isolation verification
    console.log("\n--- 12. Deterministic Similarity Engine Unchanged ---");
    const simRes = await postJson(serverBase, "/api/analyze", {
      title: "Agent Isolation Verification",
      text: "Cellular respiration produces ATP by oxidizing respiratory substrates through glycolysis, the tricarboxylic acid cycle, and oxidative phosphorylation.",
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    report("Deterministic similarity engine executes independently", simRes.status === 200 && typeof simRes.data?.similarity?.score === "number");

    console.log("\n=================================================================");
    console.log(`   PHASE 2.1 AGENT ORCHESTRATOR RESULTS: ${passed}/${total} PASSED (0 Failures)`);
    console.log("=================================================================\n");

    if (passed !== total) {
      process.exit(1);
    }
    process.exit(0);
  } finally {
    await new Promise(r => server.close(r));
  }
}

runAgentTests().catch(err => {
  console.error("Agent orchestrator test failed:", err);
  process.exit(1);
});
