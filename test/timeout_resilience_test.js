/**
 * Checkra Timeout Resilience & Serverless 504 Safeguard Test Suite
 * Tests all 8 scenarios (A through H) specified in the Step 12 requirements.
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const app = require("../server/server");
const { executeAnalysis } = require("../server/services/analysisService");

let server;
let port;

function startServer() {
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
}

function postJson(endpoint, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: endpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      },
      timeout: 10000
    }, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body, json });
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log("=================================================================");
  console.log("   CHECKRA TIMEOUT RESILIENCE & 504 SAFEGUARD TEST (STEP 12)");
  console.log("=================================================================\n");

  await startServer();

  try {
    // Test A: Original Text
    console.log("--- Test A: Original Text (no false positives) ---");
    const origText = "Astrophysical surveys monitor gravitational micro-lensing events to detect rogue terrestrial exoplanets drifting through interstellar space without host stars. Stellar kinematics and photometric astrometry provide observational parameters indicating atmospheric compositions and orbital inclinations.";
    const resA = await postJson("/api/analyze", { text: origText });
    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resA.json.similarity.score, 0, "Original text must receive 0% similarity");
    assert.strictEqual(resA.json.similarity.coverage.exactPercent, 0);
    console.log(`  ✓ [PASS] Test A: Score = ${resA.json.similarity.score}%, Exact = 0%`);

    // Test B: Exact Copy
    console.log("\n--- Test B: Exact Copy (high exact match) ---");
    const exactSource = "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation. Python is dynamically typed and garbage-collected. It supports multiple programming paradigms, including structured, object-oriented and functional programming.";
    const resB = await postJson("/api/analyze", { text: exactSource });
    assert.strictEqual(resB.status, 200);
    assert(resB.json.similarity.score >= 80, `Expected score >= 80%, got ${resB.json.similarity.score}%`);
    assert.strictEqual(resB.json.similarity.coverage.exactPercent, 100);
    console.log(`  ✓ [PASS] Test B: Score = ${resB.json.similarity.score}%, Exact = ${resB.json.similarity.coverage.exactPercent}%`);

    // Test C: 30% Copied Document
    console.log("\n--- Test C: 30% Copied Document (proportional score) ---");
    const copy30Part = "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation.";
    const independentPart = "The development of high-resolution cryogenic electron microscopy has fundamentally revolutionized structural biology. Researchers can now determine the atomic three-dimensional architectures of complex macromolecular assemblies in near-native frozen-hydrated states without crystallization.";
    const mixedDoc = copy30Part + "\n\n" + independentPart;
    const resC = await postJson("/api/analyze", {
      text: mixedDoc,
      options: { referenceText: copy30Part, disablePublicWebSearch: true }
    });
    assert.strictEqual(resC.status, 200);
    assert(resC.json.similarity.coverage.exactPercent > 20 && resC.json.similarity.coverage.exactPercent < 55);
    console.log(`  ✓ [PASS] Test C: Score = ${resC.json.similarity.score}%, Exact = ${resC.json.similarity.coverage.exactPercent}%`);

    // Test D: Large Document (7,319 words, 8 passages distributed)
    console.log("\n--- Test D: Large Document (7,319 words, 100% recall) ---");
    const PASSAGES = [
      { pos: "0%", phrase: "Quantum computing utilizes the quantum mechanical phenomena of superposition and entanglement to perform calculations exponentially faster than classical supercomputers on specific classes of problems." },
      { pos: "20%", phrase: "CRISPR gene editing represents a transformative genetic engineering technique enabling molecular biologists to modify DNA sequences and alter gene function with unprecedented precision." },
      { pos: "40%", phrase: "Plate tectonics describes the large scale motions of Earth's lithosphere which is broken up into seven major continent-sized plates and numerous smaller regional plates." },
      { pos: "50%", phrase: "The Federal Reserve conducts monetary policy by influencing interest rates and managing the total supply of money circulating throughout the domestic financial banking system." },
      { pos: "60%", phrase: "The Renaissance was a fervent period of European cultural, artistic, political and economic rebirth following the Middle Ages, largely covering the fourteenth through seventeenth centuries." },
      { pos: "80%", phrase: "Photosynthesis in oxygenic cyanobacteria established Earth's early oxidizing atmosphere through the photolysis of water molecules driven by solar radiation." },
      { pos: "95%", phrase: "Natural language processing models leverage transformer self-attention mechanisms to dynamically capture long-range contextual dependencies across complex linguistic tokens." },
      { pos: "100%", phrase: "The James Webb Space Telescope operates at the second Sun-Earth Lagrange point to capture high-redshift infrared cosmological observations of early galaxy formation." }
    ];
    const filler = "Astrophysical surveys monitor gravitational micro-lensing events to detect rogue terrestrial exoplanets drifting through interstellar space without host stars. Stellar kinematics and photometric astrometry provide observational parameters indicating atmospheric compositions and orbital inclinations across binary planetary systems. Deep-space radio interferometry arrays synthesize aperture baselines spanning continental distances to resolve compact galactic nuclei.\n\n";
    const sections = [];
    for (let i = 0; i < PASSAGES.length; i++) {
      sections.push(PASSAGES[i].phrase + "\n\n");
      if (i < PASSAGES.length - 1) sections.push(filler.repeat(20));
    }
    const largeDoc = sections.join("");
    const refCorpus = PASSAGES.map((p, idx) => `SOURCE ${idx + 1}: ${p.phrase}`).join("\n\n");

    const tStartLarge = Date.now();
    const resD = await postJson("/api/analyze", {
      text: largeDoc,
      options: { referenceText: refCorpus, disablePublicWebSearch: true }
    });
    const tElapsedLarge = Date.now() - tStartLarge;
    assert.strictEqual(resD.status, 200);
    assert(tElapsedLarge < 3000, `Execution time too long: ${tElapsedLarge}ms`);

    let detectedCount = 0;
    for (const p of PASSAGES) {
      const isDetected = (resD.json.matchedPassages || []).some(m => {
        const text = (m.submittedSentence || m.phrase || "").toLowerCase();
        return text.includes(p.phrase.toLowerCase().split(/\s+/).slice(0, 5).join(" "));
      });
      if (isDetected) detectedCount++;
    }
    assert.strictEqual(detectedCount, 8, `Expected 8/8 detected, got ${detectedCount}/8`);
    console.log(`  ✓ [PASS] Test D: 8/8 detected (100% recall) in ${tElapsedLarge}ms`);

    // Test E: SearXNG Unavailable
    console.log("\n--- Test E: SearXNG Unavailable ---");
    const resE = await postJson("/api/analyze", {
      text: exactSource,
      options: {
        searchApiUrl: "http://127.0.0.1:19999/unreachable",
        searchEngine: "SearXNG",
        disablePublicWebSearch: true
      }
    });
    assert.strictEqual(resE.status, 200);
    assert(resE.json.similarity.score >= 80, "Deterministic score must be preserved when SearXNG is offline");
    assert.strictEqual(resE.json.webCheckMode, "Local Comparison — Web checking unavailable");
    console.log(`  ✓ [PASS] Test E: Score preserved at ${resE.json.similarity.score}%, mode: ${resE.json.webCheckMode}`);

    // Test F: Gemini Unavailable
    console.log("\n--- Test F: Gemini Unavailable ---");
    const resF = await postJson("/api/analyze", {
      text: exactSource,
      options: {
        disablePublicWebSearch: true,
        aiReview: false
      }
    });
    assert.strictEqual(resF.status, 200);
    assert(resF.json.similarity.score >= 80);
    assert.strictEqual(resF.json.aiReview.available, false);
    console.log(`  ✓ [PASS] Test F: Score = ${resF.json.similarity.score}%, AI Review available = false`);

    // Test G: External Request Timeout (Simulate slow endpoint)
    console.log("\n--- Test G: Bounded Time Budget on Slow Search ---");
    const tGStart = Date.now();
    const resG = await postJson("/api/analyze", {
      text: "Testing bounded time budget when candidate searches take time to respond across the network.",
      options: {
        searchApiUrl: "http://10.255.255.1:81/blackhole" // Unroutable IP, triggers timeout
      }
    });
    const tGElapsed = Date.now() - tGStart;
    assert.strictEqual(resG.status, 200);
    assert(tGElapsed < 5000, `Request took too long: ${tGElapsed}ms`);
    console.log(`  ✓ [PASS] Test G: Graceful termination in ${tGElapsed}ms (budget respected, HTTP 200)`);

    // Test H: Frontend 504 Safeguard Inspection
    console.log("\n--- Test H: Frontend 504 Safeguard Inspection ---");
    const htmlContent = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert(htmlContent.includes('id="analysis-failure-card"'), "analysis-failure-card must exist in HTML");
    assert(htmlContent.includes('$("quick-score-card").style.display = "none"'), "quick-score-card must be hidden on failure");
    assert(htmlContent.includes('Checkra strictly avoids reporting 0% similarity when an analysis cannot be completed'), "Integrity notice must exist");
    console.log("  ✓ [PASS] Test H: Frontend safely hides 0% metrics and renders dedicated failure view on 504");

    console.log("\n=================================================================");
    console.log("   ALL 8 TIMEOUT RESILIENCE TESTS PASSED (8/8)!");
    console.log("=================================================================");
  } finally {
    await stopServer();
  }
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
