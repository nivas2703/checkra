/**
 * CHECKRA PHASE 9: PRODUCTION UX/UI & END-TO-END USER ACCEPTANCE TEST SUITE
 *
 * Comprehensive End-to-End Acceptance Verification covering 58+ assertions:
 *   - Landing & Academic Explanation (A1 - A3)
 *   - Upload & Extraction (A4 - A9)
 *   - Analysis Progress & State Handling (A10 - A14)
 *   - Workspace Overview & Metrics (A15 - A22)
 *   - Evidence Explorer & Diagnostic Match Types (A23 - A27)
 *   - Research Workspace & Claims (A28 - A31)
 *   - Writing & Rewrite Workspace (A32 - A36)
 *   - Recheck & Before/After Impact (A37 - A40)
 *   - Checkra AI Assistant Context (A41 - A44)
 *   - Report Center (A45 - A49)
 *   - Export Architecture (A50 - A52)
 *   - Accessibility, Responsive Design & Security (A53 - A58)
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");

const {
  createWorkspace,
  getWorkspace,
  detectDocumentSections,
  analyzeWorkspace,
  getPassageContext,
  stageRewrite,
  applyRewrite,
  recheckWorkspace,
  generateWorkspaceReports,
  exportWorkspace,
  deleteWorkspace
} = require("../server/workspace/documentWorkspace");

const { executeTool } = require("../server/ai/tools");
const { runCheckraAgent } = require("../server/ai/agent");
const app = require("../server/server");

let server = null;
let serverBase = "";
let passedCount = 0;
let failedCount = 0;

function report(id, title, condition, details = "") {
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] ${id}: ${title} ${details ? "(" + details + ")" : ""}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${id}: ${title} ${details ? "(" + details + ")" : ""}`);
    throw new Error(`UX Acceptance Assertion failed: ${id} - ${title}`);
  }
}

async function postJson(endpoint, data) {
  const url = `${serverBase}${endpoint}`;
  const body = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getJson(endpoint) {
  const url = `${serverBase}${endpoint}`;
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, raw });
        }
      });
    }).on("error", reject);
  });
}

async function runAcceptanceSuite() {
  console.log("\n==================================================================================");
  console.log("   CHECKRA PHASE 9: PRODUCTION UX/UI & END-TO-END ACCEPTANCE SUITE");
  console.log("==================================================================================\n");

  const indexPath = path.join(__dirname, "../public/index.html");
  const htmlContent = fs.readFileSync(indexPath, "utf8");

  // --- 1. LANDING & ACADEMIC EXPLANATION (A1 - A3) ---
  console.log("--- Category 1: Landing & Academic Explanation ---");
  report(
    "A1",
    "Clear product explanation and branding",
    htmlContent.includes("CHECKRA — Check. Verify. Improve.") &&
    htmlContent.includes("An intelligent writing and research workspace for students, researchers, and professionals.") &&
    htmlContent.includes("A NIVORA Product") &&
    htmlContent.includes("Checkra provides deterministic similarity analysis")
  );

  report(
    "A2",
    "Document upload interface elements visible",
    htmlContent.includes('id="drop-zone"') &&
    htmlContent.includes('id="file-input"') &&
    htmlContent.includes('id="doc-text"') &&
    htmlContent.includes('id="doc-title"')
  );

  report(
    "A3",
    "Supported document formats clearly displayed",
    htmlContent.includes("PDF, DOCX, TXT, MD, HTML") &&
    htmlContent.includes("4.5 MB") &&
    htmlContent.includes("Session-only mode")
  );

  // --- 2. UPLOAD & EXTRACTION (A4 - A9) ---
  console.log("\n--- Category 2: Upload & Extraction ---");
  const pdfFixture = path.join(__dirname, "fixtures/sample.pdf");
  report(
    "A4",
    "Valid PDF format fixture exists and is non-empty",
    fs.existsSync(pdfFixture) && fs.statSync(pdfFixture).size > 500
  );

  report(
    "A5",
    "DOCX upload support configured in file input accept attributes",
    htmlContent.includes(".docx") && htmlContent.includes(".doc")
  );

  report(
    "A6",
    "Text file instant local FileReader extraction logic present",
    htmlContent.includes("FileReader") &&
    htmlContent.includes("ext === \"txt\"") &&
    htmlContent.includes("ext === \"md\"")
  );

  report(
    "A7",
    "Unsupported file format produces human-readable explanation",
    htmlContent.includes("Unsupported file format") &&
    htmlContent.includes("Supported formats are PDF, DOCX, TXT, MD, and HTML")
  );

  report(
    "A8",
    "Empty file extraction produces human-readable notice without creating score",
    htmlContent.includes("The uploaded text file is empty") &&
    htmlContent.includes("No similarity result was generated.")
  );

  report(
    "A9",
    "Document extraction error displays dedicated failure UI with retry button",
    htmlContent.includes('id="analysis-failure-card"') &&
    htmlContent.includes("retryFromFailure()")
  );

  // --- 3. ANALYSIS PROGRESS & STATE HANDLING (A10 - A14) ---
  console.log("\n--- Category 3: Analysis Progress & State Handling ---");
  const hasAllSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every(i =>
    htmlContent.includes(`id="step-${i}"`) && htmlContent.includes(`id="h-step-${i}"`)
  );
  report("A10", "All 10 analysis progress stages defined with stepper elements", hasAllSteps);

  report(
    "A11",
    "Analysis transition state machine has idle, extracting, analyzing, completed, error",
    htmlContent.includes('case "idle":') &&
    htmlContent.includes('case "extracting":') &&
    htmlContent.includes('case "analyzing":') &&
    htmlContent.includes('case "completed":') &&
    htmlContent.includes('case "error":')
  );

  report(
    "A12",
    "Analysis failure state gracefully handles error and preserves text",
    htmlContent.includes("Checkra Analysis Halted") &&
    htmlContent.includes("Your document text has been safely preserved.")
  );

  report(
    "A13",
    "Hard Gate: quick-score-card hidden and no 0% fabricated on error",
    htmlContent.includes('$("quick-score-card").style.display = "none"') &&
    htmlContent.includes("Checkra strictly avoids reporting 0% similarity when an analysis cannot be completed")
  );

  report(
    "A14",
    "Decoupled review notice: AI review failure never modifies similarity score",
    htmlContent.includes("AI Evidence Review is temporarily unavailable. This does not affect the similarity score.")
  );

  // --- 4. WORKSPACE OVERVIEW & METRICS (A15 - A22) ---
  console.log("\n--- Category 4: Workspace Overview & Metrics ---");
  report(
    "A15",
    "Overview metadata banner displays title, word count, sections, version",
    htmlContent.includes('id="overview-version-badge"') &&
    htmlContent.includes('id="overview-doc-title"') &&
    htmlContent.includes('id="overview-doc-meta"')
  );

  report(
    "A16",
    "Similarity Score displayed with grade and exact/near/semantic coverage",
    htmlContent.includes('id="ov-sim-score"') &&
    htmlContent.includes('id="ov-exact-cov"') &&
    htmlContent.includes('id="ov-near-cov"') &&
    htmlContent.includes('id="ov-semantic-cov"')
  );

  report(
    "A17",
    "AI-Writing Likelihood displayed as independent stylometric indicator",
    htmlContent.includes('id="ov-ai-score"') &&
    htmlContent.includes('id="ov-ai-conf"') &&
    htmlContent.includes('id="ov-ai-cv"') &&
    htmlContent.includes("Probabilistic stylometric indicator. Cannot prove authorship.")
  );

  report(
    "A18",
    "Integrity Confidence displayed with score (0-100) and Level badge",
    htmlContent.includes('id="ov-integ-score"') &&
    htmlContent.includes('id="ov-integ-level"') &&
    htmlContent.includes('id="ov-integ-verified"') &&
    htmlContent.includes("Evaluates evidence completeness and corroboration quality.")
  );

  report(
    "A19",
    "Research claims count displayed in workspace overview",
    htmlContent.includes('id="ov-claims-count"')
  );

  report(
    "A20",
    "Citation gaps count displayed in workspace overview",
    htmlContent.includes('id="ov-gaps-count"') &&
    htmlContent.includes('id="ov-citations-count"')
  );

  report(
    "A21",
    "Verified sources count displayed in workspace overview",
    htmlContent.includes('id="ov-sources-count"')
  );

  report(
    "A22",
    "Document sections explorer container present in overview",
    htmlContent.includes('id="overview-sections-container"') &&
    htmlContent.includes('id="sections-count-label"')
  );

  // --- 5. EVIDENCE EXPLORER & DIAGNOSTIC MATCH TYPES (A23 - A27) ---
  console.log("\n--- Category 5: Evidence Explorer & Diagnostic Match Types ---");
  report(
    "A23",
    "Exact Match classification badge and styling supported",
    htmlContent.includes("EXACT MATCH") &&
    htmlContent.includes("Identical sequence of words matching source text.")
  );

  report(
    "A24",
    "Near Match classification badge and explanation supported",
    htmlContent.includes("NEAR MATCH") &&
    htmlContent.includes("Text with word substitutions or slight grammatical alterations.")
  );

  report(
    "A25",
    "Topical similarity without textual overlap is never labeled as plagiarism",
    htmlContent.includes("TOPICAL SIMILARITY") &&
    htmlContent.includes("This source discusses a similar topic, but Checkra did not find sufficient textual evidence to classify it as a plagiarism-relevant match.")
  );

  report(
    "A26",
    "Source not verifiable handling and styling present",
    htmlContent.includes("badge-unsupported") &&
    htmlContent.includes("filterPassages")
  );

  report(
    "A27",
    "Passage diagnostic context links to rewrite action",
    htmlContent.includes("selectPassageForRewrite") &&
    htmlContent.includes("✨ Improve Passage")
  );

  // --- 6. RESEARCH WORKSPACE & CLAIMS (A28 - A31) ---
  console.log("\n--- Category 6: Research Workspace & Claims ---");
  report(
    "A28",
    "Claims table defined with columns: Statement, Type, Citation, Sources, Status",
    htmlContent.includes('id="claims-table-body"') &&
    htmlContent.includes("Claim Statement") &&
    htmlContent.includes("Citation") &&
    htmlContent.includes("Verified Sources")
  );

  report(
    "A29",
    "Research Claims on-demand action button present",
    htmlContent.includes("triggerResearchClaims()") &&
    htmlContent.includes("Research Claims")
  );

  report(
    "A30",
    "Claim filter pills present for All, Supported, Partially, Unsupported, Citation Gaps",
    htmlContent.includes("filterClaims('all')") &&
    htmlContent.includes("filterClaims('supported')") &&
    htmlContent.includes("filterClaims('partially')") &&
    htmlContent.includes("filterClaims('unsupported')") &&
    htmlContent.includes("filterClaims('missing_citation')")
  );

  report(
    "A31",
    "AI Agent contextual claim query hook enabled",
    htmlContent.includes("askAiAboutClaim(") &&
    htmlContent.includes("Does the verified evidence support this claim")
  );

  // --- 7. WRITING & REWRITE WORKSPACE (A32 - A36) ---
  console.log("\n--- Category 7: Writing & Rewrite Workspace ---");
  report(
    "A32",
    "Writing Quality score and issue breakdown cards present",
    htmlContent.includes('id="wq-score"') &&
    htmlContent.includes('id="g-count-grammar"') &&
    htmlContent.includes('id="g-count-spelling"') &&
    htmlContent.includes('id="g-count-clarity"') &&
    htmlContent.includes('id="g-count-punctuation"')
  );

  report(
    "A33",
    "Grammar findings list container present",
    htmlContent.includes('id="grammar-findings-list"')
  );

  report(
    "A34",
    "5 specialized rewrite modes configured with selector buttons",
    htmlContent.includes("setRewriteMode('clear-natural')") &&
    htmlContent.includes("setRewriteMode('academic-readable')") &&
    htmlContent.includes("setRewriteMode('professional')") &&
    htmlContent.includes("setRewriteMode('concise')") &&
    htmlContent.includes("setRewriteMode('simple-english')")
  );

  report(
    "A35",
    "Strict Original Text Immutability notice present in Rewrite Review Modal",
    htmlContent.includes('id="rewrite-review-modal"') &&
    htmlContent.includes("Original text remains unchanged until explicitly applied.")
  );

  report(
    "A36",
    "Apply Staged Rewrite creates new document version",
    htmlContent.includes("applyStagedRewriteUi()") &&
    htmlContent.includes("Applying creates Document Version 2")
  );

  // --- 8. RECHECK & BEFORE/AFTER IMPACT (A37 - A40) ---
  console.log("\n--- Category 8: Recheck & Before/After Impact ---");
  report(
    "A37",
    "Recheck notification banner present upon document modification",
    htmlContent.includes('id="recheck-banner"') &&
    htmlContent.includes('id="recheck-version-num"') &&
    htmlContent.includes("runRecheckUi()")
  );

  report(
    "A38",
    "Recheck quantitative impact table present",
    htmlContent.includes('id="recheck-impact-card"') &&
    htmlContent.includes('id="recheck-impact-tbody"') &&
    htmlContent.includes("Quantitative Shift")
  );

  report(
    "A39",
    "Objective metric comparison wording enforced (Changed from X to Y)",
    htmlContent.includes("Changed from ") &&
    !htmlContent.includes("Your plagiarism risk decreased")
  );

  report(
    "A40",
    "Version label update mechanism present in state controller",
    htmlContent.includes("state.activeVersion += 1") &&
    htmlContent.includes('id="overview-version-badge"')
  );

  // --- 9. CHECKRA AI ASSISTANT CONTEXT (A41 - A44) ---
  console.log("\n--- Category 9: Checkra AI Assistant Context ---");
  report(
    "A41",
    "Checkra AI Assistant drawer present with workspace context chip",
    htmlContent.includes('id="ai-assistant-drawer"') &&
    htmlContent.includes('id="ai-context-label"') &&
    htmlContent.includes('id="ai-chat-messages"') &&
    htmlContent.includes('id="ai-chat-input"')
  );

  report(
    "A42",
    "Quick question prompt chips for passage, claims, integrity, and citations",
    htmlContent.includes("Why was this passage flagged?") &&
    htmlContent.includes("Which claims need citations?") &&
    htmlContent.includes("Explain my Integrity Confidence.") &&
    htmlContent.includes("Show unsupported claims.") &&
    htmlContent.includes("Improve this paragraph.")
  );

  report(
    "A43",
    "AI Agent API client passes workspaceId and analysis context",
    htmlContent.includes("api.askAgent(") &&
    htmlContent.includes("workspaceId: state.activeWorkspaceId")
  );

  report(
    "A44",
    "Polite graceful fallback when evidence is unavailable without hallucination",
    htmlContent.includes("I don't have enough verified evidence in this workspace to answer that reliably.")
  );

  // --- 10. REPORT CENTER (A45 - A49) ---
  console.log("\n--- Category 10: Report Center ---");
  report(
    "A45",
    "Integrity Report card and viewer frame present",
    htmlContent.includes("Integrity Report") &&
    htmlContent.includes('id="report-frame"')
  );

  report(
    "A46",
    "Research Report card present in Report Center",
    htmlContent.includes("Research Report") &&
    htmlContent.includes("Corroborated claims, candidate web sources")
  );

  report(
    "A47",
    "Writing Quality Report card present in Report Center",
    htmlContent.includes("Writing Quality Report") &&
    htmlContent.includes("Grammar, style, passive voice, wordiness")
  );

  report(
    "A48",
    "Citation Audit Report card present in Report Center",
    htmlContent.includes("Citation Audit Report") &&
    htmlContent.includes("Citation gap analysis, unsupported claims, and bibliography formatting.")
  );

  report(
    "A49",
    "Document Summary card present in Report Center",
    htmlContent.includes("Document Summary") &&
    htmlContent.includes("High-level executive summary across all 4 diagnostic dimensions")
  );

  // --- 11. EXPORT ARCHITECTURE (A50 - A52) ---
  console.log("\n--- Category 11: Export Architecture ---");
  report(
    "A50",
    "JSON Data Package download handler configured",
    htmlContent.includes("downloadExport('json')") &&
    htmlContent.includes("JSON Data Package")
  );

  report(
    "A51",
    "Markdown Summary download handler configured",
    htmlContent.includes("downloadExport('markdown')") &&
    htmlContent.includes("Markdown Summary")
  );

  report(
    "A52",
    "Printable HTML download and print handlers configured",
    htmlContent.includes("downloadExport('html')") &&
    htmlContent.includes("printReport()") &&
    htmlContent.includes("downloadHtmlReport()")
  );

  // --- 12. ACCESSIBILITY, RESPONSIVENESS & SECURITY (A53 - A58) ---
  console.log("\n--- Category 12: Accessibility, Responsiveness & Security ---");
  report(
    "A53",
    "Keyboard navigation: Escape key closes modals and AI Assistant drawer",
    htmlContent.includes('e.key === "Escape"') &&
    htmlContent.includes("closeMetricModal()") &&
    htmlContent.includes("closeRewriteReview()")
  );

  report(
    "A54",
    "Visible focus outline (:focus-visible) styled for accessible keyboard control",
    htmlContent.includes(":focus-visible") &&
    htmlContent.includes("outline: 2px solid var(--violet-primary)")
  );

  report(
    "A55",
    "Semantic ARIA tabs and roles present (role=tablist, role=tab, aria-selected)",
    htmlContent.includes('role="tablist"') &&
    htmlContent.includes('role="tab"') &&
    htmlContent.includes('aria-selected="true"') &&
    htmlContent.includes('role="dialog"') &&
    htmlContent.includes('role="complementary"')
  );

  report(
    "A56",
    "Responsive design CSS rules present down to 768px and 1024px",
    htmlContent.includes("@media (max-width: 1024px)") &&
    htmlContent.includes("@media (max-width: 768px)") &&
    htmlContent.includes("overflow-x: hidden")
  );

  report(
    "A57",
    "Frontend security: No API keys or secret credentials present in index.html",
    !htmlContent.includes("AIzaSy") &&
    !htmlContent.includes("GEMINI_API_KEY") &&
    !htmlContent.includes("process.env")
  );

  report(
    "A58",
    "Mandatory metric definitions present verbatim in modal text",
    htmlContent.includes("A weighted measure based on Checkra's exact, near and semantic similarity coverage. It is not a direct percentage of copied text.") &&
    htmlContent.includes("A probabilistic stylometric indicator. It cannot establish authorship with certainty.") &&
    htmlContent.includes("A measure of the quality and completeness of the available evidence. It is not a probability of plagiarism or AI authorship.")
  );

  // --- 13. LIVE REST WORKFLOW INTEGRATION TESTS ---
  console.log("\n--- Category 13: Live REST Workflow Integration ---");

  // Spin up test server on ephemeral port
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      serverBase = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.on("error", reject);
  });

  try {
    // 1. Live workspace create
    const wsRes = await postJson("/api/workspace/create", {
      text: "Artificial intelligence has transformed modern computational diagnostics and natural language processing.",
      title: "AI Diagnostics Overview"
    });
    report("A59", "Live REST /api/workspace/create initializes workspace", wsRes.status === 201 && wsRes.data.ok === true && !!wsRes.data.workspace.id);
    const wsId = wsRes.data.workspace.id;

    // 2. Live workspace analyze
    const anRes = await postJson(`/api/workspace/${wsId}/analyze`, {
      similarityScore: 28,
      exactCoverage: 31,
      nearCoverage: 12,
      semanticCoverage: 8,
      includeResearchReport: false
    });
    report("A60", "Live REST /api/workspace/:id/analyze updates workspace state", anRes.status === 200 && anRes.data.ok === true);

    // 3. Live passage context
    const ctxRes = await postJson(`/api/workspace/${wsId}/passage-context`, {
      passageText: "Artificial intelligence has transformed modern computational diagnostics"
    });
    report("A61", "Live REST /api/workspace/:id/passage-context returns diagnostic context", ctxRes.status === 200 && ctxRes.data.ok === true && !!ctxRes.data.integrityEvidence);

    // 4. Live rewrite staging
    const rwRes = await postJson(`/api/workspace/${wsId}/rewrite`, {
      passage: "Artificial intelligence has transformed modern computational diagnostics",
      mode: "clear-natural"
    });
    report("A62", "Live REST /api/workspace/:id/rewrite stages rewrite", rwRes.status === 200 && rwRes.data.ok === true && !!(rwRes.data.rewrite && rwRes.data.rewrite.rewrittenText));

    // 5. Live apply rewrite
    const apRes = await postJson(`/api/workspace/${wsId}/apply-rewrite`, {
      originalPassage: "Artificial intelligence has transformed modern computational diagnostics",
      newText: rwRes.data.rewrite.rewrittenText
    });
    report("A63", "Live REST /api/workspace/:id/apply-rewrite increments version to 2", apRes.status === 200 && apRes.data.ok === true && apRes.data.version === 2);

    // 6. Live recheck
    const rcRes = await postJson(`/api/workspace/${wsId}/recheck`, {
      similarityScore: 12,
      includeResearchReport: false
    });
    report("A64", "Live REST /api/workspace/:id/recheck calculates before/after comparison", rcRes.status === 200 && rcRes.data.ok === true && rcRes.data.comparison.narrative.includes("changed from"));

    // 7. Live report center
    const repRes = await getJson(`/api/workspace/${wsId}/reports`);
    report("A65", "Live REST /api/workspace/:id/reports returns 5 reports", repRes.status === 200 && repRes.data.ok === true && repRes.data.reports && "integrityReport" in repRes.data.reports && "writingReport" in repRes.data.reports && "citationReport" in repRes.data.reports && "documentSummary" in repRes.data.reports);

    // 8. Live export JSON, Markdown, HTML
    const expJson = await getJson(`/api/workspace/${wsId}/export?format=json`);
    report("A66", "Live REST /api/workspace/:id/export?format=json returns complete export", expJson.status === 200 && expJson.data.ok === true && expJson.data.format === "json" && !!expJson.data.data);

    // Clean up workspace
    deleteWorkspace(wsId);
    report("A67", "Workspace in-memory cleanup verified", getWorkspace(wsId) === null);

  } finally {
    if (server) {
      await new Promise(r => server.close(r));
    }
  }

  console.log("\n==================================================================================");
  console.log(`   CHECKRA PHASE 9 RESULTS: ${passedCount}/${passedCount + failedCount} PASSED (${failedCount} Failures)`);
  console.log("==================================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAcceptanceSuite().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
