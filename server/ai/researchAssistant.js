/**
 * Checkra AI Agent — Research & Citation Assistant (Phase 7)
 *
 * Orchestrates evidence-first claim verification, citation auditing,
 * bounded web research, and source evaluation.
 *
 * PIPELINE:
 * User Question / Document
 *         ↓
 * Claim Extraction (claimExtractor.js)
 *         ↓
 * Citation Analysis & Gap Detection (citationAnalyzer.js)
 *         ↓
 * Existing Evidence Check (analysisService / integrityReport)
 *         ↓
 * Bounded Web Search (webSearchTool.js)
 *         ↓
 * Bounded Safe Source Retrieval (sourceTool.js)
 *         ↓
 * Source Support Evaluation & Synthesis (sourceSupport.js)
 *         ↓
 * Defensible Research Summary
 *
 * STRICT INVARIANTS:
 * 1. DISCOVERY ≠ VERIFICATION. Search snippets alone are NEVER marked CLAIM_SUPPORTED.
 * 2. Conservative classification: when evidence is insufficient, report INSUFFICIENT_EVIDENCE.
 * 3. Never fabricate sources, authors, publications, URLs, DOIs, or citations.
 * 4. Offline AI returns structured AI_UNAVAILABLE without crashing.
 * 5. Deterministic similarity scoring, AI-writing likelihood, and integrity confidence are immutable.
 */

const { extractClaims } = require("./claimExtractor");
const { analyzeCitations, generateReferenceList } = require("./citationAnalyzer");
const { web_search } = require("./webSearchTool");
const { fetch_source } = require("./sourceTool");
const { determineSourceType, evaluateClaimSupport, synthesizeSourceConsensus } = require("./sourceSupport");
const { generateAiCompletion, checkAiHealth } = require("./model");
const logger = require("../utils/logger");

const MAX_SEARCH_RESULTS = 4;
const MAX_RETRIEVAL_COUNT = 2;
const MAX_RESEARCH_TIMEOUT_MS = 5000;

/**
 * Conducts bounded, evidence-first research for a single claim.
 *
 * @param {string} claim Text of the factual/statistical claim
 * @param {string} [context] Optional surrounding document context
 * @param {Object} [options] Research options
 * @returns {Promise<Object>} Structured research outcome
 */
