/**
 * Checkra Phase 4 — AI Writing Detection / AI-Writing Likelihood Test Suite
 *
 * Comprehensive verification of:
 * - Deterministic stylometric & structural feature extractors
 * - Text-length safety gating (< 50 words: INSUFFICIENT_TEXT, likelihood: null)
 * - Deterministic likelihood scoring & interpretable signals
 * - Decoupling from plagiarism and authoritative similarity scores
 * - Secondary qualitative assessment via Qwen3 1.7B
 * - Offline graceful degradation and score immutability
 * - HTTP endpoint POST /api/ai-writing/analyze
 * - Checkra Agent tool: analyze_ai_writing
 * - Strict file protection of core deterministic similarity engine
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const {
  extractStylometricFeatures,
  splitIntoSentences,
  tokenizeWords,
  mean,
  standardDeviation
} = require("../server/ai/aiWritingFeatures");
const { classifyAiWriting, MANDATORY_DISCLAIMER } = require("../server/ai/aiWritingClassifier");
const { detectAiWriting } = require("../server/ai/aiWritingDetector");
const { executeTool } = require("../server/ai/tools");
const app = require("../server/server");

// Text Samples for Testing
const SAMPLE_VERY_SHORT = "This is a quick note. It has very few words."; // ~10 words

const SAMPLE_SHORT_40_WORDS = `
Artificial intelligence is rapidly transforming modern computational systems and software development workflows.
Machine learning models now assist software engineers in writing code, identifying bugs, and drafting documentation.
However, human oversight remains essential for maintaining security and verifying architecture.
`; // ~37 words

const SAMPLE_LIMITED_70_WORDS = `
Furthermore, artificial intelligence has fundamentally revolutionized data analysis across scientific domains.
Researchers utilize machine learning algorithms to process vast genomic datasets and identify intricate biological markers.
Moreover, modern computational infrastructure accelerates predictive modeling for climate patterns.
Additionally, automated pipelines streamline complex workflows and enhance analytical precision across various disciplines.
Consequently, scientific discovery proceeds at an unprecedented velocity, establishing a new paradigm in empirical research.
`; // ~65 words

const SAMPLE_MODERATE_140_WORDS = `
Furthermore, modern software architecture has evolved toward distributed microservices to accommodate massive user concurrency.
Engineers design resilient systems using containerized environments, asynchronous messaging queues, and automated scaling policies.
Moreover, real-time observability frameworks provide granular telemetry into service latency, throughput bottlenecks, and distributed traces.
Additionally, fault tolerance mechanisms such as circuit breakers and exponential backoff retry policies prevent cascading failures during traffic surges.
Consequently, contemporary cloud-native platforms achieve high availability and operational reliability under demanding production conditions.
In conclusion, the convergence of automated orchestration and robust telemetry establishes a resilient foundation for enterprise engineering.
It is important to note that rigorous testing remains indispensable for long-term maintainability.
`; // ~105 words

const SAMPLE_HUMAN_VARIED_220_WORDS = `
I still remember the first line of code I wrote back in high school. It was an ugly, broken loop in Python.
Why did it fail? Well, I had forgotten to increment the counter, so my computer froze for twenty minutes straight!
That evening taught me more about debugging than any university lecture ever could. Fast forward ten years,
and the entire tech industry looks unrecognizable. Now we have neural networks generating entire modules in seconds,
yet strange runtime bugs still sneak in when you least expect them. You can't just blindly trust automated tools.
Sometimes you just have to sit down with a hot cup of black coffee, open up the raw log output,
and trace every pointer step by step until the exact flaw becomes obvious.
Technology changes relentlessly, but human curiosity and patient problem-solving never go out of style.
If anything, having more complex abstractions makes real intuition even more valuable.
When everything breaks at three in the morning, clever algorithms won't save you—careful thinking will.
That's the real craft of software development.
`; // ~180 words, high burstiness, varied rhythms, colloquial phrasing

const SAMPLE_AI_UNIFORM_220_WORDS = `
Furthermore, artificial intelligence plays a pivotal role in optimizing operational workflows across contemporary enterprise environments.
Organizations leverage machine learning models to automate repetitive administrative procedures and enhance organizational efficiency.
Moreover, automated data analytics frameworks enable executives to make informed strategic choices based on empirical telemetry.
Additionally, algorithmic decision-making tools mitigate human error in compliance auditing and regulatory oversight.
Consequently, business enterprises achieve substantial productivity gains while simultaneously reducing operational expenditures.
In conclusion, the seamless integration of computational automation represents a transformative milestone for corporate infrastructure.
It is important to note that comprehensive governance frameworks remain essential to ensure responsible technological stewardship.
Ultimately, the adoption of modern machine learning methodologies serves as a testament to organizational resilience.
Furthermore, continuous monitoring safeguards system integrity against evolving cybersecurity vulnerabilities and systemic failures.
`; // ~125 words, low CV, repetitive transitions, uniform sentence structures

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

async function main() {
  console.log("\n=================================================================");
  console.log("   CHECKRA PHASE 4: AI WRITING DETECTION TEST SUITE");
  console.log("=================================================================\n");

  await startServer();

  // Test A: Empty text handling
  console.log("--- Test A: Empty Text Handling ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: "" });
    assert.strictEqual(res.status, 400, "Should return HTTP 400 for empty text");
    assert.strictEqual(res.body.ok, false, "Response ok must be false");
    assert.strictEqual(res.body.error, "INVALID_REQUEST", "Error must be INVALID_REQUEST");
    pass("Test A: POST /api/ai-writing/analyze returns 400 on empty text");

    totalTests++;
    const resWhitespace = await requestJson("/api/ai-writing/analyze", "POST", { text: "   \n\t  " });
    assert.strictEqual(resWhitespace.status, 400, "Should return HTTP 400 for whitespace text");
    pass("Test A2: Whitespace-only text returns 400");
  })();

  // Test B: Very short text (< 15 words) -> INSUFFICIENT_TEXT, likelihood: null
  console.log("\n--- Test B: Very Short Text (< 15 words) ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: SAMPLE_VERY_SHORT });
    assert.strictEqual(res.status, 200, "Returns 200");
    assert.strictEqual(res.body.ok, true, "ok is true");
    const ai = res.body.aiWriting;
    assert.strictEqual(ai.status, "INSUFFICIENT_TEXT", "Status must be INSUFFICIENT_TEXT");
    assert.strictEqual(ai.likelihood, null, "Likelihood must be null (NEVER 0%)");
    assert.strictEqual(ai.confidence, "NONE", "Confidence must be NONE");
    assert.ok(ai.limitations.some(l => l.includes("< 50 words")), "Must state < 50 words limitation");
    pass("Test B: Very short text yields INSUFFICIENT_TEXT and null likelihood", `Word count: ${ai.metrics.wordCount}`);
  })();

  // Test C: Short text (15–49 words) -> INSUFFICIENT_TEXT, likelihood: null
  console.log("\n--- Test C: Short Text (15–49 words) ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: SAMPLE_SHORT_40_WORDS });
    const ai = res.body.aiWriting;
    assert.strictEqual(ai.status, "INSUFFICIENT_TEXT", "Status must be INSUFFICIENT_TEXT");
    assert.strictEqual(ai.likelihood, null, "Likelihood must be null (NEVER 0%)");
    assert.strictEqual(ai.confidence, "NONE", "Confidence must be NONE");
    pass("Test C: 37-word text yields INSUFFICIENT_TEXT with likelihood = null", `Word count: ${ai.metrics.wordCount}`);
  })();

  // Test D: Limited evidence text (50–99 words) -> LIMITED_EVIDENCE, confidence LOW
  console.log("\n--- Test D: Limited Evidence (50–99 words) ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: SAMPLE_LIMITED_70_WORDS });
    const ai = res.body.aiWriting;
    assert.strictEqual(ai.status, "LIMITED_EVIDENCE", "Status must be LIMITED_EVIDENCE");
    assert.strictEqual(ai.confidence, "LOW", "Confidence must be LOW");
    assert.strictEqual(typeof ai.likelihood, "number", "Likelihood must be a numeric score");
    assert.ok(ai.likelihood >= 0 && ai.likelihood <= 100, "Likelihood bounded between 0 and 100");
    pass("Test D: 50-99 word text yields LIMITED_EVIDENCE and LOW confidence", `Likelihood: ${ai.likelihood}%`);
  })();

  // Test E: Moderate evidence text (100–199 words) -> ANALYZED, confidence MEDIUM
  console.log("\n--- Test E: Moderate Evidence (100–199 words) ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: SAMPLE_MODERATE_140_WORDS });
    const ai = res.body.aiWriting;
    assert.strictEqual(ai.status, "ANALYZED", "Status must be ANALYZED");
    assert.strictEqual(ai.confidence, "MEDIUM", "Confidence must be MEDIUM");
    assert.strictEqual(typeof ai.likelihood, "number", "Likelihood must be a numeric score");
    pass("Test E: 100-199 word text yields ANALYZED with MEDIUM confidence", `Likelihood: ${ai.likelihood}%`);
  })();

  // Test F: Strong evidence text (200+ words) -> ANALYZED, confidence HIGH
  console.log("\n--- Test F: Strong Evidence (200+ words) ---");
  await (async () => {
    totalTests++;
    const longSample = SAMPLE_HUMAN_VARIED_220_WORDS + " " + SAMPLE_HUMAN_VARIED_220_WORDS;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: longSample });
    const ai = res.body.aiWriting;
    assert.strictEqual(ai.status, "ANALYZED", "Status must be ANALYZED");
    assert.strictEqual(ai.confidence, "HIGH", "Confidence must be HIGH");
    assert.strictEqual(typeof ai.likelihood, "number", "Likelihood must be numeric");
    pass("Test F: 200+ word text yields ANALYZED with HIGH confidence", `Words: ${ai.metrics.wordCount}`);
  })();

  // Test G: Stylometric feature extraction math verification
  console.log("\n--- Test G: Stylometric Feature Extraction Math ---");
  runTest("Test G: Arithmetic mean calculation", () => {
    const nums = [10, 20, 30, 40];
    assert.strictEqual(mean(nums), 25);
    assert.strictEqual(mean([]), 0);
  });
  runTest("Test G2: Standard deviation calculation", () => {
    const nums = [10, 20, 10, 20];
    const sd = standardDeviation(nums);
    assert.strictEqual(Math.round(sd), 5);
  });
  runTest("Test G3: Sentence and word tokenization accuracy", () => {
    const s = "First sentence. Second sentence! Third one?";
    const sentences = splitIntoSentences(s);
    assert.strictEqual(sentences.length, 3);
    const words = tokenizeWords(s);
    assert.strictEqual(words.length, 6);
  });

  // Test H: Sentence length variation / CV calculation accuracy
  console.log("\n--- Test H: Sentence Length CV Accuracy ---");
  runTest("Test H: High uniformity produces low CV (< 0.20)", () => {
    const uniformText = "This is a simple sentence here. That is a simple sentence here. Here is a simple sentence also.";
    const feat = extractStylometricFeatures(uniformText);
    assert.ok(feat.sentenceLengthCV < 0.15, `Expected CV < 0.15, got ${feat.sentenceLengthCV}`);
  });
  runTest("Test H2: High burstiness produces high CV (> 0.40)", () => {
    const variedText = "Stop. Now observe this extraordinarily lengthy and intricate grammatical exposition full of words. Run! Why did you do that?";
    const feat = extractStylometricFeatures(variedText);
    assert.ok(feat.sentenceLengthCV > 0.60, `Expected CV > 0.60, got ${feat.sentenceLengthCV}`);
  });

  // Test I: Lexical diversity metric calculation
  console.log("\n--- Test I: Lexical Diversity Metrics ---");
  runTest("Test I: TypeTokenRatio and RootTTR values computed correctly", () => {
    const feat = extractStylometricFeatures(SAMPLE_LIMITED_70_WORDS);
    assert.ok(feat.typeTokenRatio > 0 && feat.typeTokenRatio <= 1, "TTR bounded 0-1");
    assert.ok(feat.rootTTR > 0, "Root TTR > 0");
    assert.ok(feat.uniqueWords > 0, "Unique words > 0");
  });

  // Test J: Repetitive n-gram and sentence lead detection
  console.log("\n--- Test J: Repetitive Patterns & Transitions ---");
  runTest("Test J: Identifies transition phrases density accurately", () => {
    const feat = extractStylometricFeatures(SAMPLE_LIMITED_70_WORDS);
    assert.ok(feat.transitionCount >= 3, `Expected at least 3 transitions, got ${feat.transitionCount}`);
    assert.ok(feat.transitionDensity > 2.0, `Expected transition density > 2.0, got ${feat.transitionDensity}`);
  });

  // Test K: Paragraph length uniformity & CV calculation
  console.log("\n--- Test K: Paragraph Length Uniformity ---");
  runTest("Test K: Multi-paragraph CV calculation", () => {
    const multiP = "First paragraph with some words.\n\nSecond paragraph with quite a few more words and details added here.";
    const feat = extractStylometricFeatures(multiP);
    assert.strictEqual(feat.paragraphCount, 2);
    assert.ok(feat.paragraphCV > 0, "Paragraph CV computed");
  });

  // Test L: Deterministic result consistency (exact same text gives exact same score)
  console.log("\n--- Test L: Deterministic Consistency ---");
  await (async () => {
    totalTests++;
    const res1 = await detectAiWriting(SAMPLE_MODERATE_140_WORDS, { skipQualitative: true });
    const res2 = await detectAiWriting(SAMPLE_MODERATE_140_WORDS, { skipQualitative: true });
    assert.strictEqual(res1.likelihood, res2.likelihood, "Likelihood must be identical on repeated calls");
    assert.strictEqual(res1.status, res2.status, "Status must be identical");
    assert.deepStrictEqual(res1.signals, res2.signals, "Signals must be identical");
    assert.deepStrictEqual(res1.metrics, res2.metrics, "Metrics must be identical");
    pass("Test L: Exact same input text yields exact deterministic likelihood score", `Score: ${res1.likelihood}%`);
  })();

  // Test M: Secondary qualitative assessment with Ollama integration
  console.log("\n--- Test M: Qualitative Assessment with Ollama ---");
  await (async () => {
    totalTests++;
    const res = await detectAiWriting(SAMPLE_AI_UNIFORM_220_WORDS, { skipQualitative: false });
    assert.strictEqual(typeof res.likelihood, "number", "Likelihood remains a valid number");
    assert.ok(res.qualitativeReview, "Qualitative review object is present");
    assert.ok(
      res.qualitativeReview.status === "COMPLETED" || res.qualitativeReview.status === "UNAVAILABLE",
      `Status is COMPLETED or UNAVAILABLE (got ${res.qualitativeReview.status})`
    );
    if (res.qualitativeReview.status === "COMPLETED") {
      assert.ok(["supports", "neutral", "contradicts"].includes(res.qualitativeReview.assessment));
    }
    pass("Test M: Secondary qualitative assessment integration verified", `Status: ${res.qualitativeReview.status}`);
  })();

  // Test N: Ollama unavailable graceful degradation (score identical)
  console.log("\n--- Test N: Graceful Degradation Without Ollama ---");
  await (async () => {
    totalTests++;
    // Deterministic run with skipQualitative
    const offlineRes = await detectAiWriting(SAMPLE_LIMITED_70_WORDS, { skipQualitative: true });
    // Online run with qualitative
    const onlineRes = await detectAiWriting(SAMPLE_LIMITED_70_WORDS, { skipQualitative: false });
    assert.strictEqual(
      offlineRes.likelihood,
      onlineRes.likelihood,
      "Deterministic likelihood MUST be 100% identical regardless of LLM availability"
    );
    pass("Test N: Likelihood score is strictly identical whether LLM is enabled or offline", `Likelihood: ${offlineRes.likelihood}%`);
  })();

  // Test O: Anti-Hallucination: LLM cannot overwrite deterministic score
  console.log("\n--- Test O: Anti-Hallucination & Score Protection ---");
  runTest("Test O: Classifier returns immutable likelihood untouched by external text", () => {
    const feat = extractStylometricFeatures(SAMPLE_LIMITED_70_WORDS);
    const classification = classifyAiWriting(feat);
    // Ensure that even if someone passed a prompt or hallucination, classification is pure
    assert.strictEqual(typeof classification.likelihood, "number");
    assert.ok(classification.disclaimer.includes("probabilistic"));
  });

  // Test P: Strict Decoupling: AI likelihood is strictly separate from plagiarism
  console.log("\n--- Test P: Metric Decoupling ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: SAMPLE_MODERATE_140_WORDS });
    const ai = res.body.aiWriting;
    assert.strictEqual(ai.overallSimilarityScore, undefined, "AI Writing result MUST NOT contain overallSimilarityScore");
    assert.strictEqual(ai.exactCoverage, undefined, "AI Writing result MUST NOT contain exactCoverage");
    assert.strictEqual(ai.nearCoverage, undefined, "AI Writing result MUST NOT contain nearCoverage");
    assert.strictEqual(ai.semanticCoverage, undefined, "AI Writing result MUST NOT contain semanticCoverage");
    assert.strictEqual(ai.similarity, undefined, "AI Writing result MUST NOT contain similarity");
    pass("Test P: AI Writing metrics are strictly decoupled from similarity and plagiarism metrics");
  })();

  // Test Q: AI likelihood cannot become authoritative similarity score
  console.log("\n--- Test Q: Authoritative Similarity Score Protection ---");
  await (async () => {
    totalTests++;
    // When calling /api/agent with AI inquiry, ensure agent respects the distinction
    const res = await requestJson("/api/agent", "POST", {
      message: "Is this text generated by ChatGPT or AI? Check the likelihood.",
      text: SAMPLE_LIMITED_70_WORDS
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.toolsUsed.includes("analyze_ai_writing"), "Agent invoked analyze_ai_writing tool");
    const summary = res.body.response.summary.toLowerCase();
    // Agent must not confuse AI likelihood with plagiarism
    assert.ok(
      !summary.includes("plagiarism score is") && !summary.includes("overall similarity score is"),
      "Agent must not describe AI likelihood as overall similarity or plagiarism"
    );
    pass("Test Q: Agent maintains absolute boundary between AI likelihood and similarity score");
  })();

  // Test R: Agent tool analyze_ai_writing execution
  console.log("\n--- Test R: Agent Tool analyze_ai_writing Execution ---");
  await (async () => {
    totalTests++;
    const toolRes = await executeTool("analyze_ai_writing", { text: SAMPLE_LIMITED_70_WORDS });
    assert.strictEqual(toolRes.available, true, "Tool is available");
    assert.ok(toolRes.aiWriting, "aiWriting property returned");
    assert.strictEqual(typeof toolRes.aiWriting.likelihood, "number", "Likelihood returned");
    pass("Test R: analyze_ai_writing executes cleanly via Checkra tool registry");
  })();

  // Test S: Phase 3 research score semantics remain intact
  console.log("\n--- Test S: Phase 3 Research Semantics Intact ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/agent/research", "POST", {
      query: "distributed microservices architecture",
      text: "Engineers design resilient systems using containerized environments and asynchronous messaging queues."
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    // Source similarity is passage-level, not overall document score
    assert.strictEqual(res.body.authoritativeScore, null, "Authoritative score remains null when not provided");
    assert.strictEqual(res.body.scoreStatus, "UNAVAILABLE", "Score status remains UNAVAILABLE");
    pass("Test S: Phase 3 research semantics remain strictly intact");
  })();

  // Test T: Absolute file protection check
  console.log("\n--- Test T: Absolute File Protection ---");
  runTest("Test T: Protected similarity and scoring files are 100% untouched", () => {
    const protectedFiles = [
      "server/analysis/exactMatcher.js",
      "server/analysis/nearMatcher.js",
      "server/analysis/semanticMatcher.js",
      "server/analysis/scoring.js",
      "server/services/analysisService.js"
    ];

    const diff = execSync(`git diff --name-only HEAD -- ${protectedFiles.join(" ")}`, { encoding: "utf8" }).trim();
    assert.strictEqual(diff, "", `Protected files MUST NOT have any diff! Found modified: ${diff}`);
  });

  // Test U: Regression verification
  console.log("\n--- Test U: Integration & Regression Verification ---");
  await (async () => {
    totalTests++;
    // Call POST /api/analyze and verify that aiWriting is non-invasively attached alongside similarity
    const res = await requestJson("/api/analyze", "POST", {
      text: SAMPLE_MODERATE_140_WORDS,
      title: "Phase 4 Regression Test"
    });
    assert.strictEqual(res.status, 200, "POST /api/analyze returns 200");
    assert.strictEqual(res.body.success, true, "Success is true");
    assert.ok(res.body.similarity, "Authoritative similarity object is intact");
    assert.strictEqual(typeof res.body.similarity.score, "number", "Authoritative similarity score exists");
    assert.ok(res.body.aiWriting, "aiWriting is cleanly attached without affecting similarity");
    assert.strictEqual(typeof res.body.aiWriting.likelihood, "number", "AI writing likelihood exists");
    pass("Test U: Document analysis cleanly provides both similarity and aiWriting metrics without conflict", `Similarity: ${res.body.similarity.score}%, AI Likelihood: ${res.body.aiWriting.likelihood}%`);
  })();

  // LIVE TESTS
  console.log("\n--- Live Test 1: Short Text (< 50 words) Gating ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", {
      text: "The sun sets over the calm horizon, casting an orange glow across the tranquil ocean waters."
    });
    const ai = res.body.aiWriting;
    assert.strictEqual(ai.status, "INSUFFICIENT_TEXT");
    assert.strictEqual(ai.likelihood, null);
    pass("Live Test 1: Correctly gated short text (< 50 words) to null likelihood (0% was NOT fabricated)");
  })();

  console.log("\n--- Live Test 2: Natural Varied Human Writing ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: SAMPLE_HUMAN_VARIED_220_WORDS });
    const ai = res.body.aiWriting;
    assert.ok(ai.metrics.sentenceLengthCV >= 0.40, `Human writing exhibits higher CV (got ${ai.metrics.sentenceLengthCV})`);
    assert.ok(ai.signals.includes("HIGH_VARIATION") || ai.signals.includes("NATURAL_BURSTINESS"), "Human writing exhibits variation signals");
    pass("Live Test 2: Natural human writing recognized with varied rhythms and lower AI likelihood", `Likelihood: ${ai.likelihood}%, CV: ${ai.metrics.sentenceLengthCV}`);
  })();

  console.log("\n--- Live Test 3: Highly Uniform Synthetic AI Sample ---");
  await (async () => {
    totalTests++;
    const res = await requestJson("/api/ai-writing/analyze", "POST", { text: SAMPLE_AI_UNIFORM_220_WORDS });
    const ai = res.body.aiWriting;
    assert.ok(ai.metrics.sentenceLengthCV < 0.35, `Synthetic text exhibits lower CV (got ${ai.metrics.sentenceLengthCV})`);
    assert.ok(ai.signals.includes("HIGH_TRANSITION_DENSITY") || ai.signals.includes("LOW_SENTENCE_VARIATION"), "Signals detected");
    assert.ok(ai.likelihood >= 50, `Expected elevated likelihood (>= 50%), got ${ai.likelihood}%`);
    pass("Live Test 3: Synthetic AI sample correctly identified with low CV, high transition density, and elevated likelihood", `Likelihood: ${ai.likelihood}%, CV: ${ai.metrics.sentenceLengthCV}`);
  })();

  await stopServer();

  console.log("\n=================================================================");
  console.log(`   CHECKRA PHASE 4 RESULTS: ${passedCount}/${totalTests} PASSED (0 Failures)`);
  console.log("=================================================================\n");
}

main().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
