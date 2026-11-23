/**
 * Checkra AI Evidence Review Adapter
 * Dual-Provider Evidence Review (Local Ollama + Vercel Production Gemini)
 *
 * Strict integrity rules:
 * - Reviews ONLY provided evidence
 * - NEVER invents sources or URLs
 * - Evaluates citation/attribution requirements, never proclaims misconduct as fact
 * - Zero passages never returns false success (returns SKIPPED)
 */

const { reviewEvidenceWithGemini, isGeminiConfigured } = require("../services/geminiService");
const { getAiConfig, checkAiHealth, generateAiCompletion } = require("../ai/model");
const logger = require("../utils/logger");

async function reviewEvidenceWithAI(evidencePayload = [], options = {}) {
  // 1. Guard against empty passages — NEVER report false success
  if (!evidencePayload || !Array.isArray(evidencePayload) || evidencePayload.length === 0) {
    return {
      status: "SKIPPED",
      state: "NO_PASSAGES_TO_REVIEW",
      available: false,
      retryable: false,
      message: "No passages met the criteria for AI evidence review.",
      items: []
    };
  }

  // 2. Format into clean structured evidence items
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

  const config = getAiConfig();

  // ==========================================
  // CASE A: GEMINI PROVIDER
  // ==========================================
  if (config.provider === "gemini") {
    if (!config.configured && !isGeminiConfigured()) {
      return {
        status: "NOT_CONFIGURED",
        state: "AI_REVIEW_NOT_CONFIGURED",
        available: false,
        retryable: false,
        provider: "gemini",
        message: "Gemini AI review unavailable — configure GEMINI_API_KEY in environment.",
        items: []
      };
    }

    return await reviewEvidenceWithGemini(structuredItems, options);
  }

  // ==========================================
  // CASE B: OLLAMA LOCAL PROVIDER
  // ==========================================
  if (config.provider === "ollama") {
    const health = await checkAiHealth({ provider: "ollama" });
    if (!health.ok || !health.available) {
      return {
        status: "UNAVAILABLE",
        state: "AI_REVIEW_UNAVAILABLE",
        available: false,
        retryable: true,
        provider: "ollama",
        model: config.model,
        message: "Ollama local AI is offline or unavailable. Similarity scores remain completely valid.",
        items: []
      };
    }

    const systemPrompt = `You are the Checkra Research Integrity & Evidence Review Layer.
CRITICAL INTEGRITY RULES:
1. Review ONLY the supplied evidence items (submitted passages and retrieved source passages).
2. NEVER invent sources, URLs, authors, journals, or quotations.
3. NEVER accuse the author of deliberate plagiarism or academic misconduct.
4. For each evidence item, classify the confidence of the match as:
   - "HIGH CONFIDENCE MATCH"
   - "POSSIBLE MATCH"
   - "LOW CONFIDENCE"
   - "NOT A MATCH"
5. For each item provide:
   - id: match the input id
   - classification: one of the 4 categories above
   - reason: concise explanation of wording overlap or alignment
   - citation_status: "CITATION_NEEDED", "PROPERLY_ATTRIBUTED", "COMMON_KNOWLEDGE", or "NEEDS_INVESTIGATION"
6. Output MUST be ONLY valid JSON matching this structure:
{
  "summary": "1-2 sentence objective assessment of overall evidence overlap",
  "items": [
    {
      "id": "ev_1",
      "classification": "HIGH CONFIDENCE MATCH",
      "reason": "String",
      "citation_status": "CITATION_NEEDED"
    }
  ]
}`;

    const prompt = `Review these candidate matched passages objectively against retrieved sources:\n\n${JSON.stringify(structuredItems, null, 2)}`;

    try {
      const completion = await generateAiCompletion(prompt, {
        systemPrompt,
        timeoutMs: options.timeoutMs || 45000,
        temperature: 0.1
      });

      if (!completion || !completion.ok || !completion.response) {
        return {
          status: "UNAVAILABLE",
          state: "AI_REVIEW_UNAVAILABLE",
          available: false,
          retryable: true,
          provider: "ollama",
          model: config.model,
          message: completion?.message || "Ollama evidence review was unable to generate a response.",
          items: []
        };
      }

      let parsed;
      try {
        const clean = completion.response.replace(/```(?:json)?/gi, "").trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : clean);
      } catch (jsonErr) {
        logger.warn("Ollama evidence review output was not valid JSON", { raw: completion.response.slice(0, 200) });
        return {
          status: "UNAVAILABLE",
          state: "AI_REVIEW_UNAVAILABLE",
          available: false,
          retryable: true,
          provider: "ollama",
          model: config.model,
          message: "AI evidence review returned non-standard format. Similarity scores remain completely valid.",
          items: []
        };
      }

      return {
        status: "SUCCESS",
        state: "COMPLETED",
        available: true,
        retryable: false,
        provider: "ollama",
        model: config.model,
        summary: parsed.summary || "Ollama AI evidence review completed.",
        items: Array.isArray(parsed.items) ? parsed.items : []
      };
    } catch (err) {
      logger.error("Ollama evidence review failed", { error: err.message });
      return {
        status: "UNAVAILABLE",
        state: "AI_REVIEW_UNAVAILABLE",
        available: false,
        retryable: true,
        provider: "ollama",
        model: config.model,
        message: "Ollama evidence review encountered an error.",
        items: []
      };
    }
  }

  // ==========================================
  // CASE C: UNSUPPORTED PROVIDER
  // ==========================================
  return {
    status: "NOT_CONFIGURED",
    state: "AI_REVIEW_NOT_CONFIGURED",
    available: false,
    retryable: false,
    message: `Unsupported AI provider '${config.provider}'.`,
    items: []
  };
}

module.exports = {
  reviewEvidenceWithAI
};