async function researchClaim(claim, context = "", options = {}) {
  if (!claim || typeof claim !== "string" || !claim.trim()) {
    return {
      ok: false,
      error: "INVALID_CLAIM",
      message: "A non-empty claim string is required for research.",
      claim: "",
      status: "INSUFFICIENT_EVIDENCE",
      sources: [],
      evidence: [],
      limitations: ["No claim text provided."]
    };
  }

  const cleanClaim = claim.trim();
  const maxResults = Math.min(MAX_SEARCH_RESULTS, options.maxResults || 3);
  const maxRetrievals = Math.min(MAX_RETRIEVAL_COUNT, options.maxRetrievals || 2);

  // 1. Pre-supplied candidate sources or mock/direct sources (for deterministic testing & speed)
  if (Array.isArray(options.candidateSources) && options.candidateSources.length > 0) {
    const evaluated = [];
    for (const cand of options.candidateSources) {
      if (!cand.url || cand.status === "SOURCE_NOT_VERIFIABLE") {
        evaluated.push({
          url: cand.url || "unknown",
          title: cand.title || "Unverifiable Source",
          domain: cand.domain || "unknown",
          sourceType: determineSourceType(cand.url),
          status: "SOURCE_NOT_VERIFIABLE",
          supportType: "SOURCE_NOT_VERIFIABLE",
          evidence: "Source was unreachable or could not be verified.",
          isVerified: false,
          explanation: "Source could not be retrieved."
        });
        continue;
      }

      // If snippet only (no full text)
      if (cand.snippetOnly && !cand.text) {
        evaluated.push({
          url: cand.url,
          title: cand.title || cand.url,
          domain: cand.domain || "unknown",
          sourceType: determineSourceType(cand.url),
          status: "SOURCE_DISCOVERED",
          supportType: "INSUFFICIENT_EVIDENCE",
          evidence: `Discovered in search snippet: "${cand.snippet || ""}"`,
          isVerified: false,
          explanation: "Search snippet is discovery evidence only. Snippets can NEVER be marked CLAIM_SUPPORTED."
        });
        continue;
      }

      const evalRes = await evaluateClaimSupport(cleanClaim, cand.text || "", cand.url);
      evaluated.push({
        url: cand.url,
        title: cand.title || cand.url,
        domain: cand.domain || "unknown",
        sourceType: determineSourceType(cand.url),
        status: evalRes.status,
        supportType: evalRes.supportType,
        evidence: evalRes.evidence,
        isVerified: evalRes.isVerified || false,
        explanation: evalRes.explanation
      });
    }

    const consensus = synthesizeSourceConsensus(cleanClaim, evaluated);
    return {
      ok: true,
      claim: cleanClaim,
      status: consensus.status,
      consensus: consensus.consensus,
      sources: evaluated,
      evidence: evaluated.map(e => ({ url: e.url, evidence: e.evidence })),
      summary: consensus.summary,
      limitations: consensus.status === "INSUFFICIENT_EVIDENCE" ? ["Retrieved sources did not contain enough conclusive evidence."] : []
    };
  }

  // 2. Perform Web Search for candidate discovery
  let searchResult;
  try {
    searchResult = await web_search(cleanClaim, { maxResults });
  } catch (searchErr) {
    logger.warn("Web search failed during researchClaim", { error: searchErr.message });
    searchResult = { ok: false, error: "SEARCH_FAILED", results: [] };
  }

  const rawCandidates = searchResult?.results || [];
  if (!rawCandidates || rawCandidates.length === 0) {
    return {
      ok: true,
      claim: cleanClaim,
      status: "CLAIM_UNSUPPORTED",
      consensus: "NO_SOURCES_FOUND",
      sources: [],
      evidence: [],
      summary: "No candidate web sources were discovered matching this claim.",
      limitations: ["No candidate sources found in public web search index."]
    };
  }

  // 3. Bounded Retrieval of candidate sources (up to maxRetrievals)
  const evaluatedSources = [];
  const candidatesToRetrieve = rawCandidates.slice(0, maxRetrievals);

  for (const cand of candidatesToRetrieve) {
    const candidateUrl = cand.url;
    if (!candidateUrl) continue;

    // Fetch source safely
    let fetched = await fetch_source(candidateUrl, { timeoutMs: 2500 });
    if (!fetched.ok || !fetched.text) {
      evaluatedSources.push({
        url: candidateUrl,
        title: cand.title || candidateUrl,
        domain: cand.domain || "unknown",
        sourceType: determineSourceType(candidateUrl),
        status: "SOURCE_NOT_VERIFIABLE",
        supportType: "SOURCE_NOT_VERIFIABLE",
        evidence: `Source was unreachable: ${fetched.reason || "Retrieval failed."}`,
        isVerified: false,
        explanation: "Candidate page could not be safely retrieved."
      });
      continue;
    }

    // Evaluate support against actual retrieved text
    const supportEval = await evaluateClaimSupport(cleanClaim, fetched.text, candidateUrl);
    evaluatedSources.push({
      url: candidateUrl,
      title: fetched.title || cand.title || candidateUrl,
      domain: cand.domain || "unknown",
      sourceType: determineSourceType(candidateUrl),
      status: supportEval.status,
      supportType: supportEval.supportType,
      evidence: supportEval.evidence,
      isVerified: supportEval.isVerified || false,
      explanation: supportEval.explanation
    });
  }

  // Add any remaining un-retrieved candidates strictly as SOURCE_DISCOVERED
  const unretrievedCandidates = rawCandidates.slice(maxRetrievals);
  for (const unretrieved of unretrievedCandidates) {
    evaluatedSources.push({
      url: unretrieved.url,
      title: unretrieved.title || unretrieved.url,
      domain: unretrieved.domain || "unknown",
      sourceType: determineSourceType(unretrieved.url),
      status: "SOURCE_DISCOVERED",
      supportType: "INSUFFICIENT_EVIDENCE",
      evidence: `Search candidate found: "${unretrieved.snippet || ""}"`,
      isVerified: false,
      explanation: "Discovered via search index, but not retrieved within retrieval budget. Snippets are never marked CLAIM_SUPPORTED."
    });
  }

  const consensus = synthesizeSourceConsensus(cleanClaim, evaluatedSources);

  return {
    ok: true,
    claim: cleanClaim,
    status: consensus.status,
    consensus: consensus.consensus,
    sources: evaluatedSources,
    evidence: evaluatedSources.map(e => ({ url: e.url, evidence: e.evidence })),
    summary: consensus.summary,
    limitations: consensus.conflictDetected ? ["Multiple sources provide conflicting evidence regarding this claim."] : []
  };
}

/**
 * Builds a full document research and citation audit report.
 *
 * @param {string} text Document text
 * @param {Object} [options]
 * @returns {Promise<Object>} Structured document research report
 */
