/**
 * Checkra AI Agent — Source Verification Module (Phase 3.1)
 *
 * Implements candidate source verification against document passages.
 *
 * STRICT ARCHITECTURAL & SCORE SEMANTICS RULES:
 * 1. A search snippet is DISCOVERY ONLY; it is NEVER marked VERIFIED.
 * 2. A source is marked VERIFIED ONLY after actual source retrieval and comparison.
 * 3. Never invent source text or quotes.
 * 4. Calls the existing Checkra deterministic comparison engines (exactMatcher, nearMatcher, semanticMatcher).
 * 5. Does NOT invent its own cosine formula, scoring formula, or thresholds.
 * 6. Distinguishes EXACT_MATCH, NEAR_MATCH, STRONG_PARAPHRASE, POSSIBLE_PARAPHRASE,
 *    CONCEPTUAL_SIMILARITY, TOPICAL_SIMILARITY, and NO_MATCH.
 * 7. TOPICAL_SIMILARITY and CONCEPTUAL_SIMILARITY MUST NEVER be presented as an authoritative
 *    plagiarism or similarity percentage. For topical/conceptual, sourceSimilarity is strictly null.
 * 8. Only actual deterministic matches (EXACT, NEAR, STRONG_PARAPHRASE) have a sourceSimilarity value,
 *    and it strictly reflects source-level comparison, NOT document-level plagiarism.
 */

const { findExactMatches, toExactTokens } = require("../analysis/exactMatcher");
const { findNearMatches } = require("../analysis/nearMatcher");
const { findSemanticMatches } = require("../analysis/semanticMatcher");
const { splitIntoSentences } = require("../document/preprocessor");
const { fetch_source } = require("./sourceTool");
const { extractDomain } = require("./webSearchTool");
const { classifySource } = require("../providers/sourceClassifier");
const logger = require("../utils/logger");

/**
 * Compares a document passage against retrieved source text using
 * Checkra's authoritative deterministic multi-level comparison engines.
 *
 * @param {string} passage Document passage to verify
 * @param {string} sourceText Full text retrieved from the candidate source
 * @param {string} sourceUrl URL of the candidate source
 * @returns {Promise<Object>} Deterministic comparison metrics
 */
async function comparePassageWithSourceText(passage, sourceText, sourceUrl) {
  if (!passage || !sourceText) {
    return {
      matchType: "NO_MATCH",
      status: "NO_MATCH",
      sourceSimilarity: null,
      evidence: "Insufficient text provided for comparison.",
      isVerified: false
    };
  }

  const subSentences = splitIntoSentences(passage);
  const srcSentences = splitIntoSentences(sourceText);

  // 1. Level 1 Exact Match Check
  const subTokens = toExactTokens(passage);
  const srcTokens = toExactTokens(sourceText);
  const exactResult = findExactMatches(subTokens, srcTokens, 5, sourceUrl);

  if (exactResult.matches && exactResult.matches.length > 0) {
    const phrase = exactResult.matches.map(m => `"${m.phrase}"`).slice(0, 3).join(", ");
    const exactPercent = exactResult.exactOverlapPercent || 100;
    return {
      matchType: "EXACT_MATCH",
      status: "VERIFIED",
      sourceSimilarity: `${exactPercent}%`,
      evidence: `The retrieved source contains an exact textual match (${exactResult.totalMatchedTokens} words): ${phrase}`,
      matchesCount: exactResult.matches.length,
      isVerified: true
    };
  }

  // 2. Level 2 Near Match / Lexical Paraphrase Check
  if (subSentences.length > 0 && srcSentences.length > 0) {
    const nearMatches = findNearMatches(subSentences, srcSentences, 0.45);
    if (nearMatches && nearMatches.length > 0) {
      const bestNear = nearMatches[0];
      const distinctiveStr = bestNear.distinctiveTerms?.join(", ") || "";
      return {
        matchType: "NEAR_MATCH",
        status: "VERIFIED",
        sourceSimilarity: `${bestNear.similarityScore}%`,
        evidence: `The retrieved source contains a near textual match: "${bestNear.submittedSentence}" matched source with shared terms [${distinctiveStr}]`,
        matchesCount: nearMatches.length,
        isVerified: true
      };
    }
  }

  // 3. Level 3 Semantic Similarity Check
  if (subSentences.length > 0 && srcSentences.length > 0) {
    try {
      const semanticResult = await findSemanticMatches(subSentences, srcSentences);
      const matches = semanticResult.matches || [];

      if (matches.length > 0) {
        const priorityOrder = {
          "EXACT_MATCH": 7,
          "NEAR_MATCH": 6,
          "STRONG_PARAPHRASE": 5,
          "POSSIBLE_PARAPHRASE": 4,
          "CONCEPTUAL_SIMILARITY": 3,
          "TOPICAL_SIMILARITY": 2,
          "NO_MATCH": 1
        };

        matches.sort((a, b) => (priorityOrder[b.classification] || 0) - (priorityOrder[a.classification] || 0));
        const topMatch = matches[0];
        const classification = topMatch.classification;
        const simScore = topMatch.semanticSimilarityPercent || Math.round(topMatch.similarityScore || 0);

        if (classification === "STRONG_PARAPHRASE") {
          return {
            matchType: "STRONG_PARAPHRASE",
            status: "VERIFIED",
            sourceSimilarity: `${simScore}%`,
            evidence: `The retrieved source contains evidence of strong paraphrased overlap: ${topMatch.description || "Shared distinctive sentence structure"}`,
            isVerified: true
          };
        } else if (classification === "POSSIBLE_PARAPHRASE") {
          return {
            matchType: "POSSIBLE_PARAPHRASE",
            status: "POSSIBLE",
            sourceSimilarity: `${simScore}%`,
            evidence: `The retrieved source contains evidence of possible paraphrased overlap (${simScore}% lexical similarity): ${topMatch.description || "Moderate lexical and conceptual overlap"}`,
            isVerified: false
          };
        } else if (classification === "CONCEPTUAL_SIMILARITY") {
          // Rule: CONCEPTUAL_SIMILARITY must NEVER produce a source similarity percentage
          return {
            matchType: "CONCEPTUAL_SIMILARITY",
            status: "RETRIEVED",
            sourceSimilarity: null,
            evidence: "The source discusses related concepts, but this does not by itself establish plagiarism.",
            isVerified: false
          };
        } else if (classification === "TOPICAL_SIMILARITY") {
          // Rule: TOPICAL_SIMILARITY must NEVER produce a source similarity percentage
          return {
            matchType: "TOPICAL_SIMILARITY",
            status: "RETRIEVED",
            sourceSimilarity: null,
            evidence: "The source is topically related, but no textual overlap was verified.",
            isVerified: false
          };
        }
      }
    } catch (semErr) {
      logger.warn("Semantic matcher failed during source verification", { error: semErr.message });
    }
  }

  return {
    matchType: "NO_MATCH",
    status: "NO_MATCH",
    sourceSimilarity: null,
    evidence: "No significant textual, near-match, or semantic overlap detected in the retrieved source.",
    isVerified: false
  };
}

