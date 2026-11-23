/**
 * CHECKRA AI REVIEW BUTTON REGRESSION & LIFECYCLE TEST SUITE
 * Verifies:
 * 1. Button existence & handler definition in public/index.html
 * 2. API client retryAiReview method definition
 * 3. State tracking (isReviewingAi) & mutual exclusion of overlapping clicks
 * 4. Graceful handling of expired/missing sessions
 * 5. Display of loading states during execution
 * 6. Update of AI review section upon successful response
 * 7. Clear display of actual errors upon failed response (no false success/fabrication)
 * 8. Live HTTP integration with backend POST /api/analysis/:id/retry-ai-review
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const app = require("../server/server");
const db = require("../server/db/database");

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

function req(method, pathUrl, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
    const reqHeaders = { "x-test-bypass": "1" };
    if (postData) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(postData);
    }
    const r = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathUrl,
      method,
      headers: reqHeaders,
      timeout: 10000
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    r.on("error", reject);
    if (postData) r.write(postData);
    r.end();
  });
}

async function run() {
  console.log("=================================================================");
  console.log("   CHECKRA AI REVIEW BUTTON DEFECT REGRESSION TEST SUITE");
  console.log("=================================================================\n");

  const htmlPath = path.join(__dirname, "../public/index.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf8");

  // =================================================================
  // 1. STATIC CODE & ARCHITECTURE AUDIT
  // =================================================================
  console.log("--- 1. Static Audit of Frontend Code in public/index.html ---");

  // A. Button exists with onclick="retryAiReview()"
  const hasButton = htmlContent.includes('onclick="retryAiReview()"');
  assert.strictEqual(hasButton, true, "Button with onclick='retryAiReview()' must exist in HTML");
  console.log("  ✓ [PASS] 'Run AI Review' button exists with onclick='retryAiReview()'");

  // B. Button has id="btn-run-ai-review"
  const hasButtonId = htmlContent.includes('id="btn-run-ai-review"');
  assert.strictEqual(hasButtonId, true, "Button should have id='btn-run-ai-review'");
  console.log("  ✓ [PASS] Button has explicit id='btn-run-ai-review'");

  // C. Script contains function retryAiReview definition
  const hasFnDef = /async\s+function\s+retryAiReview\s*\(\s*\)/.test(htmlContent);
  assert.strictEqual(hasFnDef, true, "async function retryAiReview() must be defined");
  console.log("  ✓ [PASS] async function retryAiReview() is defined in frontend script");

  // D. API client contains retryAiReview method
  const hasApiMethod = /retryAiReview\s*\(\s*id\s*\)/.test(htmlContent);
  assert.strictEqual(hasApiMethod, true, "api.retryAiReview(id) must be defined in API client");
  console.log("  ✓ [PASS] api.retryAiReview(id) is defined in API client");

  // E. State tracking flag isReviewingAi exists
  const hasStateFlag = htmlContent.includes("isReviewingAi");
  assert.strictEqual(hasStateFlag, true, "state.isReviewingAi must exist to prevent overlapping calls");
  console.log("  ✓ [PASS] state.isReviewingAi flag exists for concurrency protection");

  // F. Public script syntax compiles cleanly
  const scriptMatch = htmlContent.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, "Script tag must exist in index.html");
  assert.doesNotThrow(() => {
    new vm.Script(scriptMatch[1]);
  }, "public/index.html script must compile without syntax errors");
  console.log("  ✓ [PASS] Complete index.html client script compiles with 0 syntax errors");

  // =================================================================
  // 2. BEHAVIORAL CLIENT SIMULATION & LIFECYCLE
  // =================================================================
  console.log("\n--- 2. Behavioral Client State & Lifecycle Verification ---");

  // Setup mock DOM elements and context
  function createTestContext() {
    const elements = {
      "btn-run-ai-review": { disabled: false, innerHTML: "<span>✨</span> Run AI Review", textContent: "Run AI Review" },
      "m-gemini": { textContent: "Initial AI status text" },
      "m-gemini-header": { innerHTML: "<span>✨</span> Core analysis completed" },
      "quick-score-card": { style: { display: "none" } },
      "awaiting-analysis-card": { style: { display: "block" } },
      "analysis-failure-card": { style: { display: "none" } },
      "doc-title": { value: "Test Title" },
      "stat-words": { textContent: "100" }
    };

    const alerts = [];
    const context = {
      document: {
        getElementById: (id) => elements[id] || null,
        querySelector: (sel) => {
          if (sel.includes("btn-run-ai-review") || sel.includes("retryAiReview")) return elements["btn-run-ai-review"];
          if (sel.includes("ai-status-header")) return elements["m-gemini-header"];
          return null;
        },
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {}
      },
      window: {
        location: { origin: "https://checkra-xi.vercel.app" },
        addEventListener: () => {},
        removeEventListener: () => {}
      },
      alert: (msg) => { alerts.push(msg); },
      console: { log: () => {}, warn: () => {}, error: () => {} },
      fetch: async () => { throw new Error("Mock fetch not configured"); },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      elements,
      alerts
    };

    vm.createContext(context);
    // Execute the index.html script in this mock environment
    vm.runInContext(scriptMatch[1], context);

    const state = vm.runInContext("state", context);
    const api = vm.runInContext("api", context);
    const retryAiReview = vm.runInContext("retryAiReview", context);

    return { context, state, api, retryAiReview, elements, alerts };
  }

  // Test Case A: Missing or expired session handling
  {
    const ctx = createTestContext();
    ctx.state.currentAnalysis = null; // No active analysis
    await ctx.retryAiReview();

    assert.ok(ctx.alerts.length >= 1, "Alert must be triggered when session is missing");
    assert.ok(ctx.alerts[0].includes("expired") || ctx.alerts[0].includes("Check Document again"), "Alert message must instruct user to run Check Document again");
    assert.ok(ctx.elements["m-gemini"].textContent.includes("expired") || ctx.elements["m-gemini"].textContent.includes("Check Document again"), "m-gemini must show session expired notice");
    assert.strictEqual(ctx.elements["btn-run-ai-review"].disabled, false, "Button must not remain disabled");
    console.log("  ✓ [PASS] Missing session handled gracefully: prompts user to run Check Document again");
  }

  // Test Case B: Successful AI review response flow
  {
    const ctx = createTestContext();
    const testAnalysisId = "VW-2026-TEST-AI-SUCCESS";
    ctx.state.currentAnalysis = {
      analysisId: testAnalysisId,
      similarity: { score: 12 },
      aiReview: { available: false, message: "Temporarily unavailable" }
    };

    let fetchCalled = 0;
    ctx.api.retryAiReview = async (id) => {
      fetchCalled++;
      assert.strictEqual(id, testAnalysisId, "Must pass the correct current analysis ID");
      // Simulate network latency
      await new Promise(r => setTimeout(r, 20));
      return {
        success: true,
        aiReview: {
          status: "SUCCESS",
          state: "COMPLETED",
          available: true,
          retryable: false,
          summary: "AI Evidence Review completed: 4 passages verified with authentic sources.",
          items: []
        }
      };
    };

    const reviewPromise = ctx.retryAiReview();

    // Verify loading state while in-flight
    assert.strictEqual(ctx.state.isReviewingAi, true, "isReviewingAi must be true while in-flight");
    assert.strictEqual(ctx.elements["btn-run-ai-review"].disabled, true, "Button must be disabled during request");
    assert.ok(ctx.elements["btn-run-ai-review"].innerHTML.includes("Reviewing"), "Button must show reviewing loading state");
    assert.ok(ctx.elements["m-gemini"].textContent.includes("Requesting"), "m-gemini must show requesting status");

    // Verify overlapping click prevention
    await ctx.retryAiReview(); // Second call while first is in flight
    assert.strictEqual(fetchCalled, 1, "Repeated click must not trigger overlapping request");

    // Await completion
    await reviewPromise;

    assert.strictEqual(ctx.state.isReviewingAi, false, "isReviewingAi must be false after completion");
    assert.strictEqual(ctx.elements["btn-run-ai-review"].disabled, false, "Button must be re-enabled after completion");
    assert.strictEqual(ctx.elements["m-gemini"].textContent, "AI Evidence Review completed: 4 passages verified with authentic sources.");
    assert.strictEqual(ctx.state.currentAnalysis.aiReview.status, "SUCCESS");
    console.log("  ✓ [PASS] Successful flow: loading state shown, overlapping clicks blocked, AI Review section updated");
  }

  // Test Case C: Failed API response (Gemini high demand / quota exceeded)
  {
    const ctx = createTestContext();
    const testAnalysisId = "VW-2026-TEST-AI-FAILURE";
    ctx.state.currentAnalysis = {
      analysisId: testAnalysisId,
      aiReview: { available: false }
    };

    const actualErrorMessage = "Gemini is currently experiencing high demand. Your similarity analysis remains fully valid.";
    ctx.api.retryAiReview = async () => {
      return {
        success: false,
        error: { code: "RETRY_FAILED", message: actualErrorMessage },
        aiReview: {
          status: "UNAVAILABLE",
          available: false,
          retryable: true,
          message: actualErrorMessage
        }
      };
    };

    await ctx.retryAiReview();

    assert.strictEqual(ctx.elements["btn-run-ai-review"].disabled, false, "Button must be re-enabled after failure");
    assert.strictEqual(ctx.elements["m-gemini"].textContent, actualErrorMessage, "m-gemini must display actual error message clearly");
    assert.strictEqual(ctx.alerts.length >= 1, true, "Alert notice must be shown to user");
    assert.ok(ctx.alerts[0].includes(actualErrorMessage), "Alert must contain actual error message");
    console.log("  ✓ [PASS] Failure flow: displays actual error message clearly without fabricating results");
  }

  // Test Case D: Backend returns 404 SESSION_EXPIRED
  {
    const ctx = createTestContext();
    ctx.state.currentAnalysis = { analysisId: "VW-2026-EXPIRED" };

    ctx.api.retryAiReview = async () => {
      return {
        success: false,
        error: { code: "SESSION_EXPIRED", message: "Analysis session expired. Please re-run document check." }
      };
    };

    await ctx.retryAiReview();

    assert.ok(ctx.elements["m-gemini"].textContent.includes("expired") || ctx.elements["m-gemini"].textContent.includes("Check Document again"));
    assert.ok(ctx.alerts[0].includes("expired") || ctx.alerts[0].includes("Check Document again"));
    assert.strictEqual(ctx.elements["btn-run-ai-review"].disabled, false);
    console.log("  ✓ [PASS] Backend SESSION_EXPIRED error handled gracefully with instructions to run check again");
  }

  // Test Case E: Network error / exception handling
  {
    const ctx = createTestContext();
    ctx.state.currentAnalysis = { analysisId: "VW-2026-NET-ERR" };

    ctx.api.retryAiReview = async () => {
      throw new Error("Network timeout (HTTP 504)");
    };

    await ctx.retryAiReview();

    assert.ok(ctx.elements["m-gemini"].textContent.includes("Network timeout"));
    assert.strictEqual(ctx.elements["btn-run-ai-review"].disabled, false, "Button must be re-enabled on exception");
    assert.strictEqual(ctx.state.isReviewingAi, false, "state.isReviewingAi must reset on exception");
    console.log("  ✓ [PASS] Network exception handled gracefully: button and state restored via finally");
  }

  // =================================================================
  // 3. LIVE HTTP BACKEND ENDPOINT INTEGRATION
  // =================================================================
  console.log("\n--- 3. Live HTTP Backend Endpoint (POST /api/analysis/:id/retry-ai-review) ---");

  await startServer();

  try {
    // Test 3.1: Expired session returns 404 SESSION_EXPIRED
    const resExpired = await req("POST", "/api/analysis/NON-EXISTENT-ID/retry-ai-review");
    assert.strictEqual(resExpired.status, 404, "Unknown analysis ID should return 404");
    assert.strictEqual(resExpired.json.success, false);
    assert.strictEqual(resExpired.json.error.code, "SESSION_EXPIRED");
    console.log("  ✓ [PASS] Backend returns HTTP 404 SESSION_EXPIRED for unknown/expired session ID");

    // Test 3.2: Valid session with 0 candidate passages completes cleanly
    const testSessionZero = {
      id: "VW-2026-TEST-ZERO-PASSAGES",
      matchedPassages: [],
      similarity: { score: 0 },
      aiReview: { available: false }
    };
    db.setSessionAnalysis(testSessionZero);

    const resZero = await req("POST", `/api/analysis/${testSessionZero.id}/retry-ai-review`);
    assert.strictEqual(resZero.status, 200, "Clean passage session should return 200");
    assert.strictEqual(resZero.json.success, true);
    assert.strictEqual(resZero.json.aiReview.status, "SUCCESS");
    assert.strictEqual(resZero.json.aiReview.state, "COMPLETED");
    assert.ok(resZero.json.aiReview.message.includes("No candidate matching passages"));
    console.log("  ✓ [PASS] Backend returns completed AI review when zero passages require review");

    // Test 3.3: Score and matched passages preserved untouched
    const updatedSession = db.getSessionAnalysis(testSessionZero.id);
    assert.strictEqual(updatedSession.similarity.score, 0, "Similarity score must remain untouched");
    console.log("  ✓ [PASS] Backend session similarity score remains completely protected and untouched");

  } finally {
    await stopServer();
  }

  console.log("\n=================================================================");
  console.log("   ALL AI REVIEW BUTTON REGRESSION & LIFECYCLE CHECKS PASSED!");
  console.log("=================================================================\n");
}

run().catch((err) => {
  console.error("\n❌ TEST SUITE FAILED:", err);
  if (server) server.close();
  process.exit(1);
});
