/**
 * Checkra AI Agent — Claim Extraction & Classification Module (Phase 7)
 *
 * Extracts potentially research-relevant claims from submitted text.
 * Strictly preserves source text spans without inventing claims.
 *
 * Claim Classifications:
 * - STATISTICAL: Quantitative metrics, percentages, numbers with units
 * - HISTORICAL: Past historical events, dates, historical milestones
 * - CAUSAL: Cause-and-effect assertions
 * - COMPARATIVE: Relative comparisons between entities or rates
 * - DEFINITIONAL: Conceptual or technical definitions
 * - FACTUAL: Objective statements of reality
 * - OPINION: Subjective value judgments, personal stances
 * - INTERPRETATION: Interpretive commentary or theoretical speculation
 *
 * SAFETY INVARIANTS:
 * 1. Every extracted claim originates from the user's text (text.slice(start, end) === claim.text).
 * 2. Opinions and interpretations are NOT flagged as unsupported factual claims (requiresEvidence = false).
 * 3. Never invents claims, data, or assertions.
 */

/**
 * Classifies a single sentence string into a specific claim category.
 *
 * @param {string} sentence
 * @returns {{ type: string, requiresEvidence: boolean, confidence: string, reason: string }}
 */
function classifyClaimType(sentence = "") {
  const s = sentence.trim();
  const lower = s.toLowerCase();

  // 1. Check for subjective OPINION markers
  const opinionPatterns = [
    /\b((?:i|we)\s+(?:believe|think|feel|argue|consider|propose|suggest)|in (?:my|our) (?:opinion|view|judgment)|personally|from (?:my|our) perspective)\b/i,
    /\b(is wonderful|is terrible|is the best|is the worst|is amazing|is beautiful|is awful|is brilliant|is hideous)\b/i
  ];
  for (const pat of opinionPatterns) {
    if (pat.test(s)) {
      return {
        type: "OPINION",
        requiresEvidence: false,
        confidence: "HIGH",
        reason: "Contains first-person subjective viewpoint or value judgment."
      };
    }
  }

  // 2. Check for INTERPRETATION / Speculative hedges
  const interpretationPatterns = [
    /\b(might suggest|could imply|one possible interpretation|may indicate that|seems plausible that|can be interpreted as|suggests that the|the findings hint that)\b/i,
    /\b(it is hypothesized that|we speculate that|could be seen as)\b/i
  ];
  for (const pat of interpretationPatterns) {
    if (pat.test(s)) {
      return {
        type: "INTERPRETATION",
        requiresEvidence: false,
        confidence: "MEDIUM",
        reason: "Contains interpretive or speculative framing."
      };
    }
  }

  // 3. Check for STATISTICAL claims (numbers, percentages, metrics)
  const statisticalPatterns = [
    /(?:\b\d+(?:\.\d+)?%|\$\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:percent|percentage|billion|million|trillion|tons|kg|km|miles|millimeters|mm|cm|meters|degrees|degree|fold|participants|respondents|patients|cases)\b)/i,
    /\b(?:increased|decreased|grew|dropped|rose|risen|fallen|average|rate)\s+(?:by|of|to|at)?\s*\d+(?:\.\d+)?/i,
    /\bp\s*[<>=]\s*0\.\d+/i
  ];
  for (const pat of statisticalPatterns) {
    if (pat.test(s)) {
      return {
        type: "STATISTICAL",
        requiresEvidence: true,
        confidence: "HIGH",
        reason: "Asserts specific numerical, percentage, or quantitative metrics."
      };
    }
  }

  // 4. Check for HISTORICAL claims (dates, historical events, past milestones)
  const historicalPatterns = [
    /\b(?:in (?:1[0-9]\d{2}|20[0-2]\d)|during (?:the\s+)?(?:world war|cold war|renaissance|middle ages|industrial revolution|\d+(?:th|st|nd|rd)\s+century))\b/i,
    /\b(?:was founded in|was established in|was signed in|originated in|took place in \d{4}|ended in \d{4}|started in \d{4}|treaty of)\b/i
  ];
  for (const pat of historicalPatterns) {
    if (pat.test(s)) {
      return {
        type: "HISTORICAL",
        requiresEvidence: true,
        confidence: "HIGH",
        reason: "Asserts historical events, chronological milestones, or specific historical dates."
      };
    }
  }

  // 5. Check for CAUSAL claims
  const causalPatterns = [
    /\b(causes?|caused by|leads? to|led to|results? from|resulting in|due to|is responsible for|triggers?|triggered by|induces?|induce|driving factor behind)\b/i
  ];
  for (const pat of causalPatterns) {
    if (pat.test(s)) {
      return {
        type: "CAUSAL",
        requiresEvidence: true,
        confidence: "HIGH",
        reason: "Asserts a direct cause-and-effect or causal relationship."
      };
    }
  }

  // 6. Check for COMPARATIVE claims
  const comparativePatterns = [
    /\b(more than|less than|higher than|lower than|faster than|slower than|greater than|superior to|inferior to|compared (?:to|with)|in comparison with|outperformed|surpassed)\b/i
  ];
  for (const pat of comparativePatterns) {
    if (pat.test(s)) {
      return {
        type: "COMPARATIVE",
        requiresEvidence: true,
        confidence: "HIGH",
        reason: "Compares metrics, performance, or attributes across entities."
      };
    }
  }

  // 7. Check for DEFINITIONAL claims
  const definitionalPatterns = [
    /\b(is defined as|refers to|is the process of|denotes|is characterized by|is understood as|is known as a|can be defined as|meaning of)\b/i
  ];
  for (const pat of definitionalPatterns) {
    if (pat.test(s)) {
      return {
        type: "DEFINITIONAL",
        requiresEvidence: true,
        confidence: "HIGH",
        reason: "Provides a formal or categorical conceptual definition."
      };
    }
  }

  // 8. Default: General FACTUAL assertion if it makes an empirical declaration
  return {
    type: "FACTUAL",
    requiresEvidence: true,
    confidence: "MEDIUM",
    reason: "Asserts an empirical or factual proposition about reality."
  };
}

