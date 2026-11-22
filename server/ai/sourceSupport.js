/**
 * Checkra AI Agent — Source Support Analysis Module (Phase 7)
 *
 * Evaluates whether retrieved web sources genuinely support, partially support,
 * contradict, or merely relate to a specific factual or research claim.
 *
 * Evidence States:
 * - CLAIM_UNSUPPORTED
 * - SOURCE_DISCOVERED
 * - SOURCE_RETRIEVED
 * - SOURCE_RELEVANT
 * - CLAIM_PARTIALLY_SUPPORTED
 * - CLAIM_SUPPORTED
 * - SOURCE_NOT_VERIFIABLE
 * - INSUFFICIENT_EVIDENCE
 *
 * Support Classifications:
 * - DIRECT_SUPPORT
 * - PARTIAL_SUPPORT
 * - RELATED_ONLY
 * - CONTRADICTS
 * - INSUFFICIENT_EVIDENCE
 * - SOURCE_NOT_VERIFIABLE
 *
 * Source Type Classifications:
 * - PRIMARY_SOURCE
 * - SECONDARY_SOURCE
 * - OFFICIAL_SOURCE
 * - ACADEMIC_SOURCE
 * - NEWS_SOURCE
 * - REFERENCE_SOURCE
 * - UNKNOWN_SOURCE_TYPE
 *
 * STRICT INTEGRITY & EVIDENCE-FIRST RULES:
 * 1. A search snippet is DISCOVERY ONLY. It is NEVER marked CLAIM_SUPPORTED.
 * 2. A source must be safely retrieved and evaluated against the claim.
 * 3. Never invent quotes, authors, DOIs, URLs, or factual findings.
 * 4. Contradictions between sources are reported as CONFLICTING_EVIDENCE.
 */

const { URL } = require("url");
const { fetch_source } = require("./sourceTool");
const { comparePassageWithSourceText } = require("./sourceVerification");
const { classifySource } = require("../providers/sourceClassifier");
const logger = require("../utils/logger");

/**
 * Maps a domain / URL to an observable source classification type.
 * Only classifies when there is sufficient evidence.
 *
 * @param {string} urlString
 * @returns {string} One of OFFICIAL_SOURCE, ACADEMIC_SOURCE, NEWS_SOURCE, REFERENCE_SOURCE, PRIMARY_SOURCE, SECONDARY_SOURCE, UNKNOWN_SOURCE_TYPE
 */
function determineSourceType(urlString) {
  if (!urlString || typeof urlString !== "string") return "UNKNOWN_SOURCE_TYPE";

  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    // 1. Official Government or Intergovernmental
    if (/\.(gov|mil|gov\.[a-z]{2}|who\.int|un\.org|worldbank\.org|imf\.org|europa\.eu)$/i.test(host)) {
      return "OFFICIAL_SOURCE";
    }

    // 2. Academic / University / Scientific Journal
    if (
      /\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/i.test(host) ||
      /(ncbi\.nlm\.nih\.gov|sciencedirect\.com|springer\.com|nature\.com|wiley\.com|ieeexplore\.ieee\.org|jstor\.org|cell\.com|sagepub\.com|frontiersin\.org|plos\.org|biorxiv\.org|arxiv\.org)/i.test(host) ||
      /\/doi\/|\/article\/|\/paper\/|\/journal\//i.test(pathname)
    ) {
      return "ACADEMIC_SOURCE";
    }

    // 3. News / Editorial
    if (
      /(nytimes\.com|bbc\.(com|co\.uk)|reuters\.com|theguardian\.com|washingtonpost\.com|bloomberg\.com|wsj\.com|cnn\.com|apnews\.com|economist\.com)/i.test(host)
    ) {
      return "NEWS_SOURCE";
    }

    // 4. Reference / Encyclopedia / Repository
    if (
      /(wikipedia\.org|britannica\.com|zenodo\.org|figshare\.com|semanticscholar\.org|kaggle\.com|github\.com)/i.test(host)
    ) {
      return "REFERENCE_SOURCE";
    }

    return "UNKNOWN_SOURCE_TYPE";
  } catch (e) {
    return "UNKNOWN_SOURCE_TYPE";
  }
}

/**
 * Evaluates the support relationship between a claim and retrieved source text.
 *
 * @param {string} claim Text of the claim to evaluate
 * @param {string} sourceText Full retrieved source text
 * @param {string} [sourceUrl] Optional source URL
 * @returns {Promise<Object>} Support evaluation outcome
 */
