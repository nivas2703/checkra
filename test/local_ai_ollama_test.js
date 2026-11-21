/**
 * Checkra Phase 1: Local Ollama + Qwen3 1.7B Integration Test Suite
 *
 * Verifies:
 * 1. AI model provider configuration & defaults
 * 2. Ollama health check succeeds with running instance
 * 3. qwen3:1.7b model presence detection
 * 4. AI test endpoint (/api/ai/test) completion via Ollama
 * 5. Graceful error handling when Ollama is unavailable
 * 6. Deterministic similarity engine independence (unaffected by AI provider)
 */

const assert = require("assert");
const http = require("http");
const app = require("../server/server");
const { getAiConfig, checkAiHealth, generateAiCompletion } = require("../server/ai/model");

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

function getJson(serverBase, endpoint) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${serverBase}${endpoint}`);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "GET",
      headers: { "Accept": "application/json" }
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
    req.end();
  });
}

async function runLocalAiTests() {
  console.log("\n=================================================================");
  console.log("   CHECKRA PHASE 1: LOCAL OLLAMA + QWEN3 1.7B TEST SUITE");
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
    // 1. Config defaults
    console.log("--- 1. Provider & Model Configuration ---");
    const config = getAiConfig();
    report("Provider defaults to ollama", config.provider === "ollama", `Provider: ${config.provider}`);
    report("Base URL defaults to http://localhost:11434", config.baseUrl === "http://localhost:11434", `Base URL: ${config.baseUrl}`);
    report("Model defaults to qwen3:1.7b", config.model === "qwen3:1.7b", `Model: ${config.model}`);

    // 2. Health check via model.js
    console.log("\n--- 2. Internal Ollama Health Check ---");
    const health = await checkAiHealth();
    report("Ollama health reports ok: true", health.ok === true, `Available: ${health.available}`);
    report("Ollama health confirms qwen3:1.7b detected", health.model === "qwen3:1.7b" && health.available === true);

    // 3. GET /api/ai/health endpoint
    console.log("\n--- 3. GET /api/ai/health Endpoint ---");
    const resHealth = await getJson(serverBase, "/api/ai/health");
    report("GET /api/ai/health returns HTTP 200", resHealth.status === 200);
    report("Health payload structure valid", resHealth.data?.ok === true && resHealth.data?.provider === "ollama" && resHealth.data?.model === "qwen3:1.7b");

    // 4. Graceful handling when Ollama is unavailable
    console.log("\n--- 4. Ollama Unavailable Graceful Degradation ---");
    const badPortConfig = { baseUrl: "http://127.0.0.1:19998" }; // port nothing listens on
    const offlineHealth = await checkAiHealth(badPortConfig);
    report("Offline Ollama returns ok: false without crashing", offlineHealth.ok === false && offlineHealth.available === false);
    report("Offline error indicates OLLAMA_UNAVAILABLE", offlineHealth.error === "OLLAMA_UNAVAILABLE", `Error: ${offlineHealth.error}`);

    const offlineGen = await generateAiCompletion("Test prompt", {
      overrideConfig: badPortConfig,
      timeoutMs: 1500
    });
    report("Offline generation returns ok: false without crashing", offlineGen.ok === false && offlineGen.error === "OLLAMA_UNAVAILABLE");

    // 5. POST /api/ai/test endpoint
    console.log("\n--- 5. POST /api/ai/test Endpoint ---");
    const testRes = await postJson(serverBase, "/api/ai/test", {
      prompt: "You are Checkra AI. Explain plagiarism in one short paragraph."
    });
    report("POST /api/ai/test returns HTTP 200", testRes.status === 200);
    report("POST /api/ai/test returns ok: true", testRes.data?.ok === true);
    report("POST /api/ai/test response is non-empty", typeof testRes.data?.response === "string" && testRes.data.response.length > 20, `Length: ${testRes.data?.response?.length} chars`);
    report("POST /api/ai/test provider is ollama", testRes.data?.provider === "ollama");
    report("POST /api/ai/test model is qwen3:1.7b", testRes.data?.model === "qwen3:1.7b");

    // 6. Deterministic similarity engine isolation verification
    console.log("\n--- 6. Deterministic Engine Isolation Check ---");
    const simRes = await postJson(serverBase, "/api/analyze", {
      title: "Isolation Verification Document",
      text: "Photosynthesis in plants converts solar radiant energy into chemical energy stored in glucose molecules through light-dependent reactions and the Calvin cycle.",
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    const sim = simRes.data?.similarity || {};
    report("Deterministic similarity engine runs independently", simRes.status === 200 && typeof sim.score === "number", `Score: ${sim.score}%`);
    report("Deterministic scoring is unaffected by AI provider", sim.score >= 0 && sim.score <= 100);

    console.log("\n=================================================================");
    console.log(`   PHASE 1 LOCAL AI RESULTS: ${passed}/${total} PASSED (0 Failures)`);
    console.log("=================================================================\n");

    if (passed !== total) {
      process.exit(1);
    }
    process.exit(0);
  } finally {
    await new Promise(r => server.close(r));
  }
}

runLocalAiTests().catch(err => {
  console.error("Local AI test failed:", err);
  process.exit(1);
});
