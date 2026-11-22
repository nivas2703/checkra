/**
 * Checkra Phase 6 — Writing Improvement & Quality Analysis Engine
 *
 * Provides comprehensive multi-dimensional writing analysis:
 * - Grammar & mechanics auditing via grammarEngine
 * - Wordiness & conciseness analysis
 * - Readability cadence & sentence length evaluation
 * - Summary metrics and category aggregations
 *
 * Strict Compliance:
 * - Clean text produces ZERO fabricated issues.
 * - Never modifies original document text.
 * - Read-only diagnostic analysis.
 */

const { checkGrammarRules, checkReadabilityIssues } = require("./grammarEngine");
const { tokenizeWords, splitIntoSentences } = require("./aiWritingFeatures");

/**
 * Analyzes writing quality for grammar, mechanics, wordiness, and readability.
 *
 * @param {string} text Document or passage text
 * @param {Object} [options]
 * @returns {Object} Structured writing quality audit
 */
function analyzeWritingQuality(text, options = {}) {
  if (text === null || text === undefined || typeof text !== "string") {
    return {
      ok: false,
      error: "INVALID_REQUEST",
      message: "A non-empty text string is required for writing quality analysis."
    };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: "EMPTY_TEXT",
      message: "The provided text contains no readable characters."
    };
  }

  // Word and sentence counting
  const words = tokenizeWords(trimmed);
  const sentences = splitIntoSentences(trimmed);
  const wordCount = words.length;
  const sentenceCount = sentences.length;

  // 1. Run rule-based checks
  const ruleIssues = checkGrammarRules(trimmed);
  const readabilityIssues = checkReadabilityIssues(trimmed);

  const allIssues = [...ruleIssues, ...readabilityIssues];

  // 2. Aggregate issue counts by category
  const summary = {
    grammar: 0,
    punctuation: 0,
    spelling: 0,
    clarity: 0,
    readability: 0,
    wordiness: 0,
    repetition: 0,
    total: allIssues.length
  };

  for (const issue of allIssues) {
    const key = (issue.type || "clarity").toLowerCase();
    if (summary[key] !== undefined) {
      summary[key]++;
    } else {
      summary.clarity++;
    }
  }

  // 3. Compute overall writing quality score (0-100)
  // Base 100, deducting for identified issues normalized against word count
  let deductions = 0;
  for (const issue of allIssues) {
    if (issue.severity === "HIGH") deductions += 8;
    else if (issue.severity === "MEDIUM") deductions += 4;
    else deductions += 2;
  }
  // Moderate deduction rate for longer documents
  const normalizedPenalty = wordCount > 0 ? (deductions / Math.max(1, wordCount / 50)) : deductions;
  const qualityScore = Math.max(20, Math.min(100, Math.round(100 - normalizedPenalty)));

  // Average sentence length
  const avgSentenceLength = sentenceCount > 0 ? Number((wordCount / sentenceCount).toFixed(1)) : 0;
  const estimatedReadingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

  return {
    ok: true,
    status: allIssues.length === 0 ? "CLEAN" : "ANALYZED",
    wordCount,
    sentenceCount,
    qualityScore,
    issues: allIssues,
    summary,
    readability: {
      avgSentenceLength,
      estimatedReadingTimeMinutes,
      status: avgSentenceLength <= 25 ? "BALANCED" : (avgSentenceLength <= 35 ? "COMPLEX" : "DENSE")
    }
  };
}

module.exports = {
  analyzeWritingQuality
};
