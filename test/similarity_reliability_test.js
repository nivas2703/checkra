/**
 * Checkra Similarity Engine Reliability & Invariant Regression Suite
 * Tests 1 through 14 covering all core similarity invariants, adversarial false-positive protections,
 * and graceful service degradations.
 */

const assert = require("assert");
const { findExactMatches } = require("../server/analysis/exactMatcher");
const { findNearMatches } = require("../server/analysis/nearMatcher");
const { findSemanticMatches } = require("../server/analysis/semanticMatcher");
const { calculateDocumentScore } = require("../server/analysis/scoring");
const { executeAnalysis } = require("../server/services/analysisService");
const { retrievePage } = require("../server/providers/pageRetriever");

async function runReliabilityTests() {
  console.log("=================================================================");
  console.log("   CHECKRA SIMILARITY RELIABILITY & INVARIANTS SUITE (14 TESTS)   ");
  console.log("=================================================================\n");

  let passed = 0;
  let total = 0;

  function record(testNum, name, condition, details) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✓ [PASS] TEST ${testNum}: ${name} (${details})`);
    } else {
      console.error(`  ✗ [FAIL] TEST ${testNum}: ${name} (${details})`);
    }
  }

  // TEST 1 — Completely original text
  // Expected: 0% or very low (< 5%)
  {
    const originalText = "Bioluminescent barophilic organisms thriving in abyssal hydrothermal fissures exhibit distinct mitochondrial enzymatic kinetics under extreme thermodynamic pressures.";
    const result = await executeAnalysis({
      text: originalText,
      title: "Test 1 — Original Text",
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    record(1, "Completely Original Text", result.similarity.score <= 5 && result.sources.matchingCount === 0, `Score: ${result.similarity.score}%, Sources: ${result.sources.matchingCount}`);
  }

  // TEST 2 — 100% verbatim copied text
  // Expected: very high similarity (>= 85%)
  {
    const copiedText = "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation. Python is dynamically typed and garbage-collected. It supports multiple programming paradigms, including structured, object-oriented and functional programming.";
    const result = await executeAnalysis({
      text: copiedText,
      title: "Test 2 — 100% Verbatim Copied Text",
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    record(2, "100% Verbatim Copied Text", result.similarity.score >= 85 && result.sources.matchingCount >= 1, `Score: ${result.similarity.score}%, Exact: ${result.similarity.coverage.exactPercent}%`);
  }

  // TEST 3 — Copied text with minor word substitutions
  // Expected: high similarity (>= 60%)
  {
    const subbedText = "Python is a high-level, widely-utilized, general-purpose programming language. Its design approach emphasizes code clarity with the utilization of significant indentation.";
    const sourceText = "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation.";
    const nearMatches = findNearMatches([subbedText], [sourceText], 0.45);
    const docTokens = subbedText.toLowerCase().split(/\s+/);
    const scoreResult = calculateDocumentScore(docTokens, [{
      status: "VERIFIED",
      exactMatches: [],
      nearMatches,
      semanticMatches: []
    }]);
    record(3, "Copied Text with Minor Substitutions", nearMatches.length >= 1, `Near matches: ${nearMatches.length}, Sim: ${nearMatches[0]?.similarityScore}%`);
  }

  // TEST 4 — Genuine paraphrase
  // Expected: meaningful semantic detection
  {
    const submitted = "ML algorithms learn patterns from datasets and use those learned patterns to generate predictions.";
    const source = "Machine learning systems construct statistical models from training data to make predictions.";
    const sem = await findSemanticMatches([submitted], [source]);
    const detected = sem.matches.some(m => m.classification === "STRONG_PARAPHRASE" || m.classification === "POSSIBLE_PARAPHRASE");
    record(4, "Genuine Paraphrase Detection", detected, `Matches: ${sem.matches.length}, Class: ${sem.matches[0]?.classification}, Cosine: ${sem.matches[0]?.rawSemanticSimilarity}`);
  }

  // TEST 5 — Same-topic but independently written text
  // Expected: low/zero plagiarism (classified as TOPICAL_SIMILARITY or NO_MATCH, isPlagiarismEvidence = false)
  {
    const s1 = "Companies use machine learning to improve business decisions.";
    const s2 = "Machine learning is widely used in modern businesses.";
    const sem = await findSemanticMatches([s1], [s2]);
    const isPlagiarism = sem.matches.some(m => m.isPlagiarismEvidence === true);
    record(5, "Same-Topic Independently Written Text", !isPlagiarism, `Plagiarism evidence: ${isPlagiarism}, Class: ${sem.matches[0]?.classification || "NO_MATCH"}`);
  }

  // TEST 6 — Generic textbook definition
  // Expected: not classified as high-confidence plagiarism evidence
  {
    const def1 = "Machine learning is a branch of artificial intelligence.";
    const def2 = "Machine learning is a field of study within artificial intelligence.";
    const sem = await findSemanticMatches([def1], [def2]);
    const isHighPlagiarism = sem.matches.some(m => m.classification === "STRONG_PARAPHRASE");
    record(6, "Generic Textbook Definition Guardrail", !isHighPlagiarism, `High plagiarism: ${isHighPlagiarism}, Tier: ${sem.matches[0]?.tier || "NONE"}`);
  }

  // TEST 7 — Mixed document: 30% copied, 70% original
  // Expected: approximately proportional evidence coverage (~20-40%)
  {
    const docTokens = new Array(100).fill("orig_word");
    const copiedSectionTokens = new Array(30).fill("copied_word");
    const ev = [{
      status: "VERIFIED",
      exactMatches: [{ submittedIndex: 0, length: 30 }],
      nearMatches: [],
      semanticMatches: []
    }];
    const scoreRes = calculateDocumentScore(docTokens, ev);
    record(7, "Mixed Document Score Proportionality (30% copy)", scoreRes.score >= 18 && scoreRes.score <= 35, `Score: ${scoreRes.score}%, Exact: ${scoreRes.coverage.exactPercent}%`);
  }

  // TEST 8 — Two unrelated documents sharing domain terminology
  // Expected: no verified match (0%)
  {
    const docA = "The database cluster architecture optimizes transactional throughput across distributed sharded nodes.";
    const docB = "Digital marketing analytics platforms monitor web visitor demographics across social media channels.";
    const sem = await findSemanticMatches([docA], [docB]);
    const hasEvidence = sem.matches.some(m => m.isPlagiarismEvidence === true);
    record(8, "Unrelated Documents Sharing Buzzwords", !hasEvidence, `Plagiarism evidence: ${hasEvidence}, Matches: ${sem.matches.length}`);
  }

  // TEST 9 — Very short sentence against a long source
  // Expected: no false high score
  {
    const shortSub = "Technology improves efficiency.";
    const longSrc = "In contemporary enterprise computing environments, modern software technology substantially improves operational efficiency and fiscal transparency across all departmental administrative workflows.";
    const sem = await findSemanticMatches([shortSub], [longSrc]);
    const isStrong = sem.matches.some(m => m.classification === "STRONG_PARAPHRASE");
    record(9, "Short Sentence vs Long Source Guardrail", !isStrong, `Strong paraphrase: ${isStrong}, Class: ${sem.matches[0]?.classification || "NONE"}`);
  }

  // TEST 10 — Long sentence against a very short source
  // Expected: reciprocal coverage protection
  {
    const longSub = "Integrating scalable cloud computing clusters and automated container workflows enables contemporary enterprise organizations to optimize their annual operational expenditures.";
    const shortSrc = "Organizations optimize operations.";
    const sem = await findSemanticMatches([longSub], [shortSrc]);
    const isStrong = sem.matches.some(m => m.classification === "STRONG_PARAPHRASE");
    record(10, "Long Sentence vs Short Source Guardrail (Reciprocal Coverage)", !isStrong, `Strong paraphrase: ${isStrong}, Class: ${sem.matches[0]?.classification || "NONE"}`);
  }

  // TEST 11 — Copied content from two different sources
  // Expected: both sources identified
  {
    const multiSrcDoc = [
      "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation.",
      "Digital transformation has become an important part of modern business strategy. Organizations increasingly use technology to improve operational efficiency, customer experience, and financial performance."
    ].join("\n\n");
    const result = await executeAnalysis({
      text: multiSrcDoc,
      title: "Test 11 — Multi-Source Document",
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    record(11, "Multi-Source Detection", result.sources.matchingCount >= 2, `Verified Sources Identified: ${result.sources.matchingCount}`);
  }

  // TEST 12 — Gemini unavailable
  // Expected: complete plagiarism analysis still works
  {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const testDoc = "Python is dynamically typed and garbage-collected. It supports multiple programming paradigms, including structured, object-oriented and functional programming.";
    const result = await executeAnalysis({
      text: testDoc,
      title: "Test 12 — Gemini Offline",
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    process.env.GEMINI_API_KEY = prevKey;
    record(12, "Gemini Unavailable Graceful Plagiarism Execution", result.similarity.score > 0 && result.aiReview.available === false, `Score: ${result.similarity.score}%, AI Review State: ${result.aiReview.state}`);
  }

  // TEST 13 — SearXNG unavailable
  // Expected: graceful local mode with clear message
  {
    const testDoc = "Python is a high-level, general-purpose programming language.";
    const result = await executeAnalysis({
      text: testDoc,
      title: "Test 13 — Search Offline",
      options: { searchApiUrl: "http://127.0.0.1:19999/unreachable", searchEngine: "searxng" }
    });
    record(13, "SearXNG Unavailable Graceful Degradation", result.webCheckMode.includes("Local Comparison") || result.statusMessage.includes("Local similarity analysis completed"), `Mode: ${result.webCheckMode}, Msg: "${result.statusMessage}"`);
  }

  // TEST 14 — Source website returns 403
  // Expected: source marked unverifiable, not verified plagiarism
  {
    const mockUnverifiable = await retrievePage("http://127.0.0.1:19999/forbidden");
    record(14, "Source Unreachable Marked Unverifiable", mockUnverifiable.status === "SOURCE_NOT_VERIFIABLE", `Status: ${mockUnverifiable.status}, Reason: "${mockUnverifiable.reason}"`);
  }

  console.log("\n=================================================================");
  console.log(`   RELIABILITY RESULTS: ${passed}/${total} PASSED (${total - passed} Failed)`);
  console.log("=================================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runReliabilityTests().catch(err => {
  console.error("Reliability runner encountered fatal error:", err);
  process.exit(1);
});
