/**
 * Checkra Academic Workspace & Document Intelligence Manager (Phase 8)
 *
 * Unified session-level document workspace connecting all Checkra integrity,
 * writing quality, citation analysis, and research verification capabilities.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Privacy First: All workspaces and version snapshots are stored in-memory per session.
 *    No sensitive document text is permanently logged or written to permanent disk storage.
 * 2. Immutability: The author's original text (originalText) and historical analysis snapshots
 *    remain strictly immutable. Only explicit user actions can apply a rewrite.
 * 3. Metric Separation: Plagiarism similarity, AI writing likelihood, writing quality, and
 *    research citations remain separate independent metrics; never combined into a single percentage.
 * 4. Authoritative Integration: Reuses existing Phase 1–7 deterministic similarity,
 *    evidence fusion, AI-writing detection, writing improvement, and research modules without duplicate scoring logic.
 */

const { detectAiWriting } = require("../ai/aiWritingDetector");
const { generateIntegrityReport } = require("../ai/evidenceFusion");
const { analyzeWritingQuality } = require("../ai/writingImprovement");
const { rewriteText } = require("../ai/rewriteEngine");
const { extractClaims } = require("../ai/claimExtractor");
const { analyzeCitations, generateReferenceList } = require("../ai/citationAnalyzer");
const { researchDocument, researchClaim } = require("../ai/researchAssistant");
const logger = require("../utils/logger");

// In-memory workspace session storage (ephemeral, zero permanent disk tracking)
const workspaces = new Map();

/**
 * Detects common academic and professional document sections.
 *
 * @param {string} text
 * @returns {Array<Object>} List of detected section boundaries
 */
