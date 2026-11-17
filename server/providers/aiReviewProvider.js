/**
 * VeriWrite AI Evidence Review Adapter
 * Direct Gemini AI integration for objective evidence analysis.
 * Strict rules:
 * - Reviews ONLY provided evidence
 * - NEVER invents sources or URLs
 * - Evaluates citation/attribution requirements, never proclaims misconduct as fact
 */

const { reviewEvidenceWithGemini, isGeminiConfigured } = require("../services/geminiService");

async function reviewEvidenceWithAI(evidencePayload = [], options = {}) {
  if (!isGeminiConfigured()) {
    return {
      status: "not_configured",
      available: false,
      message: "Gemini AI review unavailable — configure GEMINI_API_KEY in environment.",
      items: []
    };
  }

  // Format into clean structured evidence items
  const structuredItems = evidencePayload.slice(0, 10).map((p, idx) => ({
    id: p.passageId || p.id || `ev_${idx + 1}`,
    submitted_passage: p.submittedPassage || p.submittedSentence || p.phrase || "",
    source_title: p.sourceTitle || "Web Source",
    source_url: p.sourceUrl || "",
    source_passage: p.sourcePassage || p.sourceSentence || p.phrase || "",
    exact_match_score: p.matchType === "EXACT" ? 100 : (p.exactMatchScore || 0),
    lexical_similarity: p.similarityScore || 0,
    semantic_similarity: p.semanticSimilarity || 0
  }));

  return await reviewEvidenceWithGemini(structuredItems, options);
}

module.exports = {
  reviewEvidenceWithAI
};
