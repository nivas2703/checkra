/**
 * Checkra Phase 5 — Evidence Fusion & Unified Integrity Report Generator
 *
 * Combines three strictly independent integrity pillars:
 * 1. Authoritative Deterministic Checkra Similarity Analysis (plagiarism / text overlap)
 * 2. Verified Web-Source Evidence (candidate discovery vs verified retrieval)
 * 3. Deterministic AI-Writing Likelihood & Stylometric Signals
 *
 * Produces the unified 'Integrity Confidence' metric representing EVIDENCE QUALITY
 * (never a plagiarism probability, never similarity x likelihood).
 *
 * STRICT SCORE IMMUTABILITY:
 * - Never recalculates or modifies similarity.score
 * - Never recalculates or modifies aiWriting.likelihood
 * - Never fabricates 0% when analysis is missing (uses null)
 * - Never counts TOPICAL_SIMILARITY or CONCEPTUAL_SIMILARITY as plagiarism evidence
 */

const db = require("../db/database");
const logger = require("../utils/logger");

const MANDATORY_AI_DISCLAIMER = "AI-writing detection is probabilistic, stylometric, and cannot establish authorship with certainty.";
const MANDATORY_PLATFORM_DISCLAIMER = "Checkra integrity reports combine deterministic similarity matching, verified web sources, and stylometric AI-writing signals. Integrity confidence reflects evidence quality and completeness, not an automated judgment of author intent.";

const EVIDENCE_CLASSES = {
  EXACT_MATCH: { category: "PLAGIARISM_RELEVANT", label: "Exact Textual Match" },
  NEAR_MATCH: { category: "PLAGIARISM_RELEVANT", label: "Near Match with Variations" },
  STRONG_PARAPHRASE: { category: "PLAGIARISM_RELEVANT", label: "Strong Paraphrased Overlap" },
  POSSIBLE_PARAPHRASE: { category: "PLAGIARISM_RELEVANT", label: "Possible Paraphrased Overlap" },
  CONCEPTUAL_SIMILARITY: { category: "CONTEXT_ONLY", label: "Conceptual Similarity Only" },
  TOPICAL_SIMILARITY: { category: "CONTEXT_ONLY", label: "Topical Similarity Only" },
  NO_MATCH: { category: "NO_EVIDENCE", label: "No Matching Text Detected" }
};

/**
 * Calculates the Integrity Confidence metric based on evidence quality and completeness.
 * Represents confidence in the AVAILABLE EVIDENCE (not a plagiarism probability).
 *
 * @param {Object} similarityData
 * @param {Object} aiWritingData
 * @param {Object} sourceData
 * @returns {Object} { level, score, basis, limitations }
 */