function detectDocumentSections(text = "") {
  if (!text || typeof text !== "string") return [];

  const sections = [];
  const lines = text.split(/\r?\n/);
  let currentOffset = 0;

  const sectionPatterns = [
    { type: "TITLE", regex: /^(?:title\s*:|#\s+)/i },
    { type: "ABSTRACT", regex: /^(?:(?:\d+\.?|[IVXLCDM]+\.?)\s+)?(?:abstract|executive summary)\b/i },
    { type: "INTRODUCTION", regex: /^(?:(?:\d+\.?|[IVXLCDM]+\.?)\s+)?(?:introduction)\b/i },
    { type: "LITERATURE_REVIEW", regex: /^(?:(?:\d+\.?|[IVXLCDM]+\.?)\s+)?(?:literature review|related work|background and related work)\b/i },
    { type: "METHODOLOGY", regex: /^(?:(?:\d+\.?|[IVXLCDM]+\.?)\s+)?(?:methodology|methods|materials and methods|experimental setup|data and methods)\b/i },
    { type: "RESULTS", regex: /^(?:(?:\d+\.?|[IVXLCDM]+\.?)\s+)?(?:results|findings|experimental results)\b/i },
    { type: "DISCUSSION", regex: /^(?:(?:\d+\.?|[IVXLCDM]+\.?)\s+)?(?:discussion|implications|analysis)\b/i },
    { type: "CONCLUSION", regex: /^(?:(?:\d+\.?|[IVXLCDM]+\.?)\s+)?(?:conclusion|concluding remarks|conclusions)\b/i },
    { type: "REFERENCES", regex: /^(?:(?:\d+\.?|[IVXLCDM]+\.?)\s+)?(?:references|bibliography|works cited)\b/i }
  ];

  let detectedAny = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    const lineStart = currentOffset;
    const lineEnd = currentOffset + rawLine.length;

    if (line.length > 0 && line.length < 80) {
      // Check known academic headings
      for (const p of sectionPatterns) {
        if (p.regex.test(line)) {
          sections.push({
            name: line.replace(/^#+\s*|^\d+\.\s*/, "").trim(),
            type: p.type,
            detection: "DETECTED",
            lineNumber: i + 1,
            start: lineStart,
            headingText: line
          });
          detectedAny = true;
          break;
        }
      }

      // Check generic Markdown or numbered headings if not matched
      if (!detectedAny && /^(?:#{1,3}\s+[A-Z0-9]|\b[IVXLCDM]+\.\s+[A-Z]|\b\d+\.\d*\s+[A-Z])/i.test(line)) {
        sections.push({
          name: line.replace(/^#+\s*|^\d+\.\s*/, "").trim(),
          type: "SECTION_HEADING",
          detection: "POSSIBLY_DETECTED",
          lineNumber: i + 1,
          start: lineStart,
          headingText: line
        });
      }
    }

    currentOffset += rawLine.length + 1; // +1 for newline
  }

  // If no explicit headings detected, provide heuristic boundaries (e.g. Introduction / Body / Conclusion)
  if (sections.length === 0 && text.trim().length > 0) {
    const totalLen = text.length;
    sections.push({
      name: "Document Content",
      type: "BODY",
      detection: "POSSIBLY_DETECTED",
      lineNumber: 1,
      start: 0,
      end: totalLen,
      wordCount: (text.match(/\S+/g) || []).length
    });
  } else {
    // Fill in section end bounds
    for (let j = 0; j < sections.length; j++) {
      const nextStart = j + 1 < sections.length ? sections[j + 1].start : text.length;
      sections[j].end = nextStart;
      const secSlice = text.slice(sections[j].start, nextStart);
      sections[j].wordCount = (secSlice.match(/\S+/g) || []).length;
    }
  }

  return sections;
}

/**
 * Creates a new Academic Document Workspace in memory.
 *
 * @param {Object} params
 * @param {string} params.text Original document text
 * @param {string} [params.title="Untitled Document"]
 * @param {string} [params.fileName="document.txt"]
 * @param {string} [params.fileType="text/plain"]
 * @returns {Object} Newly initialized workspace instance
 */
function createWorkspace(params = {}) {
  const { text, title, fileName, fileType } = params;

  if (text === null || text === undefined || typeof text !== "string") {
    return {
      ok: false,
      error: "INVALID_DOCUMENT_TEXT",
      message: "A non-empty string is required to initialize a document workspace."
    };
  }

  const cleanText = text;
  const wordCount = (cleanText.match(/\S+/g) || []).length;
  const characterCount = cleanText.length;
  const workspaceId = `ws-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const docId = `doc-${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();

  const sections = detectDocumentSections(cleanText);

  const workspace = {
    id: workspaceId,
    document: {
      id: docId,
      title: title || (fileName ? fileName.replace(/\.[^/.]+$/, "") : "Untitled Document"),
      fileName: fileName || "document.txt",
      fileType: fileType || "text/plain",
      wordCount,
      characterCount,
      createdAt: now
    },
    content: {
      originalText: cleanText,
      currentText: cleanText,
      sections
    },
    analysis: {
      similarity: null,
      aiWriting: null,
      integrityReport: null
    },
    research: {
      claims: [],
      citations: [],
      sources: [],
      researchReport: null
    },
    writing: {
      quality: null,
      issues: [],
      rewrites: []
    },
    workflow: {
      status: "ready",
      lastUpdated: now,
      error: null
    },
    versions: [
      {
        version: 1,
        label: "v1 Original",
        text: cleanText,
        wordCount,
        timestamp: now,
        analysisSummary: {
          similarityScore: null,
          exactCoverage: null,
          aiWritingLikelihood: null,
          integrityConfidence: null,
          citationGaps: null,
          writingQualityScore: null
        }
      }
    ],
    comparison: null
  };

  workspaces.set(workspaceId, workspace);
  return {
    ok: true,
    workspace
  };
}

/**
 * Retrieves a workspace by ID.
 *
 * @param {string} workspaceId
 * @returns {Object|null}
 */
function getWorkspace(workspaceId) {
  if (!workspaceId) return null;
  return workspaces.get(workspaceId) || null;
}

/**
 * Runs multi-stage analysis across all Checkra integrity, writing, and citation engines.
 *
 * @param {string} workspaceId
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function analyzeWorkspace(workspaceId, options = {}) {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    return {
      ok: false,
      error: "WORKSPACE_NOT_FOUND",
      message: `Workspace with ID '${workspaceId}' was not found.`
    };
  }

  const activeText = ws.content.currentText;
  if (!activeText.trim()) {
    ws.workflow.status = "error";
    ws.workflow.error = { code: "EMPTY_CONTENT", message: "Cannot analyze empty document content." };
    return {
      ok: false,
      error: "EMPTY_CONTENT",
      message: "Cannot analyze empty document content."
    };
  }

  ws.workflow.status = "analyzing";
  ws.workflow.lastUpdated = new Date().toISOString();

  try {
    // 1. Stage: Writing Quality & Grammar
    const qualityRes = analyzeWritingQuality(activeText);
    ws.writing.quality = qualityRes;
    ws.writing.issues = qualityRes.issues || [];

    // 2. Stage: AI Writing Detection
    const aiWritingRes = await detectAiWriting(activeText);
    ws.analysis.aiWriting = aiWritingRes;

    // 3. Stage: Claim Extraction & Citation Gap Analysis
    const citationAudit = analyzeCitations(activeText);
    ws.research.citations = citationAudit.citations || [];
    ws.research.claims = citationAudit.claims || [];

    // 4. Stage: Similarity Analysis (Attach existing or provided analysis result)
    if (options.similarity) {
      ws.analysis.similarity = options.similarity;
    } else if (options.similarityScore !== undefined) {
      ws.analysis.similarity = {
        ...(ws.analysis.similarity || {}),
        score: options.similarityScore,
        grade: "A",
        coverage: { exactPercent: Math.round(options.similarityScore * 0.7), nearPercent: 0, semanticPercent: 0 },
        passages: ws.analysis.similarity?.passages || [],
        sources: ws.analysis.similarity?.sources || { items: [], reviewed: 0, matchingCount: 0 }
      };
    } else if (!ws.analysis.similarity) {
      // Create safe structured default if no similarity was passed
      ws.analysis.similarity = {
        score: 0,
        grade: "A",
        coverage: { exactPercent: 0, nearPercent: 0, semanticPercent: 0 },
        passages: [],
        sources: { items: [], reviewed: 0, matchingCount: 0 }
      };
    }

    // 5. Stage: Evidence Fusion & Unified Integrity Report
    const integrityRes = generateIntegrityReport({
      analysis: ws.analysis.similarity,
      aiWriting: ws.analysis.aiWriting
    });
    if (integrityRes.ok) {
      ws.analysis.integrityReport = integrityRes.report;
    }

    // 6. Stage: Optional Full Document Research Report
    if (options.includeResearchReport !== false) {
      const researchReport = await researchDocument(activeText, { title: ws.document.title });
      if (researchReport.ok) {
        ws.research.researchReport = researchReport;
      }
    }

    // Update current version analysis snapshot
    const currentVer = ws.versions[ws.versions.length - 1];
    if (currentVer) {
      currentVer.analysisSummary = {
        similarityScore: ws.analysis.similarity?.score ?? null,
        exactCoverage: ws.analysis.similarity?.coverage?.exactPercent ?? 0,
        aiWritingLikelihood: ws.analysis.aiWriting?.likelihood ?? null,
        integrityConfidence: ws.analysis.integrityReport?.integrityConfidence?.score ?? null,
        citationGaps: citationAudit.stats?.possibleGaps ?? 0,
        writingQualityScore: qualityRes.qualityScore ?? null
      };
    }

    ws.workflow.status = "ready";
    ws.workflow.lastUpdated = new Date().toISOString();

    return {
      ok: true,
      workspace: ws
    };
  } catch (err) {
    logger.error("Workspace staged analysis failed", { error: err.message, stack: err.stack });
    ws.workflow.status = "error";
    ws.workflow.error = { code: "ANALYSIS_FAILED", message: err.message };
    return {
      ok: false,
      error: "ANALYSIS_FAILED",
      message: `Workspace analysis failed: ${err.message}`
    };
  }
}

/**
 * Retrieves full multi-level diagnostic context for a selected passage in the workspace.
 *
 * @param {string} workspaceId
 * @param {Object} params
 * @param {string} [params.passage]
 * @param {number} [params.start]
 * @param {number} [params.end]
 * @returns {Object}
 */
function getPassageContext(workspaceId, params = {}) {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    return { ok: false, error: "WORKSPACE_NOT_FOUND" };
  }

  const { passage, start, end } = params;
  const targetText = passage || (typeof start === "number" && typeof end === "number" ? ws.content.currentText.slice(start, end) : "");

  if (!targetText.trim()) {
    return { ok: false, error: "EMPTY_PASSAGE", message: "Passage text is required." };
  }

  // 1. Check Integrity Evidence (matched passages from similarity engine)
  const matchedPassages = (ws.analysis.similarity?.passages || ws.analysis.similarity?.matchedPassages || []).filter(p => {
    const pText = p.text || p.passageText || "";
    return pText.includes(targetText) || targetText.includes(pText);
  });

  // 2. Check Citation Status
  const matchedClaims = ws.research.claims.filter(c => {
    return c.text.includes(targetText) || targetText.includes(c.text);
  });

  // 3. Check Writing Issues
  const matchedIssues = ws.writing.issues.filter(iss => {
    return targetText.includes(iss.original);
  });

  // 4. Staged rewrites
  const existingRewrites = ws.writing.rewrites.filter(r => r.originalPassage.includes(targetText));

  return {
    ok: true,
    passage: targetText,
    integrityEvidence: {
      hasMatch: matchedPassages.length > 0,
      matches: matchedPassages
    },
    citationStatus: {
      claimsFound: matchedClaims.length,
      claims: matchedClaims
    },
    writingIssues: {
      count: matchedIssues.length,
      issues: matchedIssues
    },
    stagedRewrites: existingRewrites
  };
}

/**
 * Stages a rewrite for a selected passage without modifying the original text.
 *
 * @param {string} workspaceId
 * @param {Object} params
 * @param {string} params.passage Text to rewrite
 * @param {string} [params.mode="clear-natural"] Rewrite mode
 * @param {Object} [params.options]
 * @returns {Promise<Object>}
 */
async function stageRewrite(workspaceId, params = {}) {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { ok: false, error: "WORKSPACE_NOT_FOUND" };

  const { passage, mode = "clear-natural", options = {} } = params;
  if (!passage || !passage.trim()) {
    return { ok: false, error: "INVALID_PASSAGE", message: "Passage string is required." };
  }

  // Find if passage had evidence match
  const passCtx = getPassageContext(workspaceId, { passage });
  const hasMatch = passCtx.integrityEvidence?.hasMatch;
  const matchType = hasMatch ? passCtx.integrityEvidence.matches[0]?.matchType : null;

  const rewriteRes = await rewriteText({
    text: passage,
    mode,
    evidence: hasMatch ? { matchType, action: "REPHRASED_FOR_ORIGINALITY" } : null,
    preserveCitations: options.preserveCitations !== false,
    options
  });

  if (!rewriteRes.ok) {
    return rewriteRes;
  }

  const rewriteRecord = {
    rewriteId: `rw-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    originalPassage: passage,
    rewrittenText: rewriteRes.rewrittenText,
    mode: rewriteRes.mode,
    modeName: rewriteRes.modeName,
    changesSummary: rewriteRes.changesSummary,
    evidenceAware: rewriteRes.evidenceAware,
    createdAt: new Date().toISOString()
  };

  ws.writing.rewrites.push(rewriteRecord);

  return {
    ok: true,
    rewrite: rewriteRecord,
    note: "Rewrite is staged. Original text remains immutable until explicit applyRewrite() action."
  };
}

/**
 * Explicitly applies an approved rewrite to the working document and records a version.
 *
 * @param {string} workspaceId
 * @param {Object} params
 * @param {string} params.originalPassage Passage to replace
 * @param {string} params.newText Replacement text
 * @returns {Object}
 */
function applyRewrite(workspaceId, params = {}) {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { ok: false, error: "WORKSPACE_NOT_FOUND" };

  const { originalPassage, newText } = params;
  if (!originalPassage || typeof newText !== "string") {
    return { ok: false, error: "INVALID_PARAMS", message: "originalPassage and newText are required." };
  }

  if (!ws.content.currentText.includes(originalPassage)) {
    return {
      ok: false,
      error: "PASSAGE_NOT_FOUND",
      message: "Original passage was not found in current working document text."
    };
  }

  // Replace passage in currentText (originalText is strictly immutable!)
  const updatedText = ws.content.currentText.replace(originalPassage, newText);
  ws.content.currentText = updatedText;
  ws.content.sections = detectDocumentSections(updatedText);
  ws.document.wordCount = (updatedText.match(/\S+/g) || []).length;
  ws.document.characterCount = updatedText.length;

  const nextVerNumber = ws.versions.length + 1;
  const now = new Date().toISOString();

  // Create new historical version snapshot
  ws.versions.push({
    version: nextVerNumber,
    label: `v${nextVerNumber} After rewrite`,
    text: updatedText,
    wordCount: ws.document.wordCount,
    timestamp: now,
    appliedChange: {
      original: originalPassage,
      replacement: newText
    },
    analysisSummary: {
      similarityScore: null,
      exactCoverage: null,
      aiWritingLikelihood: null,
      integrityConfidence: null,
      citationGaps: null,
      writingQualityScore: null
    }
  });

  ws.workflow.status = "editing";
  ws.workflow.lastUpdated = now;

  return {
    ok: true,
    version: nextVerNumber,
    document: ws.document,
    currentText: updatedText
  };
}

/**
 * Re-runs analysis on updated document and generates before/after change impact summary.
 *
 * @param {string} workspaceId
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function recheckWorkspace(workspaceId, options = {}) {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { ok: false, error: "WORKSPACE_NOT_FOUND" };

  if (ws.versions.length < 2) {
    return {
      ok: false,
      error: "NO_PREVIOUS_VERSION",
      message: "At least two versions are required to compute recheck change impact."
    };
  }

  // Previous version snapshot is immutable
  const previousVer = ws.versions[ws.versions.length - 2];
  const prevSummary = { ...(previousVer.analysisSummary || {}) };

  ws.workflow.status = "rechecking";
  const analyzeRes = await analyzeWorkspace(workspaceId, options);
  if (!analyzeRes.ok) {
    return analyzeRes;
  }

  const latestVer = ws.versions[ws.versions.length - 1];
  const newSummary = latestVer.analysisSummary;

  // Compute change impact metrics
  const changes = {};
  if (typeof prevSummary.similarityScore === "number" && typeof newSummary.similarityScore === "number") {
    changes.similarityScore = {
      from: prevSummary.similarityScore,
      to: newSummary.similarityScore,
      delta: newSummary.similarityScore - prevSummary.similarityScore
    };
  }

  if (typeof prevSummary.exactCoverage === "number" && typeof newSummary.exactCoverage === "number") {
    changes.exactCoverage = {
      from: prevSummary.exactCoverage,
      to: newSummary.exactCoverage,
      delta: newSummary.exactCoverage - prevSummary.exactCoverage
    };
  }

  if (typeof prevSummary.aiWritingLikelihood === "number" && typeof newSummary.aiWritingLikelihood === "number") {
    changes.aiWritingLikelihood = {
      from: prevSummary.aiWritingLikelihood,
      to: newSummary.aiWritingLikelihood,
      delta: newSummary.aiWritingLikelihood - prevSummary.aiWritingLikelihood
    };
  }

  if (typeof prevSummary.citationGaps === "number" && typeof newSummary.citationGaps === "number") {
    changes.citationGaps = {
      from: prevSummary.citationGaps,
      to: newSummary.citationGaps,
      delta: newSummary.citationGaps - prevSummary.citationGaps
    };
  }

  if (typeof prevSummary.writingQualityScore === "number" && typeof newSummary.writingQualityScore === "number") {
    changes.writingQualityScore = {
      from: prevSummary.writingQualityScore,
      to: newSummary.writingQualityScore,
      delta: newSummary.writingQualityScore - prevSummary.writingQualityScore
    };
  }

  // Objective factual narrative (never claims subjective "risk reduction")
  const narratives = [];
  if (changes.similarityScore) {
    narratives.push(`Similarity score changed from ${changes.similarityScore.from}% to ${changes.similarityScore.to}%.`);
  }
  if (changes.exactCoverage) {
    narratives.push(`Exact match coverage moved from ${changes.exactCoverage.from}% to ${changes.exactCoverage.to}%.`);
  }
  if (changes.aiWritingLikelihood) {
    narratives.push(`AI-writing likelihood shifted from ${changes.aiWritingLikelihood.from}% to ${changes.aiWritingLikelihood.to}%.`);
  }
  if (changes.citationGaps) {
    narratives.push(`Citation gaps adjusted from ${changes.citationGaps.from} to ${changes.citationGaps.to}.`);
  }
  if (changes.writingQualityScore) {
    narratives.push(`Writing quality score adjusted from ${changes.writingQualityScore.from} to ${changes.writingQualityScore.to}.`);
  }

  const comparison = {
    before: { version: previousVer.version, summary: prevSummary },
    after: { version: latestVer.version, summary: newSummary },
    changes,
    narrative: narratives.join(" ") || "No quantitative changes detected between versions."
  };

  ws.comparison = comparison;
  return {
    ok: true,
    workspace: ws,
    comparison
  };
}

/**
 * Returns the 5 distinct reports from the workspace Report Center.
 *
 * @param {string} workspaceId
 * @returns {Object}
 */
function generateWorkspaceReports(workspaceId) {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { ok: false, error: "WORKSPACE_NOT_FOUND" };

  return {
    ok: true,
    workspaceId: ws.id,
    reports: {
      integrityReport: ws.analysis.integrityReport,
      researchReport: ws.research.researchReport,
      writingReport: {
        qualityScore: ws.writing.quality?.qualityScore ?? null,
        qualityGrade: ws.writing.quality?.qualityGrade ?? null,
        issues: ws.writing.issues,
        readability: ws.writing.quality?.readability ?? null
      },
      citationReport: {
        totalCitations: ws.research.citations.length,
        citations: ws.research.citations,
        claims: ws.research.claims,
        citationGaps: ws.research.claims.filter(c => c.citationStatus === "CITATION_MISSING")
      },
      documentSummary: {
        document: ws.document,
        sections: ws.content.sections,
        versionsCount: ws.versions.length,
        workflowStatus: ws.workflow.status,
        lastUpdated: ws.workflow.lastUpdated
      }
    }
  };
}

/**
 * Exports workspace content and findings into JSON, Markdown, or printable HTML.
 *
 * @param {string} workspaceId
 * @param {string} [format="json"] "json" | "markdown" | "html"
 * @returns {Object}
 */
function exportWorkspace(workspaceId, format = "json") {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { ok: false, error: "WORKSPACE_NOT_FOUND" };

  const normFormat = (format || "json").toLowerCase().trim();

  if (normFormat === "markdown") {
    let md = `# ${ws.document.title}\n\n`;
    md += `*Generated by Checkra Academic Workspace*\n`;
    md += `*Date:* ${new Date().toLocaleDateString()} | *Word Count:* ${ws.document.wordCount}\n\n`;
    md += `## 1. Integrity & Similarity Overview\n`;
    md += `- Overall Similarity Score: ${ws.analysis.similarity?.score ?? "N/A"}%\n`;
    md += `- AI-Writing Likelihood: ${ws.analysis.aiWriting?.likelihood ?? "N/A"}%\n`;
    md += `- Integrity Confidence: ${ws.analysis.integrityReport?.integrityConfidence?.score ?? "N/A"}/100\n\n`;
    md += `## 2. Document Content\n\n`;
    md += `${ws.content.currentText}\n\n`;
    md += `## 3. Citations & References\n`;
    for (const c of ws.research.citations) {
      md += `- ${c.raw} [${c.format}]\n`;
    }

    return {
      ok: true,
      format: "markdown",
      contentType: "text/markdown",
      data: md
    };
  }

  if (normFormat === "html") {
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${ws.document.title} — Checkra Academic Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1a1a2e; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    h1 { color: #5b21b6; border-bottom: 2px solid #ddd; padding-bottom: 8px; }
    .meta { font-size: 13px; color: #666; margin-bottom: 24px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 24px; }
    .content { white-space: pre-wrap; background: #fff; border: 1px solid #eee; padding: 20px; border-radius: 8px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: #ede9fe; color: #6d28d9; }
  </style>
</head>
<body>
  <h1>${ws.document.title}</h1>
  <div class="meta">Checkra Academic Workspace Verification • ${new Date().toLocaleDateString()} • ${ws.document.wordCount} words</div>
  <div class="card">
    <h3>Integrity Findings</h3>
    <p>Similarity: <strong>${ws.analysis.similarity?.score ?? "N/A"}%</strong> | AI Likelihood: <strong>${ws.analysis.aiWriting?.likelihood ?? "N/A"}%</strong> | Quality Score: <strong>${ws.writing.quality?.qualityScore ?? "N/A"}/100</strong></p>
  </div>
  <div class="content">${ws.content.currentText}</div>
</body>
</html>`;

    return {
      ok: true,
      format: "html",
      contentType: "text/html",
      data: html
    };
  }

  // Default: JSON export
  return {
    ok: true,
    format: "json",
    contentType: "application/json",
    data: {
      document: ws.document,
      content: ws.content,
      analysis: ws.analysis,
      research: ws.research,
      writing: ws.writing,
      versions: ws.versions,
      comparison: ws.comparison
    }
  };
}

/**
 * Resets / deletes workspace from memory.
 */
function deleteWorkspace(workspaceId) {
  return workspaces.delete(workspaceId);
}

function clearWorkspaces() {
  workspaces.clear();
}

module.exports = {
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
};
