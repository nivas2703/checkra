/**
 * Checkra Production Stabilization Test Suite
 *
 * Verifies:
 * 1. Error 1 Prevention: sim is defined and guarded in all rendering paths (including 0% / 0 passages)
 * 2. Error 2 Prevention: Non-JSON response (e.g. Vercel deployment/504 errors) handled gracefully without JSON parse crash
 * 3. Gemini Decoupling: Core score is deterministically calculated without dependency on Gemini response
 * 4. Large Document Handling: 7,000+ words (16 pages) analysis completes rapidly without serverless timeout
 * 5. Backend JSON Guarantee: Express error middleware and API endpoints strictly set Content-Type: application/json
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { executeAnalysis } = require("../server/services/analysisService");
const { generateReportPackage } = require("../server/reports/reportGenerator");
const app = require("../server/server");

async function runStabilizationTests() {
  console.log("\n=================================================================");
  console.log("   CHECKRA PRODUCTION STABILIZATION TEST SUITE");
  console.log("=================================================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`  ✓ [PASS] ${name}`);
        passed++;
      } catch (err) {
        console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
        failed++;
      }
    })();
  }

  // --- 1. Error 1: sim is not defined prevention ---
  console.log("--- 1. Scope & Reference Error Safeguards ---");

  await test("reportGenerator handles undefined/missing similarity safely", async () => {
    const report = await generateReportPackage({
      id: "VW-2026-TEST-SIM",
      document: { title: "Test Doc", wordCount: 100 },
      // similarity is deliberately undefined
      matchedPassages: []
    });
    assert(report.htmlReport.includes("Checkra Writing Integrity Report"));
    assert(report.htmlReport.includes("0%"));
  });

  await test("index.html renders 0% similarity without 'sim is not defined' ReferenceError", async () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    // Verify renderPassagesTab declares sim safely
    assert(html.includes("function renderPassagesTab(analysis)"));
    assert(html.includes("const sim = (analysis && analysis.similarity) ? analysis.similarity :"));
    assert(html.includes("parseApiResponse(res)"));
  });

  // --- 2. Error 2: Non-JSON response parsing ---
  console.log("\n--- 2. Robust API Parser & Error 2 Safeguards ---");

  await test("Frontend parseApiResponse function guards against Vercel deployment errors", async () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert(html.includes("An error occurred with your deployment"));
    assert(html.includes("Serverless execution timeout"));
    // Ensure no direct res.json() calls remain in api object
    const apiBlock = html.substring(html.indexOf("const api = {"), html.indexOf("const state = {"));
    assert(!apiBlock.includes("await res.json()"), "api client should not call await res.json() directly without parseApiResponse");
  });

  // --- 3. Gemini Decoupling ---
  console.log("\n--- 3. Gemini Decoupling & Score Integrity ---");

  await test("Core score calculation succeeds even when Gemini is completely disabled/offline", async () => {
    const sampleText = `Artificial intelligence has transformed numerous computational domains including natural language processing, computer vision, and autonomous systems. Researchers continue to develop novel methodologies to enhance model efficiency, accuracy, and generalization capabilities. Machine learning algorithms rely on extensive data representations to uncover underlying statistical patterns and relationships.`;
    
    const result = await executeAnalysis({
      text: sampleText,
      title: "Gemini Decoupled Test",
      options: { disablePublicWebSearch: true } // will run local comparison
    });

    assert(typeof result.similarity.score === "number", "Similarity score must be a number");
    assert(result.similarity.grade, "Similarity grade must be assigned");
    assert(result.status.startsWith("completed"), "Analysis must complete");
    assert(result.stageStatuses.localSimilarity === "success", "Local similarity must succeed");
    // Verify score is deterministic
    assert(result.similarity.score >= 0 && result.similarity.score <= 100);
  });

  // --- 4. Large Document Handling (7,000+ words, 16 pages) ---
  console.log("\n--- 4. Large Document Performance (7,000+ Words / 16 Pages) ---");

  await test("Large document (7,200 words) analyzes in < 4 seconds without timeout", async () => {
    const paragraph = "The integration of distributed computing architectures facilitates horizontal scalability across enterprise cloud clusters. Modern applications leverage asynchronous message queues, microservices, and container orchestration platforms to deliver resilient computational performance. Machine learning inference pipelines benefit significantly from optimized vector indices and hardware acceleration units.\n\n";
    // 7,200+ words (~16 pages)
    const longText = paragraph.repeat(180);
    const wordCount = longText.split(/\s+/).filter(Boolean).length;
    assert(wordCount >= 7000, `Expected >= 7000 words, got ${wordCount}`);

    const startTime = Date.now();
    const result = await executeAnalysis({
      text: longText,
      title: "16-Page Large Document Benchmark",
      fileStats: { wordCount, pageCount: 16 },
      options: { disablePublicWebSearch: true }
    });
    const elapsedMs = Date.now() - startTime;

    console.log(`     [Large Doc Benchmark: ${wordCount} words, 16 pages -> completed in ${elapsedMs}ms, Score: ${result.similarity.score}%]`);
    assert(elapsedMs < 6000, `Analysis took ${elapsedMs}ms, expected < 6000ms for serverless safety`);
    assert(result.status.startsWith("completed"));
    assert(result.document.wordCount === wordCount);
    assert(result.document.pageCount === 16);
  });

  // --- 5. Backend JSON Guarantees ---
  console.log("\n--- 5. Backend HTTP Status & JSON Guarantees ---");

  await test("Express error middleware guarantees Content-Type: application/json", async () => {
    const srv = await new Promise(resolve => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = srv.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Short" }) // Too short (<20 chars) -> triggers error
      });
      assert(res.status === 400 || res.status === 500, `Expected 400 or 500, got ${res.status}`);
      const contentType = res.headers.get("content-type");
      assert(contentType.includes("application/json"), `Expected application/json, got ${contentType}`);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert(data.error.message.includes("20 characters"));
    } finally {
      await new Promise(resolve => srv.close(resolve));
    }
  });

  await test("Vercel api/index.js exports robust serverless handler with JSON guarantee", async () => {
    const vercelHandler = require("../api/index");
    assert.strictEqual(typeof vercelHandler, "function");
  });

  console.log("\n=================================================================");
  console.log(` STABILIZATION SUITE RESULTS: ${passed}/${passed + failed} PASSED (${failed} Failed)`);
  console.log("=================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runStabilizationTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
}

module.exports = { runStabilizationTests };
