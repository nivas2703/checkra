/**
 * Checkra AI Writing Detection — Deterministic Classifier & Signal Synthesizer
 *
 * Evaluates extracted stylometric features against probabilistic statistical baselines:
 * - Sentence length coefficient of variation (CV) & rhythm burstiness
 * - Formal transition word and phrase frequency
 * - Paragraph uniformity
 * - Repetitive sentence lead syntax
 *
 * Enforces strict text-length safety gating:
 * - < 50 words: INSUFFICIENT_TEXT, likelihood = null (never fabricate 0%)
 * - 50-99 words: LIMITED_EVIDENCE, confidence = "LOW"
 * - 100-199 words: ANALYZED, confidence = "MEDIUM"
 * - 200+ words: ANALYZED, confidence = "HIGH"
 *
 * Enforces absolute separation from similarity/plagiarism metrics.
 */

const MANDATORY_DISCLAIMER = "AI-writing detection is probabilistic, stylometric, and cannot establish authorship with certainty.";

/**
 * Classifies stylometric features into a deterministic AI-writing likelihood score,
 * confidence tier, interpretable signals, and transparency limitations.
 *
 * @param {Object} features Metrics from extractStylometricFeatures()
 * @param {Object} [options]
 * @returns {Object} Deterministic classification result
 */
function classifyAiWriting(features, options = {}) {
  const wordCount = features?.wordCount || 0;

  // 1. SHORT TEXT SAFETY GATING (< 50 words)
  if (wordCount < 50) {
    return {
      status: "INSUFFICIENT_TEXT",
      likelihood: null,
      confidence: "NONE",
      signals: [],
      metrics: {
        wordCount,
        sentenceCount: features?.sentenceCount || 0,
        avgSentenceLength: features?.avgSentenceLength || 0,
        sentenceLengthCV: features?.sentenceLengthCV || 0,
        burstinessScore: features?.burstinessScore || 0,
        transitionDensity: features?.transitionDensity || 0,
        typeTokenRatio: features?.typeTokenRatio || 0
      },
      limitations: [
        "Document contains insufficient text (< 50 words) for reliable statistical stylometric analysis."
      ],
      disclaimer: MANDATORY_DISCLAIMER
    };
  }

  // 2. DETERMINE CONFIDENCE & STATUS BASED ON SAMPLE LENGTH
  let status = "ANALYZED";
  let confidence = "HIGH";
  const limitations = [];

  if (wordCount < 100) {
    status = "LIMITED_EVIDENCE";
    confidence = "LOW";
    limitations.push("Analysis is based on a limited text sample (50-99 words); statistical confidence is low.");
  } else if (wordCount < 200) {
    status = "ANALYZED";
    confidence = "MEDIUM";
    limitations.push("Analysis is based on a moderate text sample (100-199 words); statistical indicators are indicative but not definitive.");
  } else {
    status = "ANALYZED";
    confidence = "HIGH";
    limitations.push("Probabilistic stylometric assessment based on extensive text sample (200+ words).");
  }

  limitations.push(MANDATORY_DISCLAIMER);

  // 3. STATISTICAL FEATURE SCORING (Deterministic)
  // Baseline neutral likelihood: 20 (calibrated to prevent unearned priors)
  let rawScore = 20;
  const signals = [];

  const cv = features.sentenceLengthCV;
  const burstiness = features.burstinessScore;
  const transDensity = features.transitionDensity;
  const leadRep = features.leadRepetitionRatio;
  const paragraphCV = features.paragraphCV;
  const pCount = features.paragraphCount;
  const ttr = features.typeTokenRatio;

  // Feature A: Sentence length CV (Low CV = uniform sentence lengths characteristic of LLMs)
  if (cv < 0.20) {
    rawScore += 24;
    signals.push("HIGH_UNIFORMITY");
    signals.push("LOW_SENTENCE_VARIATION");
  } else if (cv < 0.28) {
    rawScore += 16;
    signals.push("LOW_SENTENCE_VARIATION");
  } else if (cv < 0.35) {
    rawScore += 8;
  } else if (cv >= 0.50) {
    rawScore -= 18;
    signals.push("HIGH_VARIATION");
  } else if (cv >= 0.42) {
    rawScore -= 10;
  }

  // Feature B: Consecutive sentence rhythm / burstiness delta (scaled to avoid double-counting with CV)
  if (burstiness < 0.22) {
    rawScore += 10;
    if (!signals.includes("HIGH_UNIFORMITY")) signals.push("HIGH_UNIFORMITY");
  } else if (burstiness < 0.32) {
    rawScore += 5;
  } else if (burstiness >= 0.45) {
    rawScore -= 14;
    signals.push("NATURAL_BURSTINESS");
  }

  // Feature C: Rhetorical transition density (e.g. "Furthermore", "Moreover", "In conclusion")
  if (transDensity >= 3.0) {
    rawScore += 26;
    signals.push("HIGH_TRANSITION_DENSITY");
  } else if (transDensity >= 1.8) {
    rawScore += 18;
    signals.push("HIGH_TRANSITION_DENSITY");
  } else if (transDensity >= 1.0) {
    rawScore += 8;
  } else if (transDensity === 0) {
    rawScore -= 14; // Stronger dampener for complete absence of LLM transition signposts
  } else if (transDensity < 0.8) {
    rawScore -= 6;
  }

  // Feature D: Compound Evidence Interaction
  // Low CV combined with elevated transition density is the quintessential LLM signature
  if (cv < 0.25 && transDensity >= 2.0) {
    rawScore += 12; // Compound alignment bonus
  }

  // Feature E: Repetitive sentence lead structures
  if (leadRep >= 0.28) {
    rawScore += 12;
    signals.push("HIGH_STRUCTURAL_REGULARITY");
  } else if (leadRep >= 0.18) {
    rawScore += 6;
  }

  // Feature F: Paragraph uniformity (when multi-paragraph text is provided)
  if (pCount >= 2) {
    if (paragraphCV < 0.22) {
      rawScore += 8;
      if (!signals.includes("HIGH_UNIFORMITY")) signals.push("HIGH_UNIFORMITY");
    } else if (paragraphCV > 0.55) {
      rawScore -= 8;
    }
  }

  // Feature G: Lexical diversity moderation
  if (ttr >= 0.60 && wordCount >= 60) {
    rawScore -= 10; // Rich vocabulary moderates false positives in human professional/academic writing
  } else if (ttr < 0.45 && wordCount > 100) {
    rawScore += 6;
    signals.push("LOW_LEXICAL_VARIATION");
  }

  // Bound likelihood strictly between 0 and 100
  const likelihood = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Deduplicate signals
  const uniqueSignals = Array.from(new Set(signals));

  return {
    status,
    likelihood,
    confidence,
    signals: uniqueSignals,
    metrics: {
      wordCount,
      sentenceCount: features.sentenceCount,
      avgSentenceLength: features.avgSentenceLength,
      sentenceLengthCV: features.sentenceLengthCV,
      burstinessScore: features.burstinessScore,
      transitionDensity: features.transitionDensity,
      typeTokenRatio: features.typeTokenRatio,
      paragraphCount: features.paragraphCount,
      paragraphCV: features.paragraphCV
    },
    limitations,
    disclaimer: MANDATORY_DISCLAIMER
  };
}

module.exports = {
  classifyAiWriting,
  MANDATORY_DISCLAIMER
};
