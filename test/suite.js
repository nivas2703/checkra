/**
 * VeriWrite Automated Test Suite
 * Tests:
 * 1. SSRF & Security validation
 * 2. Document extraction & preprocessing
 * 3. Level 1 Exact Matching
 * 4. Level 2 Near Matching
 * 5. Level 3 Semantic Similarity
 * 6. Source Classification
 * 7. Transparent Scoring & Grades
 * 8. Grammar Provider
 * 9. Gemini Rewrite Provider (clean error when unconfigured)
 * 10. Session-Only Store (No permanent history database)
 * 11. Decoupled End-to-End Pipeline with Partial Success Tolerance
 */

const assert = require("assert");
const path = require("path");
const fs = require("fs");

const { isSafeUrl, sanitizeHtml } = require("../server/utils/security");
const { preprocessDocument } = require("../server/document/preprocessor");
const { findExactMatches } = require("../server/analysis/exactMatcher");
const { findNearMatches } = require("../server/analysis/nearMatcher");
const { findSemanticMatches } = require("../server/analysis/semanticMatcher");
const { calculateDocumentScore, calculateGrade } = require("../server/analysis/scoring");
const { checkGrammar } = require("../server/providers/grammarProvider");
const { rewriteText } = require("../server/providers/rewriteProvider");
const { classifySource } = require("../server/providers/sourceClassifier");
const db = require("../server/db/database");
const { executeAnalysis } = require("../server/services/analysisService");