function calculateIntegrityConfidence(similarityData, aiWritingData, sourceData) {
  const basis = [];
  const limitations = [];

  const hasSimilarity = similarityData && similarityData.score !== null && similarityData.score !== undefined;
  const hasAiWriting = aiWritingData && aiWritingData.status !== "UNAVAILABLE" && aiWritingData.status !== undefined;
  const aiWritingAnalyzed = hasAiWriting && aiWritingData.status !== "INSUFFICIENT_TEXT" && aiWritingData.likelihood !== null;

  // If no underlying analysis exists at all
  if (!hasSimilarity && !hasAiWriting) {
    return {
      level: "UNAVAILABLE",
      score: 0,
      basis: [],
      limitations: ["No underlying document similarity or AI-writing analysis was provided."]
    };
  }

  let rawScore = 0;

  // 1. Similarity Engine Component (up to 40 points)
  if (hasSimilarity) {
    rawScore += 25;
    basis.push("Deterministic similarity engine completed authoritative multi-level text comparison.");

    if (similarityData.matchedPassagesCount > 0) {
      rawScore += 15;
      basis.push(`Identified and verified ${similarityData.matchedPassagesCount} specific matching passage(s).`);
    } else {
      rawScore += 15;
      basis.push("Confirmed zero candidate matching passages across reference texts and databases.");
    }
  } else {
    limitations.push("Authoritative similarity analysis was not performed or produced no verified score.");
  }

  // 2. AI-Writing Component (up to 35 points)
  if (aiWritingAnalyzed) {
    if (aiWritingData.confidence === "HIGH") {
      rawScore += 35;
      basis.push("AI-writing stylometric analysis completed with high statistical confidence (200+ words).");
    } else if (aiWritingData.confidence === "MEDIUM") {
      rawScore += 25;
      basis.push("AI-writing stylometric analysis completed with moderate statistical confidence (100-199 words).");
    } else {
      rawScore += 15;
      basis.push("AI-writing stylometric analysis completed on limited text sample (50-99 words).");
    }
  } else if (hasAiWriting && aiWritingData.status === "INSUFFICIENT_TEXT") {
    limitations.push("AI-writing analysis unavailable: document contains insufficient text (< 50 words) for reliable stylometry.");
  } else {
    limitations.push("AI-writing detection was not performed.");
  }

  // 3. Source Verification Component (up to 25 points)
  const unverifiableCount = sourceData.unverifiableSourceCount || 0;
  const verifiedCount = sourceData.verifiedSourceCount || 0;
  const contextualCount = sourceData.contextualSourceCount || 0;

  if (unverifiableCount > 0) {
    const penalty = Math.min(25, unverifiableCount * 10);
    const earned = Math.max(0, 25 - penalty);
    rawScore += earned;
    limitations.push(`${unverifiableCount} candidate source(s) could not be retrieved or verified (marked SOURCE_NOT_VERIFIABLE).`);
  } else if (verifiedCount > 0) {
    rawScore += 25;
    basis.push(`Successfully retrieved and verified ${verifiedCount} external web source(s) with confirmed text comparison.`);
  } else if (contextualCount > 0) {
    rawScore += 20;
    basis.push(`Retrieved ${contextualCount} contextual source(s) and confirmed absence of direct textual overlap.`);
  } else {
    // Clean document or local comparison without external failures
    rawScore += 20;
    basis.push("Source verification completed without retrieval errors.");
  }

  // Clamp confidence score 0-100
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Determine Level Tier
  let level = "LOW";
  if (score >= 75) {
    level = "HIGH";
  } else if (score >= 45) {
    level = "MEDIUM";
  } else if (score > 0) {
    level = "LOW";
  } else {
    level = "UNAVAILABLE";
  }

  return {
    level,
    score,
    basis,
    limitations
  };
}

/**
 * Generates the Unified Checkra Integrity Report by fusing similarity, source, and AI-writing evidence.
 *
 * @param {Object} input
 * @param {string} [input.analysisId] ID of existing session analysis
 * @param {Object} [input.analysis] Direct analysis object
 * @param {Object} [input.research] Direct research results
 * @param {Object} [input.aiWriting] Direct AI writing analysis
 * @returns {Object} Structured integrity report
 */