async function evaluateClaimSupport(claim, sourceText, sourceUrl = "") {
  if (!claim || typeof claim !== "string" || !claim.trim()) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      supportType: "INSUFFICIENT_EVIDENCE",
      evidence: "No claim text provided for support evaluation.",
      explanation: "Unable to evaluate support without claim text."
    };
  }

  if (!sourceText || typeof sourceText !== "string" || !sourceText.trim()) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      supportType: "INSUFFICIENT_EVIDENCE",
      evidence: "No retrieved source text provided for evaluation.",
      explanation: "Source text is empty or unavailable."
    };
  }

  const cleanClaim = claim.trim();
  const cleanSource = sourceText.trim();

  // 1. Check for explicit contradiction patterns
  // E.g. Claim asserts growth/positive correlation, but source explicitly refutes, disproves, or asserts opposite
  const contradictionDetected = detectContradiction(cleanClaim, cleanSource);
  if (contradictionDetected.hasContradiction) {
    return {
      status: "CLAIM_UNSUPPORTED",
      supportType: "CONTRADICTS",
      evidence: contradictionDetected.evidence,
      explanation: `The retrieved source presents evidence that contradicts or refutes this claim: ${contradictionDetected.reason}`,
      isVerified: false
    };
  }

  // 2. Perform deterministic comparison using Checkra's multi-level engines
  const comparison = await comparePassageWithSourceText(cleanClaim, cleanSource, sourceUrl);

  // 3. Classify support level
  if (comparison.matchType === "EXACT_MATCH") {
    return {
      status: "CLAIM_SUPPORTED",
      supportType: "DIRECT_SUPPORT",
      evidence: comparison.evidence,
      explanation: "The retrieved source directly affirms and contains exact textual evidence supporting this claim.",
      isVerified: true,
      sourceSimilarity: comparison.sourceSimilarity
    };
  }

  if (comparison.matchType === "NEAR_MATCH" || comparison.matchType === "STRONG_PARAPHRASE") {
    // Check if claim asserts specific quantitative figures not found in source
    const claimStats = cleanClaim.match(/\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s*(?:percent|percentage|billion|million|trillion)\b/gi);
    if (claimStats && claimStats.length > 0) {
      const hasAllStats = claimStats.every(stat => cleanSource.toLowerCase().includes(stat.toLowerCase()));
      if (!hasAllStats) {
        return {
          status: "CLAIM_PARTIALLY_SUPPORTED",
          supportType: "PARTIAL_SUPPORT",
          evidence: comparison.evidence,
          explanation: "The retrieved source provides partial qualitative support, but does not verify the specific quantitative figures or percentages in the claim.",
          isVerified: false,
          sourceSimilarity: comparison.sourceSimilarity
        };
      }
    }

    return {
      status: "CLAIM_SUPPORTED",
      supportType: "DIRECT_SUPPORT",
      evidence: comparison.evidence,
      explanation: "The retrieved source directly substantiates the key propositions and assertions of this claim.",
      isVerified: true,
      sourceSimilarity: comparison.sourceSimilarity
    };
  }

  if (comparison.matchType === "POSSIBLE_PARAPHRASE") {
    return {
      status: "CLAIM_PARTIALLY_SUPPORTED",
      supportType: "PARTIAL_SUPPORT",
      evidence: comparison.evidence,
      explanation: "The retrieved source provides partial support or overlapping context, but may not fully verify all specific details.",
      isVerified: false,
      sourceSimilarity: comparison.sourceSimilarity
    };
  }

  if (comparison.matchType === "CONCEPTUAL_SIMILARITY" || comparison.matchType === "TOPICAL_SIMILARITY") {
    return {
      status: "SOURCE_RELEVANT",
      supportType: "RELATED_ONLY",
      evidence: comparison.evidence,
      explanation: "This source is topically related to the subject matter, but does not provide sufficient empirical evidence to substantiate the specific claim.",
      isVerified: false,
      sourceSimilarity: null
    };
  }

  // If no match found by comparison engine, check for topical keyword overlap
  const claimWords = cleanClaim.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const sourceWords = new Set(cleanSource.toLowerCase().match(/\b[a-z]{4,}\b/g) || []);
  const stopwords = new Set(["this", "that", "with", "from", "have", "were", "been", "their", "there", "about", "which", "would", "could", "should", "other", "after", "before", "during", "these", "those"]);
  const shared = claimWords.filter(w => !stopwords.has(w) && sourceWords.has(w));

  if (shared.length >= 2) {
    return {
      status: "SOURCE_RELEVANT",
      supportType: "RELATED_ONLY",
      evidence: `Source contains shared thematic concepts [${shared.slice(0, 3).join(", ")}], but no textual overlap or direct verification.`,
      explanation: "This source is topically related to the subject matter, but does not provide sufficient empirical evidence to substantiate the specific claim.",
      isVerified: false,
      sourceSimilarity: null
    };
  }

  // If no match or insufficient evidence
  return {
    status: "INSUFFICIENT_EVIDENCE",
    supportType: "INSUFFICIENT_EVIDENCE",
    evidence: "No significant textual or semantic overlap detected in the retrieved source.",
    explanation: "The retrieved source does not contain adequate evidence to confirm or refute the claim.",
    isVerified: false,
    sourceSimilarity: null
  };
}

/**
 * Detects whether source text contains contradictory or refuting statements relative to the claim.
 *
 * @param {string} claim
 * @param {string} sourceText
 * @returns {{ hasContradiction: boolean, evidence: string, reason: string }}
 */
