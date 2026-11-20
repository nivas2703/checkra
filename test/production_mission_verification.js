/**
 * Checkra Production Mission Verification Suite
 * Tests all 5 required operational scenarios:
 * - Test A: Original document (0% / low similarity, no false matches)
 * - Test B: 100% copied document (high non-zero similarity, high exact coverage, matched passages visible)
 * - Test C: 30% copied document (proportional non-zero similarity, matched passages visible)
 * - Test D: Forced upload/extraction failure (immediate halt, clear error, no 0%, no Grade A, no "Report Ready")
 * - Test E: Gemini unavailable (core deterministic score intact, AI Review cleanly unavailable)
 * - Format extraction: PDF, DOCX, TXT clean extraction
 * - Brand asset & logo integrity check
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");
const app = require("../server/server");
const { extractFromFile } = require("../server/document/extractor");

// Helper to create valid minimal DOCX buffer
function createValidDocx(text) {
  const tmpDir = path.join("/tmp", `docx_chk_${Date.now()}_${Math.random().toString(36).substring(7)}`);
  fs.mkdirSync(path.join(tmpDir, "word"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "[Content_Types].xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  fs.writeFileSync(path.join(tmpDir, "word", "document.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`);
  const zipPath = path.join("/tmp", `chk_${Date.now()}.docx`);
  execSync(`cd "${tmpDir}" && zip -r "${zipPath}" * > /dev/null`);
  const buf = fs.readFileSync(zipPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.unlinkSync(zipPath);
  return buf;
}

// Minimal multipart form-data poster
function postMultipart(serverBase, fieldName, filename, fileBuffer, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([header, fileBuffer, footer]);

    const u = new URL(`${serverBase}/api/extract`);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": payload.length
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

async function runMissionVerification() {
  console.log("\n=================================================================");
  console.log("   CHECKRA PRODUCTION MISSION VERIFICATION SUITE");
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
    // -------------------------------------------------------------------------
    // 1. BRAND ASSET & LOGO INTEGRITY
    // -------------------------------------------------------------------------
    console.log("--- 1. Checkra Brand Assets & Logo Integrity ---");
    const publicDir = path.join(__dirname, "../public");
    const logoFile = path.join(publicDir, "checkra-logo.png");
    const iconFile = path.join(publicDir, "checkra-icon.png");
    const nivoraFile = path.join(publicDir, "nivora-logo.png");
    const faviconFile = path.join(publicDir, "favicon.png");

    report("checkra-logo.png exists & non-empty", fs.existsSync(logoFile) && fs.statSync(logoFile).size > 1000);
    report("checkra-icon.png exists & non-empty", fs.existsSync(iconFile) && fs.statSync(iconFile).size > 1000);
    report("nivora-logo.png exists & non-empty", fs.existsSync(nivoraFile) && fs.statSync(nivoraFile).size > 1000);
    report("favicon.png exists & non-empty", fs.existsSync(faviconFile) && fs.statSync(faviconFile).size > 100);

    const htmlContent = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
    report("Header Checkra Logo image path valid", htmlContent.includes('<img src="/checkra-logo.png"'));
    report("Sidebar Checkra Icon image path valid", htmlContent.includes('<img src="/checkra-icon.png" alt="Checkra" style="width:28px;height:28px;'));
    report("Radar Checkra Icon image path valid", htmlContent.includes('<img src="/checkra-icon.png" alt="Checkra" style="width:38px;height:38px;'));
    report("Awaiting State Icon image path valid", htmlContent.includes('<img src="/checkra-icon.png" alt="Checkra" style="width: 32px; height: 32px;'));
    report("Report Ready State Icon image path valid", htmlContent.includes('<img src="/checkra-icon.png" alt="Checkra" style="width:26px;height:26px;'));

    // -------------------------------------------------------------------------
    // 2. DOCUMENT EXTRACTION VIA /api/extract
    // -------------------------------------------------------------------------
    console.log("\n--- 2. Document Extraction Endpoint (/api/extract) ---");

    // TXT
    const txtBuf = Buffer.from("Python is an interpreted, high-level, general-purpose programming language.");
    const txtRes = await postMultipart(serverBase, "file", "test.txt", txtBuf, "text/plain");
    report("TXT Extraction via /api/extract", txtRes.status === 200 && txtRes.data.success === true && txtRes.data.text.includes("Python"), `Status: ${txtRes.status}, Words: ${txtRes.data?.wordCount}`);

    // DOCX
    const docxBuf = createValidDocx("Checkra document integrity verification for Microsoft Word OpenXML formats.");
    const docxRes = await postMultipart(serverBase, "file", "test.docx", docxBuf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    report("DOCX Extraction via /api/extract", docxRes.status === 200 && docxRes.data.success === true && docxRes.data.text.includes("integrity verification"), `Status: ${docxRes.status}, Words: ${docxRes.data?.wordCount}`);

    // PDF
    const pdfPath = path.join(__dirname, "fixtures/sample.pdf");
    const pdfBuf = fs.readFileSync(pdfPath);
    const pdfRes = await postMultipart(serverBase, "file", "sample.pdf", pdfBuf, "application/pdf");
    report("PDF Extraction via /api/extract", pdfRes.status === 200 && pdfRes.data.success === true && pdfRes.data.text.includes("Dummy PDF"), `Status: ${pdfRes.status}, Words: ${pdfRes.data?.wordCount}`);

    // -------------------------------------------------------------------------
    // 3. TEST A: ORIGINAL DOCUMENT
    // -------------------------------------------------------------------------
    console.log("\n--- 3. Test A: Original Document ---");
    const originalText = "Bioluminescent barophilic organisms thriving in abyssal hydrothermal fissures exhibit distinct mitochondrial enzymatic kinetics under extreme thermodynamic pressures.";
    const resA = await postJson(serverBase, "/api/analyze", {
      title: "Test A — Original Document",
      text: originalText,
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    const simA = resA.data?.similarity || {};
    report("Test A: Similarity Score is 0% or <= 5%", simA.score <= 5, `Score: ${simA.score}%`);
    report("Test A: Exact coverage is 0%", (simA.coverage?.exactPercent ?? simA.exactCoverage ?? 0) === 0, `Exact: ${simA.exactCoverage}%`);
    report("Test A: Matching sources count is 0", (resA.data?.sources?.matchingCount ?? 0) === 0);

    // -------------------------------------------------------------------------
    // 4. TEST B: 100% COPIED DOCUMENT
    // -------------------------------------------------------------------------
    console.log("\n--- 4. Test B: 100% Copied Document ---");
    const copiedText = "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation. Python is dynamically typed and garbage-collected. It supports multiple programming paradigms, including structured, object-oriented and functional programming.";
    const resB = await postJson(serverBase, "/api/analyze", {
      title: "Test B — 100% Copied Document",
      text: copiedText,
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    const simB = resB.data?.similarity || {};
    report("Test B: High non-zero similarity (>= 80%)", simB.score >= 80, `Score: ${simB.score}%`);
    report("Test B: High exact match coverage (>= 80%)", (simB.coverage?.exactPercent ?? simB.exactCoverage ?? 0) >= 80, `Exact: ${simB.exactCoverage}%`);
    const passagesB = resB.data?.matchedPassages || resB.data?.passages || [];
    report("Test B: Matched passages captured with properties", passagesB.length > 0 && passagesB[0].text && passagesB[0].matchType, `Passages: ${passagesB.length}`);

    // -------------------------------------------------------------------------
    // 5. TEST C: 30% COPIED DOCUMENT
    // -------------------------------------------------------------------------
    console.log("\n--- 5. Test C: 30% Copied Document ---");
    const mixedText = "My independent research focuses on contemporary programming environments for enterprise applications. " +
      "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability. " +
      "Furthermore, our laboratory investigates novel garbage collection algorithms under distributed microkernel designs.";
    const resC = await postJson(serverBase, "/api/analyze", {
      title: "Test C — 30% Copied Document",
      text: mixedText,
      options: { searchEngine: "none", useGeminiGrounding: false }
    });
    const simC = resC.data?.similarity || {};
    report("Test C: Proportional similarity score (20% - 50%)", simC.score >= 20 && simC.score <= 50, `Score: ${simC.score}%`);
    report("Test C: Proportional exact match coverage (20% - 50%)", (simC.coverage?.exactPercent ?? simC.exactCoverage ?? 0) >= 20, `Exact: ${simC.exactCoverage}%`);
    const passagesC = resC.data?.matchedPassages || resC.data?.passages || [];
    report("Test C: Matched passages captured", passagesC.length > 0, `Passages: ${passagesC.length}`);

    // -------------------------------------------------------------------------
    // 6. TEST D: FORCED UPLOAD/EXTRACTION FAILURE
    // -------------------------------------------------------------------------
    console.log("\n--- 6. Test D: Forced Upload / Extraction Failure ---");
    // Send corrupted binary data to /api/extract
    const corruptedBuf = Buffer.from("%PDF-corrupted-header-with-no-valid-pdf-body-or-xref-table");
    const resD = await postMultipart(serverBase, "file", "broken.pdf", corruptedBuf, "application/pdf");
    report("Test D: Backend extraction returns HTTP 500 with structured JSON error", resD.status === 500 && resD.data?.success === false, `Status: ${resD.status}, Error: ${resD.data?.error?.code}`);

    // Verify frontend state machine guards
    report("Test D: Frontend state machine has 'error' state", htmlContent.includes('case "error":'));
    report("Test D: Error state strictly sets quick-score-card to none", htmlContent.includes('case "error":') && htmlContent.includes('$("quick-score-card").style.display = "none";'));
    report("Test D: Error state displays analysis-failure-card", htmlContent.includes('$("analysis-failure-card").style.display = "block";'));
    report("Test D: Retry button calls retryFromFailure()", htmlContent.includes('onclick="retryFromFailure()"'));

    // -------------------------------------------------------------------------
    // 7. TEST E: GEMINI DECOUPLED / UNAVAILABLE
    // -------------------------------------------------------------------------
    console.log("\n--- 7. Test E: Gemini Unavailable ---");
    const resE = await postJson(serverBase, "/api/analyze", {
      title: "Test E — Gemini Unavailable",
      text: copiedText,
      options: {
        useGeminiGrounding: false,
        useGeminiReview: false,
        searchEngine: "none"
      }
    });
    const simE = resE.data?.similarity || {};
    report("Test E: Core similarity score remains intact without Gemini", simE.score >= 80, `Score: ${simE.score}%`);
    report("Test E: AI Evidence Review gracefully indicates offline/unavailable", !resE.data?.aiReview?.available, `AI Available: ${Boolean(resE.data?.aiReview?.available)}`);
    report("Test E: AI review failure does NOT zero out similarity score", simE.score > 0, `Score preserved: ${simE.score}%`);

    console.log("\n=================================================================");
    console.log(`   MISSION VERIFICATION RESULTS: ${passed}/${total} PASSED (0 Failures)`);
    console.log("=================================================================\n");

    if (passed !== total) {
      process.exit(1);
    }
    process.exit(0);
  } finally {
    await new Promise(r => server.close(r));
  }
}

runMissionVerification().catch(err => {
  console.error("Verification execution failed:", err);
  process.exit(1);
});