function generateIntegrityReport(input = {}) {
  let analysis = input.analysis || null;
  const research = input.research || null;
  let aiWriting = input.aiWriting || null;

  // Resolve by analysisId if provided and analysis not explicitly supplied
  if (input.analysisId && !analysis) {
    analysis = db.getSessionAnalysis(input.analysisId);
  }

  // If aiWriting was attached to analysis, use it if not passed standalone
  if (!aiWriting && analysis?.aiWriting) {
    aiWriting = analysis.aiWriting;
  }

  // If absolutely no data is supplied
  if (!analysis && !research && !aiWriting) {
    return {
      ok: false,
      error: "NO_DATA_PROVIDED",
      message: "No document analysis, web research, or AI writing data was provided to generate an integrity report."
    };
  }

  // 1. EXTRACT & PRESERVE AUTHORITATIVE SIMILARITY
  const sim = analysis?.similarity || null;
  const cov = sim?.coverage || {};
  const hasSimScore = sim && typeof sim.score === "number" && !isNaN(sim.score);

  const similarityReport = {
    status: hasSimScore ? "COMPLETED" : "UNAVAILABLE",
    score: hasSimScore ? sim.score : null,
    grade: hasSimScore ? (sim.grade || "A") : null,
    exactCoverage: typeof cov.exactPercent === "number"
      ? cov.exactPercent
      : (typeof sim?.exactCoverage === "number" ? sim.exactCoverage : (hasSimScore ? 0 : null)),
    nearCoverage: typeof cov.nearPercent === "number"
      ? cov.nearPercent
      : (typeof sim?.nearCoverage === "number" ? sim.nearCoverage : (hasSimScore ? 0 : null)),
    semanticCoverage: typeof cov.semanticPercent === "number"
      ? cov.semanticPercent
      : (typeof sim?.semanticCoverage === "number" ? sim.semanticCoverage : (hasSimScore ? 0 : null)),
    matchedPassagesCount: Array.isArray(analysis?.matchedPassages) ? analysis.matchedPassages.length : 0,
    explanation: hasSimScore
      ? `${sim.score}% overall similarity was detected by the Checkra deterministic similarity engine.`
      : "The similarity score is unavailable for this document; no authoritative score was calculated."
  };

  // 2. EXTRACT & PRESERVE AUTHORITATIVE AI-WRITING DETECTION
  let aiWritingReport = {
    status: "UNAVAILABLE",
    likelihood: null,
    confidence: "UNAVAILABLE",
    signals: [],
    metrics: null,
    qualitativeReview: null,
    explanation: "AI-writing detection was not performed or is unavailable."
  };

  if (aiWriting) {
    const isInsufficient = aiWriting.status === "INSUFFICIENT_TEXT";
    const likelihood = (typeof aiWriting.likelihood === "number" && !isInsufficient) ? aiWriting.likelihood : null;

    let aiExplanation = "AI-writing detection was not performed or is unavailable.";
    if (likelihood !== null) {
      aiExplanation = `AI-writing likelihood is ${likelihood}% based on stylometric indicators.`;
    } else if (isInsufficient) {
      aiExplanation = "AI-writing analysis is unavailable; document contains insufficient text (< 50 words) for reliable stylometry.";
    }

    aiWritingReport = {
      status: aiWriting.status || (likelihood !== null ? "ANALYZED" : "UNAVAILABLE"),
      likelihood,
      confidence: aiWriting.confidence || (likelihood !== null ? "MEDIUM" : "NONE"),
      signals: Array.isArray(aiWriting.signals) ? [...aiWriting.signals] : [],
      metrics: aiWriting.metrics || null,
      qualitativeReview: aiWriting.qualitativeReview || null,
      explanation: aiExplanation
    };
  }

  // 3. CLASSIFY & BUCKET SOURCE AND MATCH EVIDENCE
  const exactMatches = [];
  const nearMatches = [];
  const paraphraseMatches = [];
  const contextualSources = [];
  const unverifiableSources = [];

  const verifiedSourceUrls = new Set();

  // A. Process matched passages from document analysis
  const passages = Array.isArray(analysis?.matchedPassages) ? analysis.matchedPassages : [];
  for (const p of passages) {
    const mType = (p.matchType || p.type || "EXACT").toUpperCase();
    const item = {
      passageText: p.text || p.passageText || "",
      matchType: mType,
      similarityPercent: p.similarityScore ? Math.round(p.similarityScore * 100) : (p.score ? Math.round(p.score * 100) : (p.similarity ?? 100)),
      sourceUrl: p.sourceUrl || p.url || null,
      sourceTitle: p.sourceTitle || p.title || null,
      classification: "PLAGIARISM_RELEVANT"
    };

    if (item.sourceUrl) verifiedSourceUrls.add(item.sourceUrl);

    if (mType === "EXACT" || mType === "EXACT_MATCH") {
      item.explanation = `An exact textual match was verified against ${item.sourceTitle || item.sourceUrl || "reference text"}.`;
      exactMatches.push(item);
    } else if (mType === "NEAR" || mType === "NEAR_MATCH") {
      item.explanation = `A near textual match with minor variations was verified against ${item.sourceTitle || item.sourceUrl || "reference text"}.`;
      nearMatches.push(item);
    } else {
      item.explanation = `Paraphrased overlap was detected against ${item.sourceTitle || item.sourceUrl || "reference text"}.`;
      paraphraseMatches.push(item);
    }
  }

  // B. Process research sources (from web verification)
  const researchSources = Array.isArray(research?.sources) ? research.sources : [];
  for (const s of researchSources) {
    const mType = (s.matchType || "NO_MATCH").toUpperCase();
    const status = (s.status || "NO_MATCH").toUpperCase();

    // Check for source retrieval failure
    if (status === "SOURCE_NOT_VERIFIABLE" || s.fetchFailed) {
      unverifiableSources.push({
        url: s.url,
        title: s.title || s.domain || s.url,
        domain: s.domain,
        status: "SOURCE_NOT_VERIFIABLE",
        classification: "UNVERIFIABLE",
        explanation: "Candidate source could not be retrieved or verified."
      });
      continue;
    }

    // Contextual only (TOPICAL or CONCEPTUAL) — MUST NEVER increment plagiarism counts
    if (mType === "TOPICAL_SIMILARITY") {
      contextualSources.push({
        url: s.url,
        title: s.title || s.domain || s.url,
        domain: s.domain,
        status: status === "VERIFIED" ? "VERIFIED" : "RETRIEVED",
        matchType: "TOPICAL_SIMILARITY",
        sourceSimilarity: null,
        classification: "CONTEXT_ONLY",
        evidence: s.evidence || "Topical relationship detected, but no textual overlap was verified.",
        explanation: "Topical relationship detected, but no textual overlap was verified."
      });
      continue;
    }

    if (mType === "CONCEPTUAL_SIMILARITY") {
      contextualSources.push({
        url: s.url,
        title: s.title || s.domain || s.url,
        domain: s.domain,
        status: status === "VERIFIED" ? "VERIFIED" : "RETRIEVED",
        matchType: "CONCEPTUAL_SIMILARITY",
        sourceSimilarity: null,
        classification: "CONTEXT_ONLY",
        evidence: s.evidence || "Related concepts were detected, but this does not establish plagiarism.",
        explanation: "Related concepts were detected, but this does not establish plagiarism."
      });
      continue;
    }

    // Plagiarism-relevant external matches
    if (mType === "EXACT_MATCH") {
      if (s.url) verifiedSourceUrls.add(s.url);
      exactMatches.push({
        sourceUrl: s.url,
        sourceTitle: s.title || s.domain || s.url,
        matchType: "EXACT_MATCH",
        sourceSimilarity: s.sourceSimilarity || "100%",
        classification: "PLAGIARISM_RELEVANT",
        evidence: s.evidence,
        explanation: `An exact textual match was verified against ${s.title || s.url}.`
      });
    } else if (mType === "NEAR_MATCH") {
      if (s.url) verifiedSourceUrls.add(s.url);
      nearMatches.push({
        sourceUrl: s.url,
        sourceTitle: s.title || s.domain || s.url,
        matchType: "NEAR_MATCH",
        sourceSimilarity: s.sourceSimilarity || "Near Match",
        classification: "PLAGIARISM_RELEVANT",
        evidence: s.evidence,
        explanation: `A near textual match was verified against ${s.title || s.url}.`
      });
    } else if (mType === "STRONG_PARAPHRASE" || mType === "POSSIBLE_PARAPHRASE") {
      if (s.url) verifiedSourceUrls.add(s.url);
      paraphraseMatches.push({
        sourceUrl: s.url,
        sourceTitle: s.title || s.domain || s.url,
        matchType: mType,
        sourceSimilarity: s.sourceSimilarity || null,
        classification: "PLAGIARISM_RELEVANT",
        evidence: s.evidence,
        explanation: `Paraphrased overlap was detected against ${s.title || s.url}.`
      });
    }
  }

  // Summary counts
  const summary = {
    verifiedSourceCount: verifiedSourceUrls.size,
    exactMatchCount: exactMatches.length,
    nearMatchCount: nearMatches.length,
    paraphraseCount: paraphraseMatches.length,
    contextualSourceCount: contextualSources.length,
    unverifiableSourceCount: unverifiableSources.length,
    plagiarismRelevantEvidenceCount: exactMatches.length + nearMatches.length + paraphraseMatches.length
  };

  // 4. CALCULATE INTEGRITY CONFIDENCE (Evidence Quality Metric)
  const integrityConfidence = calculateIntegrityConfidence(similarityReport, aiWritingReport, summary);

  // 5. COMPOSE DISCLAIMERS
  const disclaimers = [MANDATORY_PLATFORM_DISCLAIMER];
  if (aiWritingReport.status !== "UNAVAILABLE") {
    disclaimers.push(MANDATORY_AI_DISCLAIMER);
  }
  if (summary.contextualSourceCount > 0) {
    disclaimers.push("Topical and conceptual similarity indicate thematic context, not textual plagiarism.");
  }

  return {
    ok: true,
    report: {
      document: {
        id: analysis?.id || analysis?.analysisId || "VW-SESSION",
        title: analysis?.document?.title || analysis?.title || "Research Document",
        wordCount: analysis?.document?.wordCount || analysis?.fileStats?.wordCount || aiWritingReport.metrics?.wordCount || 0
      },
      similarity: similarityReport,
      aiWriting: aiWritingReport,
      integrityConfidence,
      evidence: {
        exactMatches,
        nearMatches,
        paraphraseMatches,
        contextualSources,
        unverifiableSources
      },
      summary,
      disclaimers
    }
  };
}

module.exports = {
  generateIntegrityReport,
  calculateIntegrityConfidence,
  EVIDENCE_CLASSES,
  MANDATORY_AI_DISCLAIMER,
  MANDATORY_PLATFORM_DISCLAIMER
};
