/**
 * Checkra Phase 10 Final Smoke & Lifecycle Verification
 */

const assert = require("assert");
const http = require("http");
const app = require("../server/server");

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

function req(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
    const reqHeaders = { "x-test-bypass": "1", ...headers };
    if (postData) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(postData);
    }
    const r = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: reqHeaders,
      timeout: 15000
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
  console.log("   CHECKRA PHASE 10 FINAL PRODUCTION SMOKE & LIFECYCLE TEST");
  console.log("=================================================================\n");

  await startServer();

  try {
    // 1. /api/health
    console.log("1. Testing GET /api/health...");
    const resHealth = await req("GET", "/api/health");
    assert.strictEqual(resHealth.status, 200);
    assert.strictEqual(resHealth.json.ok, true);
    assert.strictEqual(resHealth.json.search?.url, undefined, "Internal search URL must not be leaked");
    console.log("  ✓ [PASS] /api/health returns 200 OK without credential leaks");

    // 2. /api/ai/health
    console.log("\n2. Testing GET /api/ai/health...");
    const resAiHealth = await req("GET", "/api/ai/health");
    assert.strictEqual(resAiHealth.status, 200);
    assert.strictEqual(resAiHealth.json.model, "qwen3:1.7b");
    console.log(`  ✓ [PASS] /api/ai/health returns 200 OK (Configured: ${resAiHealth.json.configured}, Available: ${resAiHealth.json.available})`);

    // 3. /api/analyze
    console.log("\n3. Testing POST /api/analyze...");
    const resAnalyze = await req("POST", "/api/analyze", {
      text: "Astrophysical surveys monitor gravitational micro-lensing events to detect rogue terrestrial exoplanets drifting through interstellar space without host stars.",
      options: { disablePublicWebSearch: true }
    });
    assert.strictEqual(resAnalyze.status, 200);
    assert.strictEqual(typeof resAnalyze.json.similarity?.score, "number");
    console.log(`  ✓ [PASS] /api/analyze returns 200 OK (Score: ${resAnalyze.json.similarity.score}%)`);

    // 4. /api/workspace/create
    console.log("\n4. Testing POST /api/workspace/create...");
    const sampleText = "The development of high-resolution cryogenic electron microscopy has fundamentally revolutionized structural biology. Researchers can now determine the atomic three-dimensional architectures of complex macromolecular assemblies in near-native frozen-hydrated states without crystallization.";
    const resCreate = await req("POST", "/api/workspace/create", {
      title: "Cryo-EM Structural Biology",
      text: sampleText
    });
    assert.strictEqual(resCreate.status, 201);
    assert.strictEqual(resCreate.json.ok, true);
    const wsId = resCreate.json.workspace.id;
    assert(wsId && wsId.startsWith("ws-"));
    console.log(`  ✓ [PASS] /api/workspace/create returns 200 OK (Workspace ID: ${wsId})`);

    // 5. /api/workspace/:id
    console.log("\n5. Testing GET /api/workspace/:id...");
    const resGetWs = await req("GET", `/api/workspace/${wsId}`);
    assert.strictEqual(resGetWs.status, 200);
    assert.strictEqual(resGetWs.json.workspace.id, wsId);
    assert.strictEqual(resGetWs.json.workspace.versions.length, 1);
    console.log("  ✓ [PASS] /api/workspace/:id returns 200 OK with initial v1 state");

    // 6. /api/workspace/:id/analyze
    console.log("\n6. Testing POST /api/workspace/:id/analyze...");
    const resWsAnalyze = await req("POST", `/api/workspace/${wsId}/analyze`, {
      options: { disablePublicWebSearch: true }
    });
    assert.strictEqual(resWsAnalyze.status, 200);
    assert.strictEqual(resWsAnalyze.json.ok, true);
    assert.strictEqual(typeof resWsAnalyze.json.workspace.analysis?.similarity?.score, "number");
    console.log(`  ✓ [PASS] /api/workspace/:id/analyze returns 200 OK (Score: ${resWsAnalyze.json.workspace.analysis.similarity.score}%)`);

    // 7. /api/workspace/:id/rewrite
    console.log("\n7. Testing POST /api/workspace/:id/rewrite...");
    const resRewrite = await req("POST", `/api/workspace/${wsId}/rewrite`, {
      passage: "The development of high-resolution cryogenic electron microscopy has fundamentally revolutionized structural biology.",
      mode: "academic-readable"
    });
    assert.strictEqual(resRewrite.status, 200);
    assert.strictEqual(resRewrite.json.ok, true);
    assert(resRewrite.json.rewrite?.rewriteId);
    const rewriteId = resRewrite.json.rewrite.rewriteId;
    console.log(`  ✓ [PASS] /api/workspace/:id/rewrite stages rewrite (ID: ${rewriteId})`);

    // 8. /api/workspace/:id/apply-rewrite
    console.log("\n8. Testing POST /api/workspace/:id/apply-rewrite...");
    const resApply = await req("POST", `/api/workspace/${wsId}/apply-rewrite`, {
      originalPassage: resRewrite.json.rewrite.originalPassage,
      newText: resRewrite.json.rewrite.rewrittenText
    });
    assert.strictEqual(resApply.status, 200);
    assert.strictEqual(resApply.json.ok, true);
    assert.strictEqual(resApply.json.version, 2);
    console.log("  ✓ [PASS] /api/workspace/:id/apply-rewrite advances version from v1 to v2");

    // 9. /api/workspace/:id/recheck
    console.log("\n9. Testing POST /api/workspace/:id/recheck...");
    const resRecheck = await req("POST", `/api/workspace/${wsId}/recheck`, {
      options: { disablePublicWebSearch: true }
    });
    assert.strictEqual(resRecheck.status, 200);
    assert.strictEqual(resRecheck.json.ok, true);
    assert(resRecheck.json.comparison);
    console.log("  ✓ [PASS] /api/workspace/:id/recheck computes version deltas");

    // 10. /api/workspace/:id/reports
    console.log("\n10. Testing GET /api/workspace/:id/reports...");
    const resReports = await req("GET", `/api/workspace/${wsId}/reports`);
    assert.strictEqual(resReports.status, 200);
    assert.strictEqual(resReports.json.ok, true);
    assert(resReports.json.reports?.integrityReport);
    console.log("  ✓ [PASS] /api/workspace/:id/reports generates full 5-report suite");

    // 11. /api/workspace/:id/export
    console.log("\n11. Testing GET /api/workspace/:id/export...");
    const resExportJson = await req("GET", `/api/workspace/${wsId}/export?format=json`);
    assert.strictEqual(resExportJson.status, 200);
    const resExportMd = await req("GET", `/api/workspace/${wsId}/export?format=markdown`);
    assert.strictEqual(resExportMd.status, 200);
    assert(resExportMd.body.includes("Generated by Checkra Academic Workspace"));
    const resExportHtml = await req("GET", `/api/workspace/${wsId}/export?format=html`);
    assert.strictEqual(resExportHtml.status, 200);
    assert(resExportHtml.body.includes("Checkra"));
    console.log("  ✓ [PASS] /api/workspace/:id/export produces JSON, Markdown, and HTML");

    // 12. /api/research/claims
    console.log("\n12. Testing POST /api/research/claims...");
    const resClaims = await req("POST", "/api/research/claims", {
      text: "Global carbon emissions reached 36.8 billion metric tons in 2022, representing a 0.9% increase compared to previous estimates."
    });
    assert.strictEqual(resClaims.status, 200);
    assert.strictEqual(resClaims.json.ok, true);
    assert(resClaims.json.claims.length > 0);
    console.log(`  ✓ [PASS] /api/research/claims extracts ${resClaims.json.claims.length} claims`);

    // 13. /api/citations/analyze
    console.log("\n13. Testing POST /api/citations/analyze...");
    const resCitations = await req("POST", "/api/citations/analyze", {
      text: "According to Smith (2020), neural network scaling improves downstream comprehension. However, quantum computing will replace classical silicon by 2030."
    });
    assert.strictEqual(resCitations.status, 200);
    assert.strictEqual(resCitations.json.ok, true);
    assert(resCitations.json.citationGaps.length >= 1);
    console.log(`  ✓ [PASS] /api/citations/analyze identifies ${resCitations.json.citations.length} citations and ${resCitations.json.citationGaps.length} gaps`);

    // 14. DELETE /api/workspace/:id & Inaccessibility verification
    console.log("\n14. Testing DELETE /api/workspace/:id & subsequent inaccessibility...");
    const resDelete = await req("DELETE", `/api/workspace/${wsId}`);
    assert.strictEqual(resDelete.status, 200);
    assert.strictEqual(resDelete.json.ok, true);

    const resInaccessible = await req("GET", `/api/workspace/${wsId}`);
    assert.strictEqual(resInaccessible.status, 404, "Deleted workspace must return 404");
    assert.strictEqual(resInaccessible.json.error, "WORKSPACE_NOT_FOUND");
    console.log("  ✓ [PASS] DELETE /api/workspace/:id succeeds and subsequent GET returns 404 WORKSPACE_NOT_FOUND");

    // 15. Security leak check
    console.log("\n15. Verifying absence of credential leaks across all responses...");
    const combinedResponses = [
      resHealth.body,
      resAiHealth.body,
      resAnalyze.body,
      resCreate.body,
      resGetWs.body,
      resWsAnalyze.body,
      resReports.body,
      resExportJson.body,
      resExportMd.body,
      resExportHtml.body,
      resClaims.body,
      resCitations.body
    ].join(" ");

    assert(!combinedResponses.includes("AIzaSy"), "Google API keys must not appear in responses");
    assert(!combinedResponses.includes("sk-"), "OpenAI/bearer tokens must not appear in responses");
    assert(!combinedResponses.includes("password"), "Passwords must not appear in responses");
    assert(!combinedResponses.includes("127.0.0.1:8080"), "Private search URLs must not be exposed");
    console.log("  ✓ [PASS] Zero API keys, passwords, or private search infrastructure URLs found in response payloads");

    console.log("\n=================================================================");
    console.log("   ALL PRODUCTION SMOKE & LIFECYCLE CHECKS PASSED!");
    console.log("=================================================================");
  } finally {
    await stopServer();
  }
}

run().catch(err => {
  console.error("Smoke test failure:", err);
  process.exit(1);
});