/**
 * Full Source Verification Workflow:
 * 1. Checks if candidate is already retrieved or fetches actual page.
 * 2. Unreachable pages are strictly classified as SOURCE_NOT_VERIFIABLE.
 * 3. Compares passage against actual retrieved source text using deterministic engines.
 * 4. Produces defensible, structured verification record.
 *
 * @param {Object} params
 * @param {string} params.passage Document passage to verify
 * @param {string} params.url Candidate source URL
 * @param {string} [params.title] Candidate source title
 * @param {string} [params.text] Optional pre-retrieved text
 * @returns {Promise<Object>} Verification outcome
 */
async function verify_source(params = {}) {
  const { passage, url, title, text } = params;

  if (!url || typeof url !== "string") {
    return {
      ok: false,
      status: "SOURCE_NOT_VERIFIABLE",
      reason: "Missing or invalid candidate URL parameter.",
      matchType: "NO_MATCH",
      sourceSimilarity: null,
      similarity: null,
      isVerified: false
    };
  }

  const cleanUrl = url.trim();
  const domain = extractDomain(cleanUrl);
  const sourceClassification = classifySource(cleanUrl);

  if (!passage || typeof passage !== "string" || !passage.trim()) {
    return {
      ok: false,
      url: cleanUrl,
      title: title || domain,
      domain,
      status: "SOURCE_NOT_VERIFIABLE",
      reason: "Missing passage text to verify against candidate source.",
      matchType: "NO_MATCH",
      sourceSimilarity: null,
      similarity: null,
      isVerified: false
    };
  }

  let pageText = text;
  let pageTitle = title || domain;
  let retrievalFailed = false;
  let failureReason = null;

  // If source text was not already provided, fetch the actual page
  if (!pageText || typeof pageText !== "string" || pageText.trim().length === 0) {
    const fetchResult = await fetch_source(cleanUrl);
    if (!fetchResult.ok) {
      retrievalFailed = true;
      failureReason = fetchResult.reason || "Unable to retrieve candidate web page.";
    } else {
      pageText = fetchResult.text;
      if (fetchResult.title) pageTitle = fetchResult.title;
    }
  }

  // Strictly enforce Rule: A search snippet alone can NEVER be marked VERIFIED.
  // If actual page retrieval failed, mark SOURCE_NOT_VERIFIABLE.
  if (retrievalFailed || !pageText) {
    return {
      ok: false,
      url: cleanUrl,
      title: pageTitle,
      domain,
      sourceType: sourceClassification.type,
      status: "SOURCE_NOT_VERIFIABLE",
      matchType: "NO_MATCH",
      sourceSimilarity: null,
      similarity: null,
      reason: failureReason,
      evidence: `Search candidate found, but source could not be retrieved (${failureReason}). Snippets cannot be verified.`,
      isVerified: false
    };
  }

  // Compare passage against actual retrieved source text using Checkra deterministic engine
  const comparison = await comparePassageWithSourceText(passage.trim(), pageText, cleanUrl);

  return {
    ok: true,
    url: cleanUrl,
    title: pageTitle,
    domain,
    sourceType: sourceClassification.type,
    status: comparison.status,
    matchType: comparison.matchType,
    sourceSimilarity: comparison.sourceSimilarity,
    similarity: comparison.sourceSimilarity, // Backwards-compatible alias
    evidence: comparison.evidence,
    isVerified: comparison.isVerified
  };
}

module.exports = {
  verify_source,
  comparePassageWithSourceText
};