async function runTests() {
  console.log("=========================================");
  console.log("  VERIWRITE REBUILT TEST SUITE           ");
  console.log("=========================================\n");

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`  [FAIL] ${name}: ${e.message}`);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`  [FAIL] ${name}: ${e.message}`);
    }
  }

  // 1. SSRF & Security
  test("Security: SSRF blocks private IPs, metadata and localhost", () => {
    assert.strictEqual(isSafeUrl("http://localhost:8080"), false);
    assert.strictEqual(isSafeUrl("http://127.0.0.1/admin"), false);
    assert.strictEqual(isSafeUrl("http://169.254.169.254/latest/meta-data"), false);
    assert.strictEqual(isSafeUrl("http://10.0.0.1/secret"), false);
    assert.strictEqual(isSafeUrl("http://192.168.1.1/router"), false);
    assert.strictEqual(isSafeUrl("javascript:alert(1)"), false);
    assert.strictEqual(isSafeUrl("https://en.wikipedia.org/wiki/Plagiarism"), true);
    assert.strictEqual(isSafeUrl("https://example.edu/paper"), true);
  });

  test("Security: HTML sanitization strips scripts and dangerous elements", () => {
    const dirty = "<div>Hello <script>alert('xss')</script><style>body{color:red}</style>world! &amp; more</div>";
    const clean = sanitizeHtml(dirty);
    assert.strictEqual(clean.includes("script"), false);
    assert.strictEqual(clean.includes("alert"), false);
    assert.strictEqual(clean.includes("style"), false);
    assert.strictEqual(clean, "Hello world! & more");
  });

  // 2. Preprocessing & Normalization
  test("Preprocessing: Normalizes Unicode, removes invisible chars and detects quotes/biblio", () => {
    const input = "“Smart systems” incorporate\u200B digital transformation.\n\nReferences\n1. Smith, J. (2020). Modern Computing.";
    const result = preprocessDocument(input, { ignoreBibliography: true, ignoreQuotations: false });
    assert.strictEqual(result.sections.length, 2);
    assert.strictEqual(result.sections[1].isBibliography, true);
    assert.strictEqual(result.eligibleSentences.length, 1);
  });

  // 3. Level 1 — Exact Match
  test("Level 1 Exact Match: Identifies identical n-gram sequences", () => {
    const submitted = "Digital transformation has become an important part of modern business strategy. Organizations increasingly use technology.";
    const source = "Digital transformation has become an important part of modern business strategy. Something completely different here.";
    const res = findExactMatches(submitted, source, 6);
    assert(res.matches.length > 0, "Should detect exact match");
    assert.strictEqual(res.matches[0].type, "EXACT");
    assert(res.exactOverlapPercent > 0, "Exact overlap must be > 0");
  });

  // 4. Level 2 — Near Match
  test("Level 2 Near Match: Detects word substitutions and grammatical variations", () => {
    const submittedSent = "Modern enterprise strategy now considers digital transformation essential, as companies routinely apply technological tools to boost operational performance.";
    const sourceSent = "Digital transformation has become an important part of modern business strategy, as companies routinely apply technology to boost operational efficiency.";
    const res = findNearMatches([submittedSent], [sourceSent], 0.50);
    assert(res.length > 0, "Should detect near match with modified wording");
    assert.strictEqual(res[0].type, "NEAR");
  });

  // 5. Level 3 — Semantic Similarity
  await testAsync("Level 3 Semantic Similarity: Measures vector semantic similarity", async () => {
    const s1 = "Integrating computer systems and automated workflows allows commercial enterprises to optimize their daily operations.";
    const s2 = "Organizations increasingly use technology to improve operational efficiency and financial performance.";
    const res = await findSemanticMatches([s1], [s2], { threshold: 30 });
    assert(res.matches.length > 0, "Should find semantic similarity");
    assert.strictEqual(res.matches[0].type, "SEMANTIC");
  });

  // 6. Source Classification
  test("Source Classification: Accurately categorizes domains without guessing", () => {
    assert.strictEqual(classifySource("https://harvard.edu/research").type, "Educational");
    assert.strictEqual(classifySource("https://nih.gov/news").type, "Government");
    assert.strictEqual(classifySource("https://nature.com/articles/s41586").type, "Journal / Publication");
    assert.strictEqual(classifySource("https://github.com/torvalds/linux").type, "Repository");
    assert.strictEqual(classifySource("https://nytimes.com/tech").type, "News");
    assert.strictEqual(classifySource("https://unknown-xyz-site.com").type, "Internet");
  });

  // 7. Scoring Algorithm
  test("Scoring Algorithm: Transparent evidence calculation and VeriWrite grades", () => {
    assert.strictEqual(calculateGrade(5), "A");
    assert.strictEqual(calculateGrade(14), "B");
    assert.strictEqual(calculateGrade(45), "C");
    assert.strictEqual(calculateGrade(80), "D");

    const tokens = ["digital", "transformation", "improves", "efficiency", "and", "growth"];
    const emptyScore = calculateDocumentScore(tokens, []);
    assert.strictEqual(emptyScore.score, 0, "Must be 0 when no verified sources exist");
    assert.strictEqual(emptyScore.grade, "A");
  });

  // 8. Grammar Provider
  await testAsync("Grammar Provider: Flags grammatical and spelling errors", async () => {
    const badText = "The students left there books on the table in order to study.";
    const res = await checkGrammar(badText);
    assert(res.findings.length > 0, "Should detect 'there' vs 'their' and 'in order to'");
    const homophone = res.findings.find(f => f.replacement === "their");
    assert(homophone, "Should suggest 'their'");
  });

  // 9. Gemini Rewrite Provider Error Handling
  await testAsync("Gemini Rewrite: Returns structured error when GEMINI_API_KEY is not configured", async () => {
    // If not configured, should return clean structured error rather than crash
    const res = await rewriteText("Digital transformation enhances business operations.", "clear-natural");
    if (!process.env.GEMINI_API_KEY) {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.code, "GEMINI_NOT_CONFIGURED");
    } else {
      assert(res.success === true || res.success === false);
    }
  });

  // 10. Session-Only Store (No History Database)
  test("Session Store: Stores in memory for current session only, no permanent history files", () => {
    const id = db.generateAnalysisId();
    assert(/^VW-\d{4}-[A-Z0-9]{6}$/.test(id));
    db.setSessionAnalysis({ id, title: "Test Doc", similarity: { score: 14 } });
    const sessionDoc = db.getSessionAnalysis(id);
    assert.strictEqual(sessionDoc.id, id);
    // Confirm no permanent analysis history DB file is created
    assert.strictEqual(fs.existsSync(path.join(__dirname, "../data/veriwrite_db.json")), false);
  });

  // 11. Decoupled Pipeline with Partial Success
  await testAsync("End-to-End Pipeline: Executes decoupled stages with partial success tolerance", async () => {
    const testDoc = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/test-document.json"), "utf8"));
    const stepsRun = [];
    const result = await executeAnalysis({
      text: testDoc.text,
      title: testDoc.title,
      onProgress: p => stepsRun.push(p.step)
    });

    assert(stepsRun.includes(1), "Step 1 must run");
    assert(stepsRun.includes(10), "Step 10 must run");
    assert(result.status === "completed" || result.status === "completed_with_limitations");
    assert(result.id.startsWith("VW-"));
    assert(result.similarity.score >= 0);
    assert(result.matchedPassages.length > 0);
  });

  console.log("\n=========================================");
  console.log(`  TEST RESULTS: ${passed}/${total} PASSED`);
  console.log("=========================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner encountered error:", err);
  process.exit(1);
});
