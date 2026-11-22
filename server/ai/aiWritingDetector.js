/**
 * Checkra AI Writing Detection — Core Detector Coordinator
 *
 * Coordinates:
 * 1. Safe text validation
 * 2. Deterministic stylometric & structural feature extraction
 * 3. Deterministic likelihood scoring & thresholding
 * 4. Optional qualitative secondary assessment via Qwen3 1.7B
 * 5. Strict score protection: Qwen can NEVER override or recalculate the likelihood score
 * 6. Graceful degradation when Ollama is offline
 */

const { extractStylometricFeatures } = require("./aiWritingFeatures");
const { classifyAiWriting, MANDATORY_DISCLAIMER } = require("./aiWritingClassifier");
const { generateAiCompletion, checkAiHealth } = require("./model");
const logger = require("../utils/logger");

/**
 * Executes qualitative review with Qwen3 1.7B if available.
 * Strictly qualitative: NEVER asks Qwen for a percentage or allows Qwen to override score.
 *
 * @param {string} text Sample text (truncated to safe size)
 * @param {Object} deterministicResult Deterministic classification
 * @returns {Promise<Object>} Qualitative review result
 */
async function getQualitativeAssessment(text, deterministicResult) {
  try {
    const health = await checkAiHealth();
    if (!health.ok) {
      return {
        status: "UNAVAILABLE",
        available: false,
        reason: "Local AI provider is offline; assessment evaluated deterministically."
      };
    }

    const sample = text.slice(0, 3000);
    const systemPrompt = `You are Checkra's qualitative writing style assessor.
Assess the following text for linguistic cadence, structural uniformity, and transition patterns.
DO NOT provide any percentage, numerical probability, or score.
DO NOT claim certainty of authorship.
Evaluate whether the qualitative style supports, is neutral toward, or contradicts stylistic characteristics commonly observed in AI-generated text.

Respond ONLY with a JSON object in this exact schema:
{
  "assessment": "supports" | "neutral" | "contradicts",
  "reason": "A 1-2 sentence qualitative observation of cadence, transitions, or variation."
}`;

    const completion = await generateAiCompletion(sample, {
      systemPrompt,
      temperature: 0.1,
      timeoutMs: 8000
    });

    if (!completion || !completion.ok || !completion.content) {
      return {
        status: "UNAVAILABLE",
        available: false,
        reason: "Qualitative review could not be completed; evaluated deterministically."
      };
    }

    let cleaned = completion.content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(cleaned);
    const validAssessments = ["supports", "neutral", "contradicts"];
    const assessment = validAssessments.includes(parsed.assessment?.toLowerCase())
      ? parsed.assessment.toLowerCase()
      : "neutral";

    // Sanitize reason to remove any accidental numeric percentages
    let reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "Qualitative observation completed.";
    reason = reason.replace(/\b\d{1,3}%\b/g, "[score omitted]");

    return {
      status: "COMPLETED",
      available: true,
      assessment,
      reason,
      model: completion.model || "qwen3:1.7b"
    };
  } catch (err) {
    logger.debug("Qualitative assessment skipped or errored", { error: err.message });
    return {
      status: "UNAVAILABLE",
      available: false,
      reason: "Qualitative evaluation unavailable; evaluated deterministically."
    };
  }
}

/**
 * Main AI Writing Detector function.
 * Evaluates document text for characteristics associated with AI generation.
 *
 * @param {string} text Document text
 * @param {Object} [options]
 * @param {boolean} [options.skipQualitative=false] If true, skips LLM query
 * @returns {Promise<Object>} Comprehensive AI writing assessment
 */
async function detectAiWriting(text, options = {}) {
  if (text === null || text === undefined || typeof text !== "string") {
    return {
      status: "ERROR",
      error: "INVALID_INPUT",
      message: "Input text must be a valid non-empty string.",
      likelihood: null,
      confidence: "NONE",
      disclaimer: MANDATORY_DISCLAIMER
    };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      status: "ERROR",
      error: "EMPTY_TEXT",
      message: "Input text contains no readable characters.",
      likelihood: null,
      confidence: "NONE",
      disclaimer: MANDATORY_DISCLAIMER
    };
  }

  // 1. Extract Deterministic Stylometric Features
  const features = extractStylometricFeatures(trimmed);

  // 2. Classify Features Deterministically
  const deterministicResult = classifyAiWriting(features, options);

  // If text is insufficient, return immediately without calling LLM
  if (deterministicResult.status === "INSUFFICIENT_TEXT") {
    return {
      status: deterministicResult.status,
      likelihood: null,
      confidence: deterministicResult.confidence,
      signals: deterministicResult.signals,
      metrics: deterministicResult.metrics,
      limitations: deterministicResult.limitations,
      disclaimer: deterministicResult.disclaimer
    };
  }

  // 3. Optional Qualitative Assessment (Secondary Signal)
  let qualitativeReview = {
    status: "SKIPPED",
    available: false,
    reason: "Qualitative review was not requested."
  };

  if (!options.skipQualitative) {
    qualitativeReview = await getQualitativeAssessment(trimmed, deterministicResult);
  }

  // 4. Return Final Structured Result
  // NOTE: likelihood remains strictly deterministic and immutable!
  return {
    status: deterministicResult.status,
    likelihood: deterministicResult.likelihood,
    confidence: deterministicResult.confidence,
    signals: deterministicResult.signals,
    metrics: deterministicResult.metrics,
    qualitativeReview,
    limitations: deterministicResult.limitations,
    disclaimer: deterministicResult.disclaimer
  };
}

module.exports = {
  detectAiWriting,
  extractStylometricFeatures,
  classifyAiWriting,
  MANDATORY_DISCLAIMER
};
