/**
 * VeriWrite REST API Server
 * Evidence-first writing integrity and similarity engine with Google Gemini integration.
 * No permanent history storage; session-only current document analysis.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const db = require("./db/database");
const logger = require("./utils/logger");
const { extractFromFile, calculateTextStats } = require("./document/extractor");
const { executeAnalysis } = require("./services/analysisService");
const { generateReportPackage, DISCLAIMER_TEXT, AI_DISCLAIMER_TEXT } = require("./reports/reportGenerator");
const { rewriteText, MODES } = require("./providers/rewriteProvider");
const { checkGrammar } = require("./providers/grammarProvider");
const { isGeminiConfigured, getGeminiModel, testGeminiConnection, testGeminiGrounding } = require("./services/geminiService");
const { checkAiHealth, generateAiCompletion } = require("./ai/model");
const { runCheckraAgent, runCheckraResearch } = require("./ai/agent");
const { detectAiWriting } = require("./ai/aiWritingDetector");
const { generateIntegrityReport } = require("./ai/evidenceFusion");
const { escapeHtml } = require("./utils/security");

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.static(path.join(__dirname, "../public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// GET /api/health — Diagnostic status of engine and configured providers
app.get("/api/health", async (req, res) => {
  const geminiReady = isGeminiConfigured();
  const searchApiUrl = process.env.SEARCH_API_URL;
  const searchEngine = process.env.SEARCH_ENGINE || (searchApiUrl?.includes(":8080") ? "SearXNG" : "Custom");
  const externalSearchReady = Boolean(searchApiUrl);
  const grammarReady = Boolean(process.env.GRAMMAR_API_URL);
  const embeddingReady = Boolean(process.env.EMBEDDING_API_URL);

  let geminiLive = null;
  let groundingLive = "UNAVAILABLE";
  let searxngLive = "NOT CONFIGURED";

  if (externalSearchReady) {
    try {
      const sRes = await fetch(searchApiUrl + "?q=test&format=json", { signal: AbortSignal.timeout(6000) });
      searxngLive = sRes.ok ? "CONNECTED" : `ERROR (HTTP ${sRes.status})`;
    } catch (e) {
      searxngLive = "DISCONNECTED";
    }
  }

  if (req.query.test === "1" && geminiReady) {
    geminiLive = await testGeminiConnection();
    try {
      const gTest = await testGeminiGrounding();
      groundingLive = gTest.available ? "AVAILABLE" : `UNAVAILABLE (${gTest.reason || "Quota exhausted"})`;
    } catch (e) {
      groundingLive = `UNAVAILABLE (${e.message})`;
    }
  } else if (geminiReady) {
    groundingLive = "UNAVAILABLE";
  } else {
    groundingLive = "NOT CONFIGURED";
  }

  res.json({
    ok: true,
    server: "OK",
    service: "Checkra AI Web Checker",
    gemini: geminiReady ? "CONFIGURED" : "NOT CONFIGURED",
    geminiModel: getGeminiModel(),
    geminiGrounding: groundingLive,
    externalSearch: externalSearchReady ? "CONFIGURED" : "NOT CONFIGURED",
    searchProvider: externalSearchReady ? (searchEngine.toLowerCase().includes("searx") ? "SearXNG" : searchEngine) : undefined,
    searchUrl: searchApiUrl || undefined,
    searxngStatus: searxngLive,
    externalSearchProvider: externalSearchReady ? (searchEngine.toLowerCase().includes("searx") ? "SearXNG" : searchEngine) : undefined,
    externalSearchUrl: searchApiUrl || undefined,
    geminiLiveStatus: geminiLive ? (geminiLive.ok ? "CONNECTED_OK" : `ERROR: ${geminiLive.error}`) : undefined,
    grammar: grammarReady ? "Configured (LanguageTool)" : "Built-in Linguistic Engine",
    embeddings: embeddingReady ? "Configured (API)" : "Local Mathematical Vectorizer",
    version: "2.5.0"
  });
});

// GET /api/ai/health — Diagnostic health of local Ollama / AI Provider
app.get("/api/ai/health", async (req, res) => {
  try {
    const health = await checkAiHealth();
    res.json(health);
  } catch (err) {
    logger.error("AI health check endpoint error", { error: err.message });
    res.json({
      ok: false,
      provider: "ollama",
      model: "qwen3:1.7b",
      configured: true,
      available: false,
      error: "OLLAMA_UNAVAILABLE"
    });
  }
});

// POST /api/ai/test — Development test endpoint for AI generation
app.post("/api/ai/test", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({
        ok: false,
        error: "EMPTY_PROMPT",
        message: "A non-empty prompt string is required."
      });
    }

    const result = await generateAiCompletion(prompt);
    res.json(result);
  } catch (err) {
    logger.error("AI test endpoint error", { error: err.message });
    res.status(500).json({
      ok: false,
      provider: "ollama",
      model: "qwen3:1.7b",
      error: "AI_GENERATION_FAILED"
    });
  }
});

// POST /api/agent — Checkra AI Agent reasoning orchestrator
app.post("/api/agent", async (req, res) => {
  try {
    const { message, analysis, text, passage } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_REQUEST",
        message: "A non-empty user message string is required."
      });
    }

    const agentResult = await runCheckraAgent({ message, analysis, text, passage });
    return res.json(agentResult);
  } catch (err) {
    logger.error("Agent orchestrator endpoint error", { error: err.message });
    return res.status(500).json({
      ok: false,
      error: "AGENT_EXECUTION_ERROR",
      message: "An error occurred while executing the AI agent."
    });
  }
});

// POST /api/agent/research — Dedicated web search and source verification endpoint
app.post("/api/agent/research", async (req, res) => {
  try {
    const { query, text, analysis, analysisId } = req.body || {};
    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_REQUEST",
        message: "A non-empty query string is required."
      });
    }
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_REQUEST",
        message: "A non-empty passage text string is required for source verification."
      });
    }

    const researchResult = await runCheckraResearch({ query, text, analysis, analysisId });
    return res.json(researchResult);
  } catch (err) {
    logger.error("Agent research endpoint error", { error: err.message });
    return res.status(500).json({
      ok: false,
      error: "AGENT_RESEARCH_ERROR",
      message: "An error occurred during web source research and verification."
    });
  }
});

// POST /api/ai-writing/analyze — Independent AI writing detection & stylometric likelihood
app.post("/api/ai-writing/analyze", async (req, res) => {
  try {
    const { text, options } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_REQUEST",
        message: "A non-empty text string is required for AI writing analysis."
      });
    }

    const aiWriting = await detectAiWriting(text, options || {});
    return res.json({
      ok: true,
      aiWriting
    });
  } catch (err) {
    logger.error("AI writing analyze endpoint error", { error: err.message });
    return res.status(500).json({
      ok: false,
      error: "AI_WRITING_ANALYSIS_ERROR",
      message: "An error occurred during AI writing detection."
    });
  }
});

// POST /api/integrity-report — Unified evidence fusion & integrity report
app.post("/api/integrity-report", async (req, res) => {
  try {
    const { analysisId, analysis, research, aiWriting, text, options } = req.body || {};

    if (!analysisId && !analysis && !research && !aiWriting && !text) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_REQUEST",
        message: "An analysis object, analysisId, research, or text is required."
      });
    }

    if (analysisId && !analysis && !research && !aiWriting && !text) {
      const sessionAnalysis = db.getSessionAnalysis(analysisId);
      if (!sessionAnalysis) {
        return res.status(404).json({
          ok: false,
          error: "ANALYSIS_NOT_FOUND",
          message: `Analysis session '${analysisId}' was not found or has expired.`
        });
      }
    }

    let resolvedAnalysis = analysis;
    let resolvedAiWriting = aiWriting;

    if (text && !resolvedAnalysis) {
      try {
        const currentSettings = db.getSettings();
        const mergedOptions = { ...currentSettings, ...options };
        resolvedAnalysis = await executeAnalysis({
          text,
          title: req.body?.title || "Research Document",
          filename: "document.txt",
          fileStats: calculateTextStats(text, "document.txt"),
          options: mergedOptions
        });
      } catch (err) {
        logger.debug("Automatic text analysis fallback error", { error: err.message });
      }
    }

    if (text && !resolvedAiWriting) {
      try {
        resolvedAiWriting = await detectAiWriting(text, { skipQualitative: true });
      } catch (err) {
        logger.debug("Automatic AI writing fallback error", { error: err.message });
      }
    }

    const fusionResult = generateIntegrityReport({
      analysisId,
      analysis: resolvedAnalysis,
      research,
      aiWriting: resolvedAiWriting
    });

    if (!fusionResult.ok) {
      return res.status(400).json(fusionResult);
    }

    return res.json(fusionResult);
  } catch (err) {
    logger.error("Integrity report endpoint error", { error: err.message });
    return res.status(500).json({
      ok: false,
      error: "INTEGRITY_REPORT_ERROR",
      message: "An error occurred while generating the unified integrity report."
    });
  }
});

// POST /api/extract — Multipart file extraction for PDF, DOCX, TXT, MD, HTML
app.post("/api/extract", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: "NO_FILE", message: "No file was uploaded." }
      });
    }

    const t0 = Date.now();
    const extracted = await extractFromFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    const tExtraction = Date.now() - t0;
    console.log(`[Checkra] extraction: ${tExtraction} ms`);

    res.json({
      success: true,
      text: extracted.rawText,
      rawText: extracted.rawText,
      ...extracted
    });
  } catch (err) {
    logger.error("Document extraction error", { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: "DOCUMENT_EXTRACTION_FAILED", message: err.message }
    });
  }
});

// POST /api/analyze — Execute decoupled 10-step integrity analysis
app.post("/api/analyze", async (req, res) => {
  try {
    const { text, title, filename, fileStats, options = {}, referenceText, referenceTitle } = req.body || {};
    if (!text || text.trim().length < 20) {
      return res.status(400).json({
        success: false,
        error: {
          code: "DOCUMENT_TOO_SHORT",
          message: "Document text is too short. Please provide at least 20 characters."
        }
      });
    }

    const currentSettings = db.getSettings();
    const mergedOptions = { ...currentSettings, ...options };
    if (referenceText) mergedOptions.referenceText = referenceText;
    if (referenceTitle) mergedOptions.referenceTitle = referenceTitle;

    const result = await executeAnalysis({
      text,
      title: title || "Research Document",
      filename: filename || "document.txt",
      fileStats: fileStats || calculateTextStats(text, filename),
      options: mergedOptions
    });

    try {
      result.aiWriting = await detectAiWriting(text, { skipQualitative: true });
    } catch (aiErr) {
      logger.debug("AI writing detection attachment skipped", { error: aiErr.message });
    }

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    logger.error("Analysis execution error", { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message }
    });
  }
});

// POST /api/analysis/:id/retry-ai-review — Retry ONLY the Gemini AI review without re-running search or scoring
app.post("/api/analysis/:id/retry-ai-review", async (req, res) => {
  try {
    const analysisId = req.params.id;
    const analysis = db.getSessionAnalysis(analysisId);
    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: { code: "SESSION_EXPIRED", message: "Analysis session expired. Please re-run document check." }
      });
    }

    const passages = (analysis.matchedPassages || []).filter(p =>
      p.type === "EXACT" || p.type === "NEAR" || p.type === "SEMANTIC" || p.type === "POSSIBLE"
    );

    if (passages.length === 0) {
      const reviewResult = {
        status: "SUCCESS",
        state: "COMPLETED",
        available: true,
        retryable: false,
        message: "No candidate matching passages detected to review. Content appears independently written.",
        items: []
      };
      analysis.aiReview = reviewResult;
      db.setSessionAnalysis(analysis);
      return res.json({ success: true, aiReview: reviewResult });
    }

    const { reviewEvidenceWithAI } = require("./providers/aiReviewProvider");
    const reviewResult = await reviewEvidenceWithAI(passages.slice(0, 10));

    // Update session analysis with fresh AI review results without touching scores or sources
    analysis.aiReview = reviewResult;
    db.setSessionAnalysis(analysis);

    return res.json({
      success: reviewResult.status === "SUCCESS" || reviewResult.status === "completed",
      aiReview: reviewResult
    });
  } catch (err) {
    logger.error("Retry AI Review error", { error: err.message });
    return res.status(500).json({
      success: false,
      error: { code: "RETRY_FAILED", message: "AI Evidence Review retry encountered an error." },
      aiReview: {
        status: "UNAVAILABLE",
        state: "AI_REVIEW_UNAVAILABLE",
        available: false,
        retryable: true,
        message: "Gemini is currently experiencing high demand. Your similarity analysis and web-source matching are still available.",
        items: []
      }
    });
  }
});

// POST /api/rewrite — AI Writing Improvement using Gemini
app.post("/api/rewrite", async (req, res) => {
  try {
    const { text, mode } = req.body || {};
    const result = await rewriteText(text, mode || "clear-natural");
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    logger.error("Rewrite controller error", { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: "REWRITE_FAILED", message: err.message }
    });
  }
});

// GET /api/rewrite/modes
app.get("/api/rewrite/modes", (req, res) => {
  res.json({ success: true, modes: MODES });
});

// POST /api/grammar — Independent writing quality and grammar checks
app.post("/api/grammar", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: "EMPTY_TEXT", message: "No text provided for grammar check." }
      });
    }
    const result = await checkGrammar(text, db.getSettings());
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    logger.error("Grammar check error", { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: "GRAMMAR_CHECK_FAILED", message: err.message }
    });
  }
});

// POST /api/report — Generate report package directly from current session analysis
app.post("/api/report", async (req, res) => {
  try {
    const analysis = req.body;
    if (!analysis || !analysis.id) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_ANALYSIS", message: "Analysis payload required." }
      });
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const pkg = await generateReportPackage(analysis, baseUrl);
    res.json({ success: true, ...pkg });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: "REPORT_FAILED", message: err.message }
    });
  }
});

// GET /api/reports/:id/html — Render active session report
app.get("/api/reports/:id/html", async (req, res) => {
  try {
    const analysis = db.getSessionAnalysis(req.params.id);
    if (!analysis) {
      return res.status(404).send(`
        <!doctype html>
        <html>
        <head><title>Checkra — Session Expired</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:sans-serif;text-align:center;padding:50px;background:#050505;color:#f4f4f5;}.card{background:#0c0c12;max-width:540px;margin:auto;padding:36px;border-radius:16px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 20px 50px rgba(0,0,0,0.5);}</style>
        </head>
        <body>
          <div class="card">
            <h2>Current Analysis Session Expired</h2>
            <p style="color:#a1a1aa; line-height:1.6;">Checkra operates in session-only mode and does not retain permanent history. Please re-run the document analysis in your workspace to generate a fresh report.</p>
            <a href="/" style="display:inline-block; margin-top:16px; padding:10px 18px; background:#7c3aed; color:#fff; text-decoration:none; border-radius:8px; font-weight:700;">Return to Workspace</a>
          </div>
        </body>
        </html>
      `);
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const pkg = await generateReportPackage(analysis, baseUrl);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(pkg.htmlReport);
  } catch (err) {
    res.status(500).send(`Report generation failed: ${err.message}`);
  }
});

// GET /api/reports/:id/json — Download JSON evidence for current session
app.get("/api/reports/:id/json", async (req, res) => {
  try {
    const analysis = db.getSessionAnalysis(req.params.id);
    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: { code: "SESSION_EXPIRED", message: "Analysis session expired." }
      });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const pkg = await generateReportPackage(analysis, baseUrl);
    res.setHeader("Content-Disposition", `attachment; filename="checkra-evidence-${analysis.id}.json"`);
    res.json(pkg.jsonEvidence);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /api/test-document — Built-in test document for development verification
app.get("/api/test-document", (req, res) => {
  try {
    const testDocPath = path.join(__dirname, "../data/test-document.json");
    if (fs.existsSync(testDocPath)) {
      const data = JSON.parse(fs.readFileSync(testDocPath, "utf8"));
      return res.json({ success: true, ...data });
    }
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Test document not found." } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /api/settings & POST /api/settings
app.get("/api/settings", (req, res) => {
  try {
    const s = db.getSettings();
    const masked = { ...s };
    if (masked.searchApiKey) masked.searchApiKey = "••••••••" + masked.searchApiKey.slice(-4);
    if (masked.grammarApiKey) masked.grammarApiKey = "••••••••" + masked.grammarApiKey.slice(-4);
    if (masked.embeddingApiKey) masked.embeddingApiKey = "••••••••" + masked.embeddingApiKey.slice(-4);
    res.json({ success: true, settings: masked, geminiConfigured: isGeminiConfigured(), geminiModel: getGeminiModel() });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    const updates = req.body || {};
    const sanitized = {};
    for (const [key, val] of Object.entries(updates)) {
      if (typeof val === "string" && val.startsWith("••••••••")) continue;
      sanitized[key] = val;
    }
    const updated = db.updateSettings(sanitized);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// Public Verification Page: /verify/:id
app.get("/verify/:id", (req, res) => {
  const analysis = db.getSessionAnalysis(req.params.id);
  if (!analysis) {
    return res.status(404).send(`
      <!doctype html>
      <html>
      <head><title>Checkra — Seal Expired or Not Found</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:50px;background:#050505;color:#f4f4f5;}.card{background:#0c0c12;max-width:520px;margin:auto;padding:34px;border-radius:16px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 20px 50px rgba(0,0,0,0.5);}</style>
      </head>
      <body>
        <div class="card">
          <h2>Verification Seal Expired or Not Found</h2>
          <p style="color:#a1a1aa; line-height:1.6;">Analysis ID <strong>${escapeHtml(req.params.id)}</strong> was either in a previous session or has expired. In accordance with Checkra privacy guidelines, analysis results are held in session memory only.</p>
          <div style="margin-top:20px; padding-top:14px; border-top:1px solid rgba(255,255,255,0.08);">
            <a href="https://nivora-niva.vercel.app/" target="_blank" rel="noopener noreferrer" style="color:#a1a1aa; text-decoration:none; font-size:11px; display:inline-flex; align-items:center; gap:6px;">
              <img src="/nivora-logo.png" style="height:14px; width:auto;" alt="NIVORA">
              <span>Checkra — A NIVORA Product</span>
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkra Verification Seal — ${escapeHtml(analysis.id)}</title>
<link rel="icon" href="/favicon.png">
<style>
  :root { --bg:#050505; --card:#0c0c12; --line:rgba(255,255,255,0.08); --violet:#7c3aed; --violet-light:#a78bfa; --green:#10b981; --text:#ffffff; --text-muted:#a1a1aa; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; box-sizing: border-box; }
  .cert-card { background: var(--card); width: 100%; max-width: 580px; border-radius: 20px; border: 1px solid var(--line); box-shadow: 0 20px 60px rgba(0,0,0,0.6); padding: 36px; text-align: center; }
  .logo-img { height: 44px; object-fit: contain; margin-bottom: 18px; }
  .badge-verified { display: inline-flex; align-items: center; gap: 6px; background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; margin-bottom: 12px; border: 1px solid rgba(16, 185, 129, 0.3); }
  h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: -0.5px; }
  .subtitle { font-size: 12px; color: var(--text-muted); margin-bottom: 22px; }
  .score-circle { width: 110px; height: 110px; border-radius: 50%; background: conic-gradient(var(--violet) 0% ${analysis.similarity?.score || 0}%, #1e1e2d ${analysis.similarity?.score || 0}% 100%); margin: 0 auto 16px; display: grid; place-items: center; position: relative; }
  .score-circle::after { content: "${analysis.similarity?.score || 0}%"; width: 88px; height: 88px; border-radius: 50%; background: var(--card); display: grid; place-items: center; font-size: 22px; font-weight: 900; color: var(--text); }
  .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: left; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin: 18px 0; font-size: 11px; }
  .details-grid div b { display: block; font-size: 9px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 2px; letter-spacing: 0.5px; }
  .disclaimer { font-size: 10px; color: var(--text-muted); line-height: 1.5; margin-top: 18px; text-align: left; border-top: 1px solid var(--line); padding-top: 14px; }
  .btn-view { display: inline-block; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 11px; font-weight: 700; margin-top: 12px; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4); }
</style>
</head>
<body>
  <div class="cert-card">
    <img src="/checkra-logo.png" class="logo-img" alt="Checkra">
    <div><span class="badge-verified">✓ AUTHENTIC INTEGRITY RECORD</span></div>
    <h1>Writing Integrity Verification</h1>
    <div class="subtitle">Evidence-based session integrity verification record</div>

    <div class="score-circle"></div>
    <div style="font-weight: 800; font-size: 12px; color: var(--violet-light); margin-bottom: 12px;">
      Checkra Similarity Grade: Grade ${escapeHtml(analysis.similarity?.grade || "A")}
    </div>

    <div class="details-grid">
      <div><b>Analysis ID</b> ${escapeHtml(analysis.id)}</div>
      <div><b>Analysis Date</b> ${new Date(analysis.createdAt).toLocaleDateString()}</div>
      <div><b>Document Title</b> ${escapeHtml(analysis.document?.title || "Untitled")}</div>
      <div><b>Word Count</b> ${Number(analysis.document?.wordCount || 0).toLocaleString()} words</div>
      <div><b>Web Sources Retrieved</b> ${analysis.sources?.retrievedCount ?? analysis.sources?.reviewed ?? 0} sources</div>
      <div><b>Verified Matching Sources</b> ${analysis.sources?.matchingCount ?? analysis.sources?.items?.length ?? 0} sources</div>
      <div><b>Web Check Mode</b> ${escapeHtml(analysis.webCheckMode || "Local Comparison")}</div>
    </div>

    <a href="/api/reports/${escapeHtml(analysis.id)}/html" target="_blank" class="btn-view">View Complete Integrity Report →</a>

    <div class="disclaimer">
      <strong>Privacy Notice:</strong> In accordance with Checkra academic integrity standards, the full submitted text is not stored or made public. This seal confirms the verified score and source count for this session.
    </div>

    <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: center;">
      <a href="https://nivora-niva.vercel.app/" target="_blank" rel="noopener noreferrer" style="color: var(--text-muted); text-decoration: none; font-size: 11px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px;">
        <img src="/nivora-logo.png" alt="NIVORA" style="height: 14px; width: auto; object-fit: contain;">
        <span>Checkra — A NIVORA Product</span>
      </a>
    </div>
  </div>
</body>
</html>`;

  res.send(html);
});

// Express Error Handling Middleware - guarantees JSON response for API errors
app.use((err, req, res, next) => {
  logger.error("Unhandled express error", { error: err.message, stack: err.stack });
  if (res.headersSent) {
    return next(err);
  }
  res.setHeader("Content-Type", "application/json");
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "An unexpected error occurred during processing."
    }
  });
});

// Catch-all: SPA index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const PORT = Number(process.env.PORT || 8787);
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Checkra running at http://localhost:${PORT}`);
    logger.info("Server started", { port: PORT, gemini: isGeminiConfigured() });
  });
}

module.exports = app;