function detectContradiction(claim, sourceText) {
  const claimLower = claim.toLowerCase();
  const sourceLower = sourceText.toLowerCase();

  // Check statistical / quantitative contradiction (e.g. claim: grew by 8%, source: decreased or declined)
  const growthKeywords = /\b(grew|increased|rose|expanded|doubled|tripled|growth of)\b/i;
  const declineKeywords = /\b(decreased|declined|dropped|fell|shrank|contraction of|negative growth)\b/i;

  if (growthKeywords.test(claimLower) && declineKeywords.test(sourceLower)) {
    // Check if both discuss the same subject (e.g. gdp, revenue, sales, rate)
    const subjects = claimLower.match(/\b(gdp|economy|revenue|profit|sales|unemployment|inflation|temperature|rate|cases)\b/gi);
    if (subjects && subjects.some(subj => sourceLower.includes(subj.toLowerCase()))) {
      // Find contradictory sentence in source
      const sentences = sourceText.split(/[.!?\n]+/);
      const contradictorySent = sentences.find(s => declineKeywords.test(s) && subjects.some(subj => s.toLowerCase().includes(subj.toLowerCase())));
      if (contradictorySent) {
        return {
          hasContradiction: true,
          evidence: `Retrieved source states: "${contradictorySent.trim()}"`,
          reason: "Source indicates a decline or negative trend whereas the claim asserts growth."
        };
      }
    }
  }

  // Check explicit refutation markers in source referencing claim keywords
  const refutationPatterns = [
    /\b(?:is false|has been disproven|contrary to popular belief|refuted by|no evidence supports the claim that|no correlation was found)\b/i
  ];

  for (const pat of refutationPatterns) {
    if (pat.test(sourceLower)) {
      const sentences = sourceText.split(/[.!?\n]+/);
      const refutingSent = sentences.find(s => pat.test(s));
      if (refutingSent) {
        return {
          hasContradiction: true,
          evidence: `Retrieved source states: "${refutingSent.trim()}"`,
          reason: "Source contains explicit refutation or evidence contrary to the claim."
        };
      }
    }
  }

  return { hasContradiction: false, evidence: "", reason: "" };
}

/**
 * Evaluates multiple sources against a single claim and identifies consensus or contradiction.
 *
 * @param {string} claim
 * @param {Array<Object>} evaluatedSources
 * @returns {Object} Multi-source synthesis
 */
function synthesizeSourceConsensus(claim, evaluatedSources = []) {
  if (!evaluatedSources || evaluatedSources.length === 0) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      consensus: "NO_SOURCES_AVAILABLE",
      conflictDetected: false,
      summary: "No candidate sources were evaluated for this claim."
    };
  }

  const supportedSources = evaluatedSources.filter(s => s.supportType === "DIRECT_SUPPORT" || s.status === "CLAIM_SUPPORTED");
  const contradictingSources = evaluatedSources.filter(s => s.supportType === "CONTRADICTS");
  const partialSources = evaluatedSources.filter(s => s.supportType === "PARTIAL_SUPPORT" || s.status === "CLAIM_PARTIALLY_SUPPORTED");
  const relatedSources = evaluatedSources.filter(s => s.supportType === "RELATED_ONLY" || s.status === "SOURCE_RELEVANT");

  // Contradiction Check: If at least one source supports and another contradicts
  if (supportedSources.length > 0 && contradictingSources.length > 0) {
    return {
      status: "CONFLICTING_EVIDENCE",
      consensus: "CONFLICTING_EVIDENCE",
      conflictDetected: true,
      supportingCount: supportedSources.length,
      contradictingCount: contradictingSources.length,
      summary: `Conflicting evidence detected: ${supportedSources.length} source(s) support the claim while ${contradictingSources.length} source(s) provide contradictory evidence.`
    };
  }

  if (contradictingSources.length > 0 && supportedSources.length === 0) {
    return {
      status: "CLAIM_UNSUPPORTED",
      consensus: "CONTRADICTED",
      conflictDetected: false,
      summary: "Available retrieved source evidence contradicts this claim."
    };
  }

  if (supportedSources.length > 0) {
    return {
      status: "CLAIM_SUPPORTED",
      consensus: "SUPPORTED",
      conflictDetected: false,
      summary: `Claim is supported by ${supportedSources.length} verified source(s).`
    };
  }

  if (partialSources.length > 0) {
    return {
      status: "CLAIM_PARTIALLY_SUPPORTED",
      consensus: "PARTIALLY_SUPPORTED",
      conflictDetected: false,
      summary: `Claim is partially supported by ${partialSources.length} source(s).`
    };
  }

  if (relatedSources.length > 0) {
    return {
      status: "SOURCE_RELEVANT",
      consensus: "RELATED_ONLY",
      conflictDetected: false,
      summary: "Evaluated sources are topically related but do not verify the specific claim."
    };
  }

  return {
    status: "INSUFFICIENT_EVIDENCE",
    consensus: "INSUFFICIENT_EVIDENCE",
    conflictDetected: false,
    summary: "Available retrieved sources do not contain sufficient evidence to evaluate this claim."
  };
}

module.exports = {
  determineSourceType,
  evaluateClaimSupport,
  detectContradiction,
  synthesizeSourceConsensus
};