/**
 * Extracts candidate claim segments with exact character spans from document text.
 *
 * @param {string} text Input document text
 * @param {Object} [options] Extraction options
 * @returns {Object} Structured claim extraction result
 */
function extractClaims(text, options = {}) {
  if (text === null || text === undefined || typeof text !== "string") {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "Text must be a non-empty string.",
      claims: [],
      stats: { totalClaims: 0, requiresEvidenceCount: 0 }
    };
  }

  const cleanText = text;
  if (!cleanText.trim()) {
    return {
      ok: true,
      claims: [],
      stats: {
        totalClaims: 0,
        factualCount: 0,
        statisticalCount: 0,
        historicalCount: 0,
        causalCount: 0,
        comparativeCount: 0,
        definitionalCount: 0,
        opinionCount: 0,
        interpretationCount: 0,
        requiresEvidenceCount: 0
      }
    };
  }

  const claims = [];
  // Sentence splitting regex that tracks index positions
  const sentenceRegex = /[^.!?\n]+(?:[.!?]+(?=\s+|$)|$)/g;
  let match;
  let claimIndex = 1;

  while ((match = sentenceRegex.exec(cleanText)) !== null) {
    const rawMatch = match[0];
    if (!rawMatch || !rawMatch.trim()) continue;

    // Calculate exact trimmed start and end indices
    const leadingWsMatch = rawMatch.match(/^\s*/);
    const leadingWs = leadingWsMatch ? leadingWsMatch[0].length : 0;
    const trailingWsMatch = rawMatch.match(/\s*$/);
    const trailingWs = trailingWsMatch ? trailingWsMatch[0].length : 0;

    const trimmedText = rawMatch.trim();
    // Filter out very short noise fragments (e.g., abbreviations or single punctuation)
    if (trimmedText.length < 5 || !/[a-zA-Z0-9]/.test(trimmedText)) {
      continue;
    }

    const start = match.index + leadingWs;
    const end = match.index + rawMatch.length - trailingWs;

    // Strict invariant check: slice must match trimmed text exactly
    const sliceCheck = cleanText.slice(start, end);
    if (sliceCheck !== trimmedText) {
      continue;
    }

    const classification = classifyClaimType(trimmedText);
    const claimId = `claim-${String(claimIndex++).padStart(3, "0")}`;

    claims.push({
      claimId,
      text: trimmedText,
      start,
      end,
      type: classification.type,
      requiresEvidence: classification.requiresEvidence,
      confidence: classification.confidence,
      reason: classification.reason
    });
  }

  // Calculate breakdown statistics
  const stats = {
    totalClaims: claims.length,
    factualCount: claims.filter(c => c.type === "FACTUAL").length,
    statisticalCount: claims.filter(c => c.type === "STATISTICAL").length,
    historicalCount: claims.filter(c => c.type === "HISTORICAL").length,
    causalCount: claims.filter(c => c.type === "CAUSAL").length,
    comparativeCount: claims.filter(c => c.type === "COMPARATIVE").length,
    definitionalCount: claims.filter(c => c.type === "DEFINITIONAL").length,
    opinionCount: claims.filter(c => c.type === "OPINION").length,
    interpretationCount: claims.filter(c => c.type === "INTERPRETATION").length,
    requiresEvidenceCount: claims.filter(c => c.requiresEvidence).length
  };

  return {
    ok: true,
    claims,
    stats
  };
}

module.exports = {
  classifyClaimType,
  extractClaims
};
