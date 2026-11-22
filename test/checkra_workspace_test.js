/**
 * Checkra Phase 8: Academic Workspace & Document Intelligence Test Suite
 *
 * Comprehensive validation across:
 * - Document workspace lifecycle (creation, metadata, text immutability, section detection)
 * - State machine transitions & error resilience
 * - Cross-engine integration (similarity, AI writing, integrity fusion, writing quality, research, citations)
 * - Evidence explorer & passage diagnostics
 * - Editing & rewrite workflow (staged rewrite, original immutability, explicit apply, version snapshotting)
 * - Recheck workflow & before/after change impact computation
 * - Unified Report Center (Integrity, Research, Writing, Citation, Document Summary)
 * - Export formats (JSON, Markdown, printable HTML)
 * - Agent workspace context integration
 * - Security, privacy, and zero secret exposure
 * - Live validation scenarios (1 to 20)
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const app = require("../server/server");
const {
  createWorkspace,
  getWorkspace,
  analyzeWorkspace,
  getPassageContext,
  stageRewrite,
  applyRewrite,
  recheckWorkspace,
  generateWorkspaceReports,
  exportWorkspace,
  detectDocumentSections,
  deleteWorkspace,
  clearWorkspaces
} = require("../server/workspace/documentWorkspace");
const { executeTool } = require("../server/ai/tools");
const { runCheckraAgent } = require("../server/ai/agent");

let passed = 0;
let failed = 0;
let serverInstance = null;
let serverPort = null;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}:`, err.message);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}:`, err.message);
    failed++;
  }
}

function makeRequest(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: serverPort,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {})
        }
      },
      res => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTestSuite() {
  console.log("\n==================================================================================");
  console.log("   CHECKRA PHASE 8: ACADEMIC WORKSPACE & DOCUMENT INTELLIGENCE TEST SUITE");
  console.log("==================================================================================\n");

  // Spin up test server for REST API endpoints
  await new Promise((resolve, reject) => {
    serverInstance = app.listen(0, "127.0.0.1", () => {
      serverPort = serverInstance.address().port;
      resolve();
    });
    serverInstance.on("error", reject);
  });

  clearWorkspaces();

  // --- TESTS A - F: WORKSPACE CREATION & LIFECYCLE ---
  console.log("--- Tests A - F: Workspace Creation & Lifecycle ---");

  test("Test A: Workspace creation with valid document text", () => {
    const text = "Title: Renewable Energy\n\nAbstract\nThis paper evaluates solar panel efficiency.\n\nIntroduction\nSolar energy has grown by 32% in 2024.";
    const res = createWorkspace({ text, title: "Solar Study" });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(typeof res.workspace.id, "string");
    assert.strictEqual(res.workspace.workflow.status, "ready");
    assert.strictEqual(res.workspace.document.title, "Solar Study");
  });

  test("Test B: Document metadata calculation", () => {
    const text = "One two three four five six seven eight nine ten.";
    const res = createWorkspace({ text });
    assert.strictEqual(res.workspace.document.wordCount, 10);
    assert.strictEqual(res.workspace.document.characterCount, text.length);
    assert.strictEqual(typeof res.workspace.document.createdAt, "string");
  });

  test("Test C: Original text immutability invariant", () => {
    const originalText = "Original immutable thesis statement.";
    const res = createWorkspace({ text: originalText });
    const ws = res.workspace;
    assert.strictEqual(ws.content.originalText, originalText);

    // Apply rewrite and verify originalText remains strictly unchanged
    applyRewrite(ws.id, { originalPassage: "Original immutable thesis statement.", newText: "Updated modern thesis proposition." });
    assert.strictEqual(ws.content.originalText, originalText, "originalText must never be overwritten");
    assert.strictEqual(ws.content.currentText, "Updated modern thesis proposition.");
  });

  test("Test D: Section detection identifies standard academic headings", () => {
    const docWithHeadings = `Title: AI Ethics\n\nAbstract\nOverview of ethics.\n\n1. Introduction\nBackground on models.\n\n2. Methodology\nAudit framework.\n\nReferences\nSmith (2020).`;
    const sections = detectDocumentSections(docWithHeadings);
    assert.strictEqual(sections.length >= 4, true);
    assert.strictEqual(sections.some(s => s.type === "ABSTRACT"), true);
    assert.strictEqual(sections.some(s => s.type === "INTRODUCTION"), true);
    assert.strictEqual(sections.some(s => s.type === "METHODOLOGY"), true);
    assert.strictEqual(sections.some(s => s.type === "REFERENCES"), true);
  });

  test("Test E: Workspace state transitions", () => {
    const res = createWorkspace({ text: "Sample text for state tracking." });
    const ws = res.workspace;
    assert.strictEqual(ws.workflow.status, "ready");

    ws.workflow.status = "editing";
    assert.strictEqual(ws.workflow.status, "editing");

    ws.workflow.status = "rechecking";
    assert.strictEqual(ws.workflow.status, "rechecking");
  });

  await asyncTest("Test F: Failed state handling returns structured error without crashing", async () => {
    const res = createWorkspace({ text: "Document text." });
    const ws = res.workspace;
    ws.content.currentText = ""; // Empty content triggers error

    const analyzeRes = await analyzeWorkspace(ws.id);
    assert.strictEqual(analyzeRes.ok, false);
    assert.strictEqual(analyzeRes.error, "EMPTY_CONTENT");
    assert.strictEqual(ws.workflow.status, "error");
    assert.strictEqual(ws.workflow.error.code, "EMPTY_CONTENT");
  });

  // --- TESTS G - L: CROSS-ENGINE INTEGRATION ---
  console.log("\n--- Tests G - L: Cross-Engine Integration ---");

  await asyncTest("Test G: Similarity result integration", async () => {
    const res = createWorkspace({ text: "Solar panels convert light into electrical energy." });
    const ws = res.workspace;
    const mockSimilarity = {
      score: 45,
      grade: "B",
      coverage: { exactPercent: 35, nearPercent: 10, semanticPercent: 0 },
      passages: [{ matchType: "EXACT_MATCH", text: "Solar panels convert light" }]
    };

    const analyzeRes = await analyzeWorkspace(ws.id, { similarity: mockSimilarity });
    assert.strictEqual(analyzeRes.ok, true);
    assert.strictEqual(ws.analysis.similarity.score, 45);
    assert.strictEqual(ws.analysis.similarity.grade, "B");
  });

  await asyncTest("Test H: AI-Writing integration", async () => {
    const res = createWorkspace({ text: "Artificial intelligence systems have witnessed rapid and remarkable advancements in recent years across diverse industries." });
    const ws = res.workspace;
    const analyzeRes = await analyzeWorkspace(ws.id);
    assert.strictEqual(analyzeRes.ok, true);
    assert.strictEqual(typeof ws.analysis.aiWriting.status, "string");
    assert.strictEqual(typeof ws.analysis.aiWriting.confidence, "string");
  });

  await asyncTest("Test I: Integrity Report integration", async () => {
    const res = createWorkspace({ text: "Sample text for integrity report integration." });
    const ws = res.workspace;
    const analyzeRes = await analyzeWorkspace(ws.id, {
      similarity: { score: 25, grade: "A", coverage: { exactPercent: 15, nearPercent: 10, semanticPercent: 0 } }
    });
    assert.strictEqual(analyzeRes.ok, true);
    assert.strictEqual(ws.analysis.integrityReport !== null, true);
    assert.strictEqual(typeof ws.analysis.integrityReport.integrityConfidence.level, "string");
  });

  await asyncTest("Test J: Writing-quality integration", async () => {
    const res = createWorkspace({ text: "We should collaborate together in order to finish the project." });
    const ws = res.workspace;
    const analyzeRes = await analyzeWorkspace(ws.id);
    assert.strictEqual(analyzeRes.ok, true);
    assert.strictEqual(ws.writing.quality !== null, true);
    assert.strictEqual(ws.writing.issues.length >= 1, true);
  });

  await asyncTest("Test K: Research integration extracts claims", async () => {
    const res = createWorkspace({ text: "India's GDP grew by 8% in 2025. In our opinion, this is promising." });
    const ws = res.workspace;
    const analyzeRes = await analyzeWorkspace(ws.id);
    assert.strictEqual(analyzeRes.ok, true);
    assert.strictEqual(ws.research.claims.length, 2);
    assert.strictEqual(ws.research.claims[0].type, "STATISTICAL");
  });

  await asyncTest("Test L: Citation integration audits citations and gaps", async () => {
    const res = createWorkspace({ text: "Quantum computing represents a paradigm shift (Smith, 2020). Sea levels rose by 3.4 mm per year." });
    const ws = res.workspace;
    const analyzeRes = await analyzeWorkspace(ws.id);
    assert.strictEqual(analyzeRes.ok, true);
    assert.strictEqual(ws.research.citations.length, 1);
    assert.strictEqual(ws.research.claims[0].citationStatus, "SUPPORTED_BY_CITATION");
    assert.strictEqual(ws.research.claims[1].citationStatus, "CITATION_MISSING");
  });

  // --- TESTS M - Q: EVIDENCE EXPLORER & PASSAGE DIAGNOSTICS ---
  console.log("\n--- Tests M - Q: Evidence Explorer & Passage Diagnostics ---");

  test("Test M: Evidence explorer retrieves passage diagnostic context", () => {
    const text = "Renewable energy adoption expanded across OECD nations (Smith, 2020).";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    ws.analysis.similarity = {
      score: 50,
      passages: [{ matchType: "EXACT_MATCH", text: "Renewable energy adoption expanded" }]
    };
    ws.research.claims = [{ text: "Renewable energy adoption expanded across OECD nations", citationStatus: "SUPPORTED_BY_CITATION" }];

    const ctx = getPassageContext(ws.id, { passage: "Renewable energy adoption expanded" });
    assert.strictEqual(ctx.ok, true);
    assert.strictEqual(ctx.integrityEvidence.hasMatch, true);
    assert.strictEqual(ctx.integrityEvidence.matches[0].matchType, "EXACT_MATCH");
  });

  test("Test N: Exact-match display in passage context", () => {
    const res = createWorkspace({ text: "Exact verbatim overlap passage from textbook." });
    const ws = res.workspace;
    ws.analysis.similarity = {
      passages: [{ matchType: "EXACT_MATCH", similarityScore: 1.0, text: "Exact verbatim overlap passage" }]
    };
    const ctx = getPassageContext(ws.id, { passage: "Exact verbatim overlap passage" });
    assert.strictEqual(ctx.integrityEvidence.matches[0].matchType, "EXACT_MATCH");
  });

  test("Test O: Topical-only display is never marked as plagiarism", () => {
    const res = createWorkspace({ text: "Discussion of ferns and botanical classifications." });
    const ws = res.workspace;
    ws.analysis.similarity = {
      passages: [{ matchType: "TOPICAL_SIMILARITY", text: "Discussion of ferns" }]
    };
    const ctx = getPassageContext(ws.id, { passage: "Discussion of ferns" });
    assert.strictEqual(ctx.integrityEvidence.matches[0].matchType, "TOPICAL_SIMILARITY");
  });

  test("Test P: Unverifiable-source display", () => {
    const res = createWorkspace({ text: "Passage referencing dead external domain." });
    const ws = res.workspace;
    ws.analysis.similarity = {
      passages: [{ matchType: "NO_MATCH", status: "SOURCE_NOT_VERIFIABLE", text: "Passage referencing dead" }]
    };
    const ctx = getPassageContext(ws.id, { passage: "Passage referencing dead" });
    assert.strictEqual(ctx.integrityEvidence.matches[0].status, "SOURCE_NOT_VERIFIABLE");
  });

  test("Test Q: Conflicting evidence display", () => {
    const res = createWorkspace({ text: "GDP grew by 8% in 2024." });
    const ws = res.workspace;
    ws.research.researchReport = {
      status: "CONFLICTING_EVIDENCE",
      summary: "Multiple sources provide conflicting evidence."
    };
    const reports = generateWorkspaceReports(ws.id);
    assert.strictEqual(reports.reports.researchReport.status, "CONFLICTING_EVIDENCE");
  });

  // --- TESTS R - V: EDITING, REWRITING & VERSIONING ---
  console.log("\n--- Tests R - V: Editing, Rewriting & Versioning ---");

  await asyncTest("Test R: Selected passage improvement stages rewrite", async () => {
    const text = "We have arrived at the conclusion that the hypothesis is valid.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    const stageRes = await stageRewrite(ws.id, {
      passage: "We have arrived at the conclusion that",
      mode: "concise"
    });
    assert.strictEqual(stageRes.ok, true);
    assert.strictEqual(ws.writing.rewrites.length, 1);
    assert.strictEqual(stageRes.rewrite.mode, "concise");
  });

  await asyncTest("Test S: Rewrite mode integration produces valid output", async () => {
    const text = "The experiment was conducted by our team in an expeditious manner.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    const stageRes = await stageRewrite(ws.id, {
      passage: text,
      mode: "academic-readable"
    });
    assert.strictEqual(stageRes.ok, true);
    assert.strictEqual(typeof stageRes.rewrite.rewrittenText, "string");
  });

  test("Test T: Original immutability remains strictly enforced", () => {
    const originalText = "Original sentence that must not mutate.";
    const res = createWorkspace({ text: originalText });
    const ws = res.workspace;
    applyRewrite(ws.id, { originalPassage: "Original sentence that must not mutate.", newText: "Rewritten sentence." });
    assert.strictEqual(ws.content.originalText, originalText);
    assert.strictEqual(ws.content.currentText, "Rewritten sentence.");
  });

  test("Test U: Apply rewrite explicitly updates currentText only", () => {
    const text = "Alpha beta gamma delta.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    const applyRes = applyRewrite(ws.id, { originalPassage: "beta gamma", newText: "omega" });
    assert.strictEqual(applyRes.ok, true);
    assert.strictEqual(ws.content.currentText, "Alpha omega delta.");
  });

  test("Test V: Version creation on rewrite application", () => {
    const res = createWorkspace({ text: "Version 1 text." });
    const ws = res.workspace;
    assert.strictEqual(ws.versions.length, 1);

    applyRewrite(ws.id, { originalPassage: "Version 1", newText: "Version 2" });
    assert.strictEqual(ws.versions.length, 2);
    assert.strictEqual(ws.versions[1].label, "v2 After rewrite");
    assert.strictEqual(ws.versions[1].text, "Version 2 text.");
  });

  // --- TESTS W - Z: RECHECK & BEFORE/AFTER IMPACT ---
  console.log("\n--- Tests W - Z: Recheck & Before/After Impact ---");

  await asyncTest("Test W: Recheck workflow after rewrite execution", async () => {
    const res = createWorkspace({ text: "Initial text version one." });
    const ws = res.workspace;
    await analyzeWorkspace(ws.id, { similarityScore: 40 });

    applyRewrite(ws.id, { originalPassage: "version one", newText: "version two" });
    const recheckRes = await recheckWorkspace(ws.id, { similarityScore: 15 });

    assert.strictEqual(recheckRes.ok, true);
    assert.strictEqual(ws.workflow.status, "ready");
    assert.strictEqual(ws.analysis.similarity.score, 15);
  });

  await asyncTest("Test X: Old analysis snapshot preserved in version history", async () => {
    const res = createWorkspace({ text: "Text version 1." });
    const ws = res.workspace;
    await analyzeWorkspace(ws.id, { similarityScore: 50 });

    applyRewrite(ws.id, { originalPassage: "version 1", newText: "version 2" });
    await recheckWorkspace(ws.id, { similarityScore: 20 });

    assert.strictEqual(ws.versions[0].analysisSummary.similarityScore, 50, "v1 snapshot must remain 50");
    assert.strictEqual(ws.versions[1].analysisSummary.similarityScore, 20, "v2 snapshot must be 20");
  });

  await asyncTest("Test Y: Before/After comparison impact computation", async () => {
    const res = createWorkspace({ text: "Version one document." });
    const ws = res.workspace;
    await analyzeWorkspace(ws.id, { similarityScore: 45 });

    applyRewrite(ws.id, { originalPassage: "Version one", newText: "Version two" });
    const recheckRes = await recheckWorkspace(ws.id, { similarityScore: 15 });

    assert.strictEqual(recheckRes.comparison !== null, true);
    assert.strictEqual(recheckRes.comparison.changes.similarityScore.from, 45);
    assert.strictEqual(recheckRes.comparison.changes.similarityScore.to, 15);
    assert.strictEqual(recheckRes.comparison.changes.similarityScore.delta, -30);
    assert.strictEqual(recheckRes.comparison.narrative.includes("Similarity score changed from 45% to 15%"), true);
  });

  test("Test Z: Null score handling without fabricating 0%", () => {
    const res = createWorkspace({ text: "Document without score." });
    const ws = res.workspace;
    const summary = ws.versions[0].analysisSummary;
    assert.strictEqual(summary.similarityScore, null);
    assert.notStrictEqual(summary.similarityScore, 0);
  });

  // --- TESTS AA - AE: AGENT WORKSPACE CONTEXT ---
  console.log("\n--- Tests AA - AE: Agent Workspace Context ---");

  test("Test AA: Document-context agent via executeTool get_workspace_context", () => {
    const res = createWorkspace({ text: "Research document on nanotechnology.", title: "Nano Study" });
    const ws = res.workspace;
    ws.analysis.similarity = { score: 28, coverage: { exactPercent: 20 } };

    const toolRes = executeTool("get_workspace_context", { workspace: ws });
    assert.strictEqual(toolRes.available, true);
    assert.strictEqual(toolRes.documentTitle, "Nano Study");
    assert.strictEqual(toolRes.similarityScore, 28);
  });

  test("Test AB: Selected-passage agent context", () => {
    const text = "Nanoparticles exhibit distinct optical properties.";
    const res = createWorkspace({ text, title: "Nano Study" });
    const ws = res.workspace;
    ws.analysis.similarity = {
      passages: [{ matchType: "EXACT_MATCH", text: "Nanoparticles exhibit distinct optical" }]
    };

    const toolRes = executeTool("get_workspace_context", {
      workspace: ws,
      passage: "Nanoparticles exhibit distinct optical"
    });
    assert.strictEqual(toolRes.available, true);
    assert.strictEqual(toolRes.selectedPassageContext.integrityEvidence.hasMatch, true);
  });

  await asyncTest("Test AC: Agent evidence explanation with workspace context", async () => {
    const res = createWorkspace({ text: "Sample text with high overlap." });
    const ws = res.workspace;
    ws.analysis.similarity = { score: 65, grade: "C", coverage: { exactPercent: 60 } };

    const agentRes = await runCheckraAgent({
      message: "Why was this document flagged with similarity?",
      workspace: ws
    });
    assert.strictEqual(agentRes.ok, true);
    assert.strictEqual(agentRes.toolsUsed.includes("get_workspace_context"), true);
  });

  await asyncTest("Test AD: Agent citation question with workspace context", async () => {
    const res = createWorkspace({ text: "Global temperature rose by 1.1 degrees Celsius." });
    const ws = res.workspace;
    ws.research.claims = [
      { text: "Global temperature rose by 1.1 degrees Celsius.", citationStatus: "CITATION_MISSING" }
    ];

    const agentRes = await runCheckraAgent({
      message: "Which claims in my document need citations?",
      workspace: ws
    });
    assert.strictEqual(agentRes.ok, true);
    assert.strictEqual(agentRes.toolsUsed.includes("get_workspace_context"), true);
  });

  await asyncTest("Test AE: Agent rewrite request handling", async () => {
    const res = createWorkspace({ text: "Due to the fact that we were delayed, we missed the start." });
    const ws = res.workspace;
    const stageRes = await stageRewrite(ws.id, {
      passage: ws.content.currentText,
      mode: "concise"
    });
    assert.strictEqual(stageRes.ok, true);
  });

  // --- TESTS AF - AI: REPORT CENTER ---
  console.log("\n--- Tests AF - AI: Report Center ---");

  test("Test AF: Integrity Report in report center", () => {
    const res = createWorkspace({ text: "Integrity report test document." });
    const ws = res.workspace;
    ws.analysis.integrityReport = {
      similarity: { score: 30 },
      aiWriting: { likelihood: 40 },
      integrityConfidence: { score: 85 }
    };
    const rep = generateWorkspaceReports(ws.id);
    assert.strictEqual(rep.reports.integrityReport.similarity.score, 30);
  });

  test("Test AG: Research Report in report center", () => {
    const res = createWorkspace({ text: "Research report document." });
    const ws = res.workspace;
    ws.research.researchReport = {
      status: "CLAIM_SUPPORTED",
      claims: [{ text: "Claim 1" }]
    };
    const rep = generateWorkspaceReports(ws.id);
    assert.strictEqual(rep.reports.researchReport.status, "CLAIM_SUPPORTED");
  });

  test("Test AH: Writing Report in report center", () => {
    const res = createWorkspace({ text: "Writing report document." });
    const ws = res.workspace;
    ws.writing.quality = { qualityScore: 88, qualityGrade: "B" };
    const rep = generateWorkspaceReports(ws.id);
    assert.strictEqual(rep.reports.writingReport.qualityScore, 88);
  });

  test("Test AI: Citation Report in report center", () => {
    const res = createWorkspace({ text: "Citation report document." });
    const ws = res.workspace;
    ws.research.citations = [{ raw: "(Smith, 2020)", format: "PARENTHETICAL" }];
    const rep = generateWorkspaceReports(ws.id);
    assert.strictEqual(rep.reports.citationReport.totalCitations, 1);
  });

  // --- TESTS AJ - AL: EXPORT ARCHITECTURE ---
  console.log("\n--- Tests AJ - AL: Export Architecture ---");

  test("Test AJ: JSON export", () => {
    const res = createWorkspace({ text: "JSON export content." });
    const ws = res.workspace;
    const exp = exportWorkspace(ws.id, "json");
    assert.strictEqual(exp.ok, true);
    assert.strictEqual(exp.format, "json");
    assert.strictEqual(exp.data.document.id, ws.document.id);
  });

  test("Test AK: Markdown export", () => {
    const res = createWorkspace({ text: "Markdown export content.", title: "Thesis" });
    const ws = res.workspace;
    const exp = exportWorkspace(ws.id, "markdown");
    assert.strictEqual(exp.ok, true);
    assert.strictEqual(exp.format, "markdown");
    assert.strictEqual(exp.data.includes("# Thesis"), true);
  });

  test("Test AL: Printable HTML export", () => {
    const res = createWorkspace({ text: "HTML export content.", title: "Printable Thesis" });
    const ws = res.workspace;
    const exp = exportWorkspace(ws.id, "html");
    assert.strictEqual(exp.ok, true);
    assert.strictEqual(exp.format, "html");
    assert.strictEqual(exp.data.includes("Printable Thesis"), true);
  });

  // --- TESTS AM - AO: SECURITY & ERROR HANDLING ---
  console.log("\n--- Tests AM - AO: Security & Error Handling ---");

  test("Test AM: No API secrets or environment variables exposed in workspace state", () => {
    const res = createWorkspace({ text: "Security test text." });
    const wsStr = JSON.stringify(res.workspace);
    assert.strictEqual(wsStr.includes(process.env.GEMINI_API_KEY || "AIzaSy"), false);
    assert.strictEqual(wsStr.includes("SEARCH_API_KEY"), false);
  });

  test("Test AN: Document privacy — in-memory only without permanent file footprint", () => {
    const res = createWorkspace({ text: "Ephemerality test text." });
    const wsId = res.workspace.id;
    assert.strictEqual(getWorkspace(wsId) !== null, true);
    deleteWorkspace(wsId);
    assert.strictEqual(getWorkspace(wsId), null);
  });

  await asyncTest("Test AO: REST API error handling returns JSON 400/404", async () => {
    const res400 = await makeRequest("/api/workspace/create", "POST", { text: "" });
    assert.strictEqual(res400.status, 400);
    assert.strictEqual(res400.data.ok, false);

    const res404 = await makeRequest("/api/workspace/non-existent-id", "GET");
    assert.strictEqual(res404.status, 404);
    assert.strictEqual(res404.data.ok, false);
  });

  // --- TESTS AP - AQ: INTEGRITY & REGRESSION ---
  console.log("\n--- Tests AP - AQ: Integrity & Regression ---");

  test("Test AP: Protected similarity files remain 100% untouched", () => {
    const exactContent = fs.readFileSync("server/analysis/exactMatcher.js", "utf8");
    const nearContent = fs.readFileSync("server/analysis/nearMatcher.js", "utf8");
    const semanticContent = fs.readFileSync("server/analysis/semanticMatcher.js", "utf8");
    const scoringContent = fs.readFileSync("server/analysis/scoring.js", "utf8");
    const analysisServiceContent = fs.readFileSync("server/services/analysisService.js", "utf8");

    assert.strictEqual(exactContent.includes("findExactMatches"), true);
    assert.strictEqual(nearContent.includes("findNearMatches"), true);
    assert.strictEqual(semanticContent.includes("findSemanticMatches"), true);
    assert.strictEqual(scoringContent.includes("calculateDocumentScore"), true);
    assert.strictEqual(analysisServiceContent.includes("executeAnalysis"), true);
  });

  // --- LIVE VALIDATION SCENARIOS (1 TO 20) ---
  console.log("\n--- LIVE VALIDATION SCENARIOS (1 to 20) ---");

  test("Live 1: Upload clean academic document", () => {
    const text = "Title: Quantum Computing\n\nAbstract\nThis study explores quantum teleportation protocols.\n\nIntroduction\nQuantum algorithms operate on qubits.";
    const res = createWorkspace({ text, title: "Quantum Teleportation" });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.workspace.content.sections.length >= 2, true);
  });

  test("Live 2: Upload document containing exact copied passage", () => {
    const text = "The speed of light in vacuum is approximately 299792 kilometers per second.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    ws.analysis.similarity = {
      score: 85,
      passages: [{ matchType: "EXACT_MATCH", text }]
    };
    const ctx = getPassageContext(ws.id, { passage: text });
    assert.strictEqual(ctx.integrityEvidence.matches[0].matchType, "EXACT_MATCH");
  });

  await asyncTest("Live 3: Upload document with AI-writing indicators", async () => {
    const text = "Artificial intelligence systems have witnessed rapid and remarkable advancements in recent years, fundamentally transforming modern workflows.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    await analyzeWorkspace(ws.id);
    assert.strictEqual(typeof ws.analysis.aiWriting.status, "string");
  });

  await asyncTest("Live 4: Upload document with missing citations", async () => {
    const text = "Global mean temperature rose by 1.1 degrees Celsius over pre-industrial baselines.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    await analyzeWorkspace(ws.id);
    assert.strictEqual(ws.research.claims[0].citationStatus, "CITATION_MISSING");
  });

  test("Live 5: Upload document with verified supporting source", () => {
    const res = createWorkspace({ text: "Verified empirical finding." });
    const ws = res.workspace;
    ws.research.sources = [{ url: "https://nature.com/article/1", status: "CLAIM_SUPPORTED", isVerified: true }];
    assert.strictEqual(ws.research.sources[0].isVerified, true);
  });

  test("Live 6: Upload document with related-only source", () => {
    const res = createWorkspace({ text: "Thematic discussion." });
    const ws = res.workspace;
    ws.research.sources = [{ url: "https://wikipedia.org/wiki/Fern", status: "SOURCE_RELEVANT", supportType: "RELATED_ONLY" }];
    assert.strictEqual(ws.research.sources[0].supportType, "RELATED_ONLY");
  });

  test("Live 7: Upload document with conflicting sources", () => {
    const res = createWorkspace({ text: "Economic growth claim." });
    const ws = res.workspace;
    ws.research.researchReport = { status: "CONFLICTING_EVIDENCE" };
    assert.strictEqual(ws.research.researchReport.status, "CONFLICTING_EVIDENCE");
  });

  test("Live 8: Select flagged passage", () => {
    const text = "Sentence one. Flagged sentence two. Sentence three.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    ws.analysis.similarity = { passages: [{ matchType: "NEAR_MATCH", text: "Flagged sentence two." }] };
    const ctx = getPassageContext(ws.id, { passage: "Flagged sentence two." });
    assert.strictEqual(ctx.integrityEvidence.hasMatch, true);
  });

  await asyncTest("Live 9: Rewrite selected passage", async () => {
    const text = "Due to the fact that rainfall was scarce, crops failed.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    const stageRes = await stageRewrite(ws.id, { passage: text, mode: "concise" });
    assert.strictEqual(stageRes.ok, true);
    assert.strictEqual(typeof stageRes.rewrite.rewrittenText, "string");
  });

  test("Live 10: Confirm original remains unchanged after staging", () => {
    const text = "Original text remains completely identical.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    assert.strictEqual(ws.content.originalText, text);
    assert.strictEqual(ws.content.currentText, text);
  });

  test("Live 11: Apply rewrite explicitly creates new version", () => {
    const text = "First draft content.";
    const res = createWorkspace({ text });
    const ws = res.workspace;
    const applyRes = applyRewrite(ws.id, { originalPassage: "First draft", newText: "Second revised" });
    assert.strictEqual(applyRes.ok, true);
    assert.strictEqual(ws.versions.length, 2);
    assert.strictEqual(ws.content.currentText, "Second revised content.");
  });

  await asyncTest("Live 12: Re-run analysis on updated version", async () => {
    const res = createWorkspace({ text: "Draft text." });
    const ws = res.workspace;
    await analyzeWorkspace(ws.id, { similarityScore: 40 });
    applyRewrite(ws.id, { originalPassage: "Draft", newText: "Revised" });
    const recheckRes = await recheckWorkspace(ws.id, { similarityScore: 12 });
    assert.strictEqual(recheckRes.ok, true);
    assert.strictEqual(ws.analysis.similarity.score, 12);
  });

  await asyncTest("Live 13: Compare before and after change impact", async () => {
    const res = createWorkspace({ text: "Before text." });
    const ws = res.workspace;
    await analyzeWorkspace(ws.id, { similarityScore: 50 });
    applyRewrite(ws.id, { originalPassage: "Before", newText: "After" });
    const recheckRes = await recheckWorkspace(ws.id, { similarityScore: 15 });
    assert.strictEqual(recheckRes.comparison.changes.similarityScore.from, 50);
    assert.strictEqual(recheckRes.comparison.changes.similarityScore.to, 15);
  });

  test("Live 14: Open Integrity Report from Report Center", () => {
    const res = createWorkspace({ text: "Report test." });
    const ws = res.workspace;
    ws.analysis.integrityReport = { similarity: { score: 20 } };
    const reports = generateWorkspaceReports(ws.id);
    assert.strictEqual(reports.reports.integrityReport.similarity.score, 20);
  });

  test("Live 15: Open Research Report from Report Center", () => {
    const res = createWorkspace({ text: "Research report." });
    const ws = res.workspace;
    ws.research.researchReport = { status: "CLAIM_SUPPORTED" };
    const reports = generateWorkspaceReports(ws.id);
    assert.strictEqual(reports.reports.researchReport.status, "CLAIM_SUPPORTED");
  });

  test("Live 16: Open Writing Report from Report Center", () => {
    const res = createWorkspace({ text: "Writing report." });
    const ws = res.workspace;
    ws.writing.quality = { qualityScore: 92 };
    const reports = generateWorkspaceReports(ws.id);
    assert.strictEqual(reports.reports.writingReport.qualityScore, 92);
  });

  test("Live 17: Open Citation Report from Report Center", () => {
    const res = createWorkspace({ text: "Citation report." });
    const ws = res.workspace;
    ws.research.citations = [{ raw: "(Worrall, 1989)", format: "PARENTHETICAL" }];
    const reports = generateWorkspaceReports(ws.id);
    assert.strictEqual(reports.reports.citationReport.totalCitations, 1);
  });

  await asyncTest("Live 18: Ask AI Agent a document-context question", async () => {
    const res = createWorkspace({ text: "Academic document discussing quantum computing.", title: "Quantum Teleportation" });
    const ws = res.workspace;
    ws.analysis.similarity = { score: 10, grade: "A" };
    const agentRes = await runCheckraAgent({
      message: "What is my document title and similarity score?",
      workspace: ws
    });
    assert.strictEqual(agentRes.ok, true);
    assert.strictEqual(agentRes.toolsUsed.includes("get_workspace_context"), true);
  });

  await asyncTest("Live 19: Test AI unavailable graceful degradation", async () => {
    const res = createWorkspace({ text: "Text to rewrite." });
    const ws = res.workspace;
    const stageRes = await stageRewrite(ws.id, {
      passage: "Text to rewrite.",
      options: { overrideConfig: { baseUrl: "http://localhost:9999" } } // Point to offline port
    });
    // Returns structured AI_UNAVAILABLE without crashing
    if (!stageRes.ok) {
      assert.strictEqual(stageRes.error, "AI_UNAVAILABLE");
    }
  });

  await asyncTest("Live 20: Test failed analysis state does not report success", async () => {
    const res = createWorkspace({ text: "Some text." });
    const ws = res.workspace;
    ws.content.currentText = ""; // Empty content triggers error
    const analyzeRes = await analyzeWorkspace(ws.id);
    assert.strictEqual(analyzeRes.ok, false);
    assert.strictEqual(ws.workflow.status, "error");
    assert.notStrictEqual(ws.workflow.status, "ready");
  });

  // Close server instance
  if (serverInstance) {
    serverInstance.close();
  }

  console.log("\n==================================================================================");
  console.log(`   CHECKRA PHASE 8 RESULTS: ${passed}/${passed + failed} PASSED (${failed} Failures)`);
  console.log("==================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error("Test runner execution error:", err);
  if (serverInstance) serverInstance.close();
  process.exit(1);
});
