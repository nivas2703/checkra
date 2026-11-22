/**
 * Checkra AI Agent — Tool Registry
 *
 * Implements deterministic read-only access to existing Checkra analysis state,
 * provider-agnostic web search, safe source retrieval, and source verification.
 *
 * Tools do NOT recalculate scores, fabricate data, or access unauthorized systems.
 */

const { web_search } = require("./webSearchTool");
const { fetch_source } = require("./sourceTool");
const { verify_source } = require("./sourceVerification");
const { detectAiWriting } = require("./aiWritingDetector");
const { generateIntegrityReport } = require("./evidenceFusion");
const { analyzeWritingQuality } = require("./writingImprovement");
const { rewriteText } = require("./rewriteEngine");
const { extractClaims } = require("./claimExtractor");
const { analyzeCitations, generateReferenceList } = require("./citationAnalyzer");
const { researchClaim } = require("./researchAssistant");

const TOOLS = {
  get_analysis_result: {
    name: "get_analysis_result",
    description: "Retrieves the existing Checkra deterministic similarity scores, coverage breakdown, verified sources, and matched passages.",
    execute: (context = {}) => {
      const a = context.analysis;
      if (!a || typeof a !== "object") {
        return {
          available: false,
          error: "NO_ANALYSIS_PROVIDED",
          message: "No Checkra document analysis result was supplied in the request context."
        };
      }

      // Safe extraction preserving existing Checkra terminology
      const sim = a.similarity || {};
      const cov = sim.coverage || {};
      const sources = a.sources || {};
      const passages = Array.isArray(a.matchedPassages) ? a.matchedPassages : (Array.isArray(a.passages) ? a.passages : []);

      // Check whether an authoritative score was actually calculated and provided
      const hasScore = typeof sim.score === "number" && !isNaN(sim.score);
      const overallSimilarityScore = hasScore ? sim.score : null;
      const grade = hasScore ? (sim.grade || "A") : null;

      const exactCoverage = typeof cov.exactPercent === "number"
        ? cov.exactPercent
        : (typeof sim.exactCoverage === "number" ? sim.exactCoverage : 0);
      const nearCoverage = typeof cov.nearPercent === "number"
        ? cov.nearPercent
        : (typeof sim.nearCoverage === "number" ? sim.nearCoverage : 0);
      const semanticCoverage = typeof cov.semanticPercent === "number"
        ? cov.semanticPercent
        : (typeof sim.semanticCoverage === "number" ? sim.semanticCoverage : 0);

      // Verify mathematical consistency with component coverage formula:
      // Overall = min(100, round((exact * 0.65) + (near * 0.25) + (semantic * 0.10)))
      let isMathematicallyConsistent = true;
      let inconsistencyNotice = null;

      if (hasScore) {
        const expectedScore = Math.min(
          100,
          Math.round((exactCoverage * 0.65) + (nearCoverage * 0.25) + (semanticCoverage * 0.10))
        );
        // Allow a small ±2 tolerance for rounding variations
        if (Math.abs(expectedScore - overallSimilarityScore) > 2) {
          isMathematicallyConsistent = false;
          inconsistencyNotice = `The displayed component percentages do not independently reproduce the reported overall score; the authoritative Checkra overall score is ${overallSimilarityScore}%.`;
        }
      }

      // Extract up to 5 highest-priority matched passages for compact reasoning
      const topPassages = passages.slice(0, 5).map(p => ({
        passageText: p.text || p.passageText || "",
        matchType: p.matchType || p.type || "EXACT",
        similarityPercent: p.similarityScore ? Math.round(p.similarityScore * 100) : (p.score ? Math.round(p.score * 100) : (p.similarity ?? 100)),
        sourceUrl: p.sourceUrl || p.url || null,
        sourceTitle: p.sourceTitle || p.title || null
      }));

      return {
        available: true,
        hasScore,
        analysisId: a.id || a.analysisId || "VW-SESSION",
        documentTitle: a.document?.title || a.title || "Document",
        wordCount: a.document?.wordCount || a.fileStats?.wordCount || 0,
        overallSimilarityScore,
        grade,
        exactCoverage,
        nearCoverage,
        semanticCoverage,
        isMathematicallyConsistent,
        inconsistencyNotice,
        verifiedSourcesCount: sources.matchingCount ?? (Array.isArray(sources.items) ? sources.items.length : 0),
        retrievedSourcesCount: sources.retrievedCount ?? sources.reviewed ?? 0,
        matchedPassagesCount: passages.length,
        topMatchedPassages: topPassages,
        status: a.status || "completed"
      };
    }
  },

  web_search: {
    name: "web_search",
    description: "Searches the web for candidate sources matching a query for candidate source discovery only. Snippets are not verified proof.",
    execute: async (context = {}) => {
      const query = context.query || context.message || "";
      const maxResults = context.maxResults || 5;
      return await web_search(query, { maxResults });
    }
  },

  fetch_source: {
    name: "fetch_source",
    description: "Safely fetches a candidate web page with SSRF protection, size bounding, and HTML extraction.",
    execute: async (context = {}) => {
      const url = context.url;
      const timeoutMs = context.timeoutMs || 3000;
      return await fetch_source(url, { timeoutMs });
    }
  },

  verify_source: {
    name: "verify_source",
    description: "Compares a document passage against a retrieved source using Checkra's deterministic comparison engine.",
    execute: async (context = {}) => {
      return await verify_source(context);
    }
  },

  analyze_ai_writing: {
    name: "analyze_ai_writing",
    description: "Evaluates document text for stylometric and structural characteristics associated with AI-generated writing. Returns probabilistic likelihood and signals, completely separate from plagiarism/similarity scores.",
    execute: async (context = {}) => {
      const text = context.text || context.analysis?.document?.text || context.documentText || "";
      if (!text || typeof text !== "string" || !text.trim()) {
        return {
          available: false,
          error: "EMPTY_TEXT",
          message: "No document text was provided to analyze for AI writing characteristics."
        };
      }
      const result = await detectAiWriting(text, context.options || {});
      return {
        available: true,
        aiWriting: result
      };
    }
  },

  generate_integrity_report: {
    name: "generate_integrity_report",
    description: "Generates a unified Checkra integrity report fusing deterministic similarity matching, verified web sources, and AI writing likelihood. Read-only; does not recalculate or modify underlying scores.",
    execute: (context = {}) => {
      const res = generateIntegrityReport(context);
      if (!res.ok) {
        return {
          available: false,
          error: res.error,
          message: res.message
        };
      }
      return {
        available: true,
        report: res.report
      };
    }
  },

  analyze_writing_quality: {
    name: "analyze_writing_quality",
    description: "Evaluates text for grammatical, mechanical, stylistic, and readability issues. Read-only diagnostic quality analysis.",
    execute: (context = {}) => {
      const text = context.text || context.passage || context.documentText || "";
      const res = analyzeWritingQuality(text, context.options || {});
      return {
        available: res.ok,
        quality: res
      };
    }
  },

  rewrite_text: {
    name: "rewrite_text",
    description: "Performs evidence-aware rewriting in clear-natural, academic-readable, professional, concise, or simple-english modes while preserving factual meaning, numbers, dates, and citations.",
    execute: async (context = {}) => {
      const res = await rewriteText({
        text: context.text || context.passage || "",
        mode: context.mode || "clear-natural",
        evidence: context.evidence || null,
        preserveCitations: context.preserveCitations !== false,
        options: context.options || {}
      });
      return {
        available: res.ok,
        rewrite: res
      };
    }
  },

  extract_claims: {
    name: "extract_claims",
    description: "Extracts research-relevant claims (factual, statistical, historical, causal, comparative, definitional) and identifies statements requiring empirical evidence.",
    execute: (context = {}) => {
      const text = context.text || context.passage || context.documentText || "";
      const res = extractClaims(text, context.options || {});
      return {
        available: res.ok,
        claims: res.claims || [],
        stats: res.stats || {}
      };
    }
  },

  analyze_citations: {
    name: "analyze_citations",
    description: "Detects parenthetical, narrative, numeric, and multiple citations, identifies citation gaps across claims, and reports citation statistics.",
    execute: (context = {}) => {
      const text = context.text || context.passage || context.documentText || "";
      const res = analyzeCitations(text, context.options || {});
      return {
        available: res.ok,
        citations: res.citations || [],
        citationGaps: res.citationGaps || [],
        claims: res.claims || [],
        stats: res.stats || {}
      };
    }
  },

  research_claim: {
    name: "research_claim",
    description: "Performs bounded, evidence-first research on a specific factual claim, evaluating candidate sources for direct support, partial support, topical relation, or contradiction.",
    execute: async (context = {}) => {
      const claim = context.claim || context.text || context.passage || "";
      const ctx = context.context || "";
      const res = await researchClaim(claim, ctx, context.options || {});
      return {
        available: res.ok,
        claim: res.claim,
        status: res.status,
        sources: res.sources || [],
        evidence: res.evidence || [],
        summary: res.summary,
        limitations: res.limitations || []
      };
    }
  },

  generate_reference_list: {
    name: "generate_reference_list",
    description: "Generates a structured bibliography reference list strictly from verified/retrieved source metadata. Never fabricates citations or entries.",
    execute: (context = {}) => {
      const sources = context.sources || context.verifiedSources || [];
      const style = context.style || "APA";
      const res = generateReferenceList(sources, style);
      return {
        available: res.ok,
        style: res.style,
        references: res.references || [],
        totalReferences: res.totalReferences || 0
      };
    }
  }
};

/**
 * Executes a registered Checkra tool safely by name.
 *
 * @param {string} toolName Name of the tool to execute
 * @param {Object} context Context containing inputs/analysis
 * @returns {Object|Promise<Object>} Result of tool execution
 */
function executeTool(toolName, context = {}) {
  const tool = TOOLS[toolName];
  if (!tool) {
    return {
      available: false,
      error: "UNKNOWN_TOOL",
      message: `Tool '${toolName}' is not registered in the Checkra tool suite.`
    };
  }
  return tool.execute(context);
}

module.exports = {
  TOOLS,
  executeTool
};