async function researchDocument(text, options = {}) {
  if (!text || typeof text !== "string" || !text.trim()) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "Text must be a non-empty string.",
      document: { wordCount: 0 },
      claims: [],
      citationSummary: { totalCitations: 0, recognized: 0, unresolved: 0, possibleGaps: 0 }
    };
  }

  const cleanText = text.trim();
  const wordCount = (cleanText.match(/\S+/g) || []).length;

  // 1. Analyze citations & gaps
  const citationAudit = analyzeCitations(cleanText, options);
  const claims = citationAudit.claims || [];

  // 2. Format claim entries with research status
  const documentClaims = claims.map(c => {
    let status = "CLAIM_UNSUPPORTED";
    if (c.citationStatus === "SUPPORTED_BY_CITATION") {
      status = "CLAIM_SUPPORTED";
    } else if (c.citationStatus === "NOT_REQUIRED") {
      status = "NOT_REQUIRED";
    }

    return {
      claimId: c.claimId,
      type: c.type,
      text: c.text,
      start: c.start,
      end: c.end,
      requiresEvidence: c.requiresEvidence,
      citationPresent: c.citationPresent,
      citationExpected: c.citationExpected,
      citationStatus: c.citationStatus,
      status,
      sources: []
    };
  });

  return {
    ok: true,
    document: {
      wordCount,
      title: options.title || "Submitted Document"
    },
    claims: documentClaims,
    citationSummary: {
      totalCitations: citationAudit.stats.totalCitations,
      recognized: citationAudit.stats.recognized,
      unresolved: citationAudit.stats.unresolved,
      possibleGaps: citationAudit.stats.possibleGaps
    },
    limitations: [
      "Missing citations represent citation-quality opportunities and do not by themselves constitute plagiarism."
    ]
  };
}

/**
 * Answers 'Why is this source relevant?' strictly using retrieved source evidence.
 *
 * @param {Object} params
 * @param {string} params.claim
 * @param {Object} params.source
 * @returns {string} Grounded explanation
 */
function explainSourceRelevance({ claim = "", source = {} } = {}) {
  if (!source || !source.url) {
    return "No source provided to explain relevance.";
  }

  if (source.status === "SOURCE_NOT_VERIFIABLE") {
    return `Source ${source.url} could not be retrieved or verified.`;
  }

  if (source.supportType === "DIRECT_SUPPORT" || source.status === "CLAIM_SUPPORTED") {
    return `Why this source is relevant: The retrieved source directly discusses ${source.domain || "the topic"} and contains direct evidence verifying "${claim}".`;
  }

  if (source.supportType === "PARTIAL_SUPPORT" || source.status === "CLAIM_PARTIALLY_SUPPORTED") {
    return `Why this source is relevant: The retrieved source discusses elements of ${source.domain || "the topic"} and provides partial supporting context for "${claim}".`;
  }

  if (source.supportType === "RELATED_ONLY" || source.status === "SOURCE_RELEVANT") {
    return "This source is topically related but does not provide sufficient evidence to verify the claim.";
  }

  if (source.supportType === "CONTRADICTS") {
    return `Why this source is relevant: The retrieved source directly addresses the topic but provides evidence that contradicts or refutes the claim.`;
  }

  return "This source was examined, but contains insufficient evidence to confirm or refute the claim.";
}

/**
 * Explains a source or claim in simple English using local AI (Qwen3 1.7B).
 * If Ollama is unavailable, returns structured AI_UNAVAILABLE without crashing.
 *
 * @param {string} prompt Question or text to explain
 * @returns {Promise<Object>}
 */
async function explainWithAi(prompt) {
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return { ok: false, error: "EMPTY_PROMPT" };
  }

  const health = await checkAiHealth();
  if (!health.ok || !health.available) {
    return {
      ok: false,
      error: "AI_UNAVAILABLE",
      message: "Local AI model is unavailable. Deterministic research and citation analysis remain fully accessible."
    };
  }

  const aiSystemPrompt = "You are Checkra's evidence-based research assistant. Explain the following source evidence clearly in simple English. Never invent citations, authors, dates, or factual claims not present in the evidence.";
  const fullPrompt = `${aiSystemPrompt}\n\nTask:\n${prompt.trim()}`;

  const completion = await generateAiCompletion(fullPrompt, { timeoutMs: 15000 });
  if (!completion.ok) {
    return {
      ok: false,
      error: "AI_UNAVAILABLE",
      message: "AI model generation timed out or failed."
    };
  }

  return {
    ok: true,
    response: completion.response || completion.content || "",
    provider: completion.provider,
    model: completion.model
  };
}

module.exports = {
  researchClaim,
  researchDocument,
  explainSourceRelevance,
  explainWithAi
};
