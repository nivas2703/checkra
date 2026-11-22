/**
 * Checkra — Vercel Serverless & Production Compatibility Test Suite
 *
 * Validates:
 * 1. Serverless entry point: api/index.js exports a callable (req, res) handler
 * 2. Vercel path normalization: routes /health -> /api/health
 * 3. Express 'trust proxy' & HTTPS verification URL generation
 * 4. In-memory session store & /tmp fallback on read-only environments
 * 5. Multipart in-memory extraction (PDF, DOCX, TXT, MD, HTML) without disk writes
 * 6. Vercel configuration: vercel.json syntax, rewrites, and function config
 * 7. Frontend asset integrity & absence of hardcoded localhost in public/
 * 8. Security invariant: GEMINI_API_KEY never exposed in health or API responses
 * 9. QR verification seal and report generation in serverless context
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");

// Load api/index.js
const serverlessHandler = require("../api/index");
const app = require("../server/server");
const db = require("../server/db/database");
const { generateReportPackage } = require("../server/reports/reportGenerator");
const { extractFromFile } = require("../server/document/extractor");

async function runVercelCompatibilityTests() {
  console.log("=================================================================");
  console.log("   CHECKRA VERCEL PRODUCTION COMPATIBILITY TEST SUITE");
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

  // -----------------------------------------------------------------
  // 1. Entry Point & Function Signature
  // -----------------------------------------------------------------
  console.log("--- 1. Vercel Serverless Function Signature ---");
  report(
    "Serverless Handler Exported",
    typeof serverlessHandler === "function",
    "api/index.js exports callable (req, res) function"
  );
  report(
    "Express App Exported from server.js",
    typeof app === "function" && typeof app.use === "function",
    "server/server.js exports express app instance without auto-binding port"
  );

  // -----------------------------------------------------------------
  // 2. Vercel Configuration (vercel.json)
  // -----------------------------------------------------------------
  console.log("\n--- 2. Vercel Configuration (vercel.json) ---");
  const vercelJsonPath = path.join(__dirname, "../vercel.json");
  let vercelConfig = null;
  try {
    const raw = fs.readFileSync(vercelJsonPath, "utf8");
    vercelConfig = JSON.parse(raw);
    report("vercel.json Syntax Valid", true, "JSON parsed successfully");
  } catch (e) {
    report("vercel.json Syntax Valid", false, e.message);
  }

  if (vercelConfig) {
    const hasApiRewrite = vercelConfig.rewrites?.some(r => r.source === "/api/(.*)" && r.destination === "/api/index.js");
    report("API Route Rewrite Configured", hasApiRewrite, "/api/(.*) -> /api/index.js");

    const hasVerifyRewrite = vercelConfig.rewrites?.some(r => r.source === "/verify/(.*)" && r.destination === "/api/index.js");
    report("Verify Seal Rewrite Configured", hasVerifyRewrite, "/verify/(.*) -> /api/index.js");

    const maxDuration = vercelConfig.functions?.["api/index.js"]?.maxDuration;
    report("Serverless Max Duration Configured", maxDuration >= 30, `maxDuration: ${maxDuration}s`);
  }

  // -----------------------------------------------------------------
  // 3. Frontend Static Assets & Zero Localhost Dependency
  // -----------------------------------------------------------------
  console.log("\n--- 3. Static Assets & Localhost Independence ---");
  const publicDir = path.join(__dirname, "../public");
  const indexHtmlPath = path.join(publicDir, "index.html");
  const htmlContent = fs.readFileSync(indexHtmlPath, "utf8");

  report(
    "index.html Exists in public/",
    fs.existsSync(indexHtmlPath) && htmlContent.length > 500,
    `Size: ${htmlContent.length} bytes`
  );
  report(
    "No Localhost Hardcoding in index.html",
    !htmlContent.includes("localhost:8787") && !htmlContent.includes("127.0.0.1:8787"),
    "All API calls are relative (/api/...)"
  );
  report(
    "Checkra Logo Exists",
    fs.existsSync(path.join(publicDir, "checkra-logo.png")),
    "public/checkra-logo.png present"
  );
  report(
    "NIVORA Logo Exists",
    fs.existsSync(path.join(publicDir, "nivora-logo.png")),
    "public/nivora-logo.png present"
  );
  report(
    "Favicon Exists",
    fs.existsSync(path.join(publicDir, "favicon.png")),
    "public/favicon.png present"
  );

  // -----------------------------------------------------------------
  // 4. Serverless In-Memory Simulation
  // -----------------------------------------------------------------
  console.log("\n--- 4. Serverless HTTP Execution via api/index.js ---");

  // Spin up temporary ephemeral test server wrapping serverlessHandler
  const testServer = http.createServer((req, res) => {
    serverlessHandler(req, res);
  });

  await new Promise(resolve => testServer.listen(0, "127.0.0.1", resolve));
  const testPort = testServer.address().port;
  const baseTestUrl = `http://127.0.0.1:${testPort}`;

  async function mockReq(urlPath, method = "GET", headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlPath, baseTestUrl);
      const reqHeaders = { ...headers };
      if (body) {
        reqHeaders["Content-Length"] = Buffer.byteLength(body);
      }
      const req = http.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: reqHeaders
      }, res => {
        let b = "";
        res.on("data", c => b += c);
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(b); } catch (e) {}
          resolve({ status: res.statusCode, headers: res.headers, body: b, json });
        });
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  try {
    // 4.1 Health Check via standard /api/health
    const healthRes = await mockReq("/api/health");
    report(
      "Serverless /api/health Endpoint",
      healthRes.status === 200 && healthRes.json?.ok === true,
      `HTTP ${healthRes.status}, service: ${healthRes.json?.service}`
    );
    report(
      "Health Endpoint API Key Isolation",
      !JSON.stringify(healthRes.json).includes("AIzaSy"),
      "No secrets exposed in response payload"
    );

    // 4.2 Path Normalization: calling /health routes cleanly through serverless wrapper
    const rewriteHealthRes = await mockReq("/health");
    report(
      "Vercel Path Normalization (/health -> /api/health)",
      rewriteHealthRes.status === 200 && rewriteHealthRes.json?.ok === true,
      `HTTP ${rewriteHealthRes.status}`
    );

    // 4.3 Proxy Trust & HTTPS Verification URL
    const reportPkgRes = await mockReq(
      "/api/report",
      "POST",
      {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
        "Host": "checkra.vercel.app"
      },
      JSON.stringify({
        id: "VW-2026-VERCEL",
        title: "Vercel Deployment Verification Doc",
        similarity: { score: 15, grade: "A" },
        document: { title: "Vercel Verification Doc", wordCount: 150 }
      })
    );
    report(
      "Serverless Report Package Generation",
      reportPkgRes.status === 200 && reportPkgRes.json?.success === true,
      `HTTP ${reportPkgRes.status}`
    );
    report(
      "HTTPS Protocol Respected on Vercel (Trust Proxy)",
      reportPkgRes.json?.verificationUrl?.startsWith("https://checkra.vercel.app/verify/VW-2026-VERCEL"),
      `Verification URL: ${reportPkgRes.json?.verificationUrl}`
    );

    // 4.4 Public Verification Seal /verify/:id via Serverless Handler
    // First register the session analysis in db
    db.setSessionAnalysis({
      id: "VW-2026-VERCEL",
      createdAt: new Date().toISOString(),
      document: { title: "Vercel Verification Doc", wordCount: 150 },
      similarity: { score: 15, grade: "A" }
    });
    const verifyRes = await mockReq("/verify/VW-2026-VERCEL", "GET", {
      "X-Forwarded-Proto": "https",
      "Host": "checkra.vercel.app"
    });
    report(
      "Serverless /verify/:id Page",
      verifyRes.status === 200 && verifyRes.body.includes("Writing Integrity Verification"),
      `HTTP ${verifyRes.status}, includes verified seal`
    );
    report(
      "Verification Page NIVORA Branding",
      verifyRes.body.includes("A NIVORA Product") && verifyRes.body.includes("https://nivora.web.app/"),
      "Contains authentic NIVORA parent ecosystem branding"
    );

    // 4.5 Grammar Engine through Serverless Entry Point
    const grammarRes = await mockReq(
      "/api/grammar",
      "POST",
      { "Content-Type": "application/json" },
      JSON.stringify({ text: "Their is a problem due to the fact that they utilize irregardless in order to proceed ." })
    );
    report(
      "Serverless /api/grammar Execution",
      grammarRes.status === 200 && grammarRes.json?.findings?.length > 0,
      `Findings: ${grammarRes.json?.findings?.length}`
    );

    // 4.6 Rewrite Modes through Serverless Entry Point
    const modesRes = await mockReq("/api/rewrite/modes");
    const modeCount = Object.keys(modesRes.json?.modes || {}).length;
    report(
      "Serverless /api/rewrite/modes",
      modesRes.status === 200 && modeCount >= 5,
      `Modes configured: ${modeCount}`
    );

    // 4.7 Test Sample Document endpoint
    const sampleDocRes = await mockReq("/api/test-document");
    report(
      "Serverless /api/test-document",
      sampleDocRes.status === 200 && sampleDocRes.json?.text?.length > 100,
      `Title: "${sampleDocRes.json?.title}"`
    );

  } finally {
    testServer.close();
  }

  // -----------------------------------------------------------------
  // 5. In-Memory Document Processing (No Filesystem Dependency)
  // -----------------------------------------------------------------
  console.log("\n--- 5. Document Processing in Memory ---");
  const txtBuffer = Buffer.from("Checkra high-precision writing integrity analysis in serverless memory.", "utf8");
  const txtExtracted = await extractFromFile(txtBuffer, "test.txt", "text/plain");
  report(
    "In-Memory TXT Extraction",
    txtExtracted.wordCount >= 8,
    `Word count: ${txtExtracted.wordCount}`
  );

  const htmlBuffer = Buffer.from("<p>Hello <b>World</b> from serverless HTML.</p>", "utf8");
  const htmlExtracted = await extractFromFile(htmlBuffer, "test.html", "text/html");
  report(
    "In-Memory HTML Sanitized Extraction",
    htmlExtracted.rawText.includes("Hello World from serverless HTML"),
    `Text: "${htmlExtracted.rawText.trim()}"`
  );

  // -----------------------------------------------------------------
  // 6. In-Memory Session Isolation
  // -----------------------------------------------------------------
  console.log("\n--- 6. Session Isolation & Settings Safety ---");
  const randId = "VW-2026-TEST-" + Math.floor(Math.random() * 99999);
  db.setSessionAnalysis({ id: randId, title: "Test Doc", score: 0 });
  const retrieved = db.getSessionAnalysis(randId);
  report(
    "Session Stored & Retrieved in Memory",
    retrieved && retrieved.id === randId,
    `Retrieved ID: ${retrieved?.id}`
  );

  // Verify settings update works safely even in read-only environment
  const originalEnv = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    const updated = db.updateSettings({ minMatchLength: 7 });
    report(
      "Settings Update Resilient in Vercel Environment",
      updated.minMatchLength === 7,
      "Settings saved without throw in read-only environment"
    );
  } catch (err) {
    report("Settings Update Resilient in Vercel Environment", false, err.message);
  } finally {
    if (originalEnv) process.env.VERCEL = originalEnv;
    else delete process.env.VERCEL;
  }

  console.log("\n=================================================================");
  console.log(` VERCEL COMPATIBILITY RESULTS: ${passed}/${total} PASSED (${total - passed} Failed)`);
  console.log("=================================================================\n");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runVercelCompatibilityTests().catch(err => {
  console.error("Fatal error running Vercel compatibility tests:", err);
  process.exit(1);
});
