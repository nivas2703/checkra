/**
 * Checkra AI Writing Detection — Stylometric & Structural Feature Extraction
 *
 * Deterministically computes linguistic, syntactic, and structural metrics:
 * - Sentence length distribution (mean, standard deviation, coefficient of variation)
 * - Sentence rhythm / burstiness (consecutive length deltas)
 * - Lexical diversity (Type-Token Ratio, Root TTR)
 * - Rhetorical transition word and phrase density
 * - Paragraph length uniformity
 * - Repetitive n-gram and sentence lead structure regularity
 *
 * Safe execution: Handles empty strings, single words, punctuation-only strings
 * without throwing errors or producing NaN / Infinity.
 */

// Common rhetorical transition phrases and markers frequently over-represented in LLM prose
const TRANSITION_PATTERNS = [
  /\bfurthermore\b/i,
  /\bmoreover\b/i,
  /\bin conclusion\b/i,
  /\badditionally\b/i,
  /\bconsequently\b/i,
  /\bsubsequently\b/i,
  /\bnevertheless\b/i,
  /\bnonetheless\b/i,
  /\bin summary\b/i,
  /\bto summarize\b/i,
  /\bit is important to note\b/i,
  /\bit is crucial to\b/i,
  /\bit is worth noting\b/i,
  /\bdelve into\b/i,
  /\btestament to\b/i,
  /\bpivotal role\b/i,
  /\bvital role\b/i,
  /\bfirst and foremost\b/i,
  /\bultimately\b/i,
  /\bas a result\b/i,
  /\bhence\b/i,
  /\bthus\b/i,
  /\btherefore\b/i,
  /\bon the other hand\b/i,
  /\bin contrast\b/i,
  /\bmore specifically\b/i,
  /\bit should be emphasized\b/i,
  /\bshed light on\b/i
];

/**
 * Tokenizes text into sentences safely using punctuation boundaries.
 * @param {string} text
 * @returns {string[]} Array of non-empty sentence strings
 */
function splitIntoSentences(text) {
  if (!text || typeof text !== "string") return [];
  // Split on '.', '!', '?' followed by whitespace or end of string, avoiding abbreviations roughly
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map(s => s.trim()).filter(s => s.length > 0 && /[a-zA-Z0-9]/.test(s));
}

/**
 * Tokenizes text into word tokens (lowercased, alphanumeric).
 * @param {string} text
 * @returns {string[]} Array of word strings
 */
function tokenizeWords(text) {
  if (!text || typeof text !== "string") return [];
  const matches = text.toLowerCase().match(/\b[a-z0-9]+(?:'[a-z0-9]+)?\b/g);
  return matches || [];
}

/**
 * Computes arithmetic mean of an array of numbers.
 * @param {number[]} nums
 * @returns {number}
 */
function mean(nums) {
  if (!nums || nums.length === 0) return 0;
  const sum = nums.reduce((acc, val) => acc + val, 0);
  return sum / nums.length;
}

/**
 * Computes population standard deviation of an array of numbers.
 * @param {number[]} nums
 * @param {number} [avg]
 * @returns {number}
 */
function standardDeviation(nums, avg) {
  if (!nums || nums.length <= 1) return 0;
  const m = avg !== undefined ? avg : mean(nums);
  const variance = nums.reduce((acc, val) => acc + Math.pow(val - m, 2), 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * Extracts comprehensive stylometric and structural features from raw text.
 *
 * @param {string} text Input text
 * @returns {Object} Structured metrics
 */
function extractStylometricFeatures(text) {
  if (!text || typeof text !== "string") {
    return createEmptyFeatures();
  }

  const rawText = text.trim();
  if (rawText.length === 0) {
    return createEmptyFeatures();
  }

  // Tokenization
  const words = tokenizeWords(rawText);
  const sentences = splitIntoSentences(rawText);
  const rawParagraphs = rawText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);

  const wordCount = words.length;
  const sentenceCount = sentences.length;
  const paragraphCount = rawParagraphs.length;

  if (wordCount === 0) {
    return createEmptyFeatures();
  }

  // Sentence length metrics (words per sentence)
  const sentenceLengths = sentences.map(s => tokenizeWords(s).length).filter(l => l > 0);
  const avgSentenceLength = sentenceLengths.length > 0 ? mean(sentenceLengths) : 0;
  const sentenceLengthStdDev = sentenceLengths.length > 1 ? standardDeviation(sentenceLengths, avgSentenceLength) : 0;
  // Coefficient of Variation = sigma / mean
  const sentenceLengthCV = avgSentenceLength > 0 ? (sentenceLengthStdDev / avgSentenceLength) : 0;

  // Burstiness: Rhythm variation between consecutive sentences (|L_{i+1} - L_i|)
  let burstinessDeltaMean = 0;
  if (sentenceLengths.length > 1) {
    const deltas = [];
    for (let i = 0; i < sentenceLengths.length - 1; i++) {
      deltas.push(Math.abs(sentenceLengths[i + 1] - sentenceLengths[i]));
    }
    burstinessDeltaMean = mean(deltas);
  }
  const burstinessScore = avgSentenceLength > 0 ? (burstinessDeltaMean / avgSentenceLength) : 0;

  // Lexical Diversity: TTR (Type-Token Ratio) and Root TTR (Guiraud's Index)
  const uniqueWords = new Set(words);
  const uniqueCount = uniqueWords.size;
  const typeTokenRatio = wordCount > 0 ? (uniqueCount / wordCount) : 0;
  const rootTTR = wordCount > 0 ? (uniqueCount / Math.sqrt(wordCount)) : 0;

  // Word length distribution
  const wordLengths = words.map(w => w.length);
  const avgWordLength = mean(wordLengths);
  const wordLengthStdDev = standardDeviation(wordLengths, avgWordLength);

  // Transition phrase density
  let transitionCount = 0;
  for (const pattern of TRANSITION_PATTERNS) {
    const matches = rawText.match(new RegExp(pattern.source, "gi"));
    if (matches) {
      transitionCount += matches.length;
    }
  }
  // Transition density per 100 words
  const transitionDensity = wordCount > 0 ? ((transitionCount / wordCount) * 100) : 0;

  // Paragraph length distribution (words per paragraph)
  const paragraphLengths = rawParagraphs.map(p => tokenizeWords(p).length).filter(l => l > 0);
  const avgParagraphLength = paragraphLengths.length > 0 ? mean(paragraphLengths) : 0;
  const paragraphStdDev = paragraphLengths.length > 1 ? standardDeviation(paragraphLengths, avgParagraphLength) : 0;
  const paragraphCV = avgParagraphLength > 0 ? (paragraphStdDev / avgParagraphLength) : 0;

  // Repetitive sentence lead structures (e.g. sentences starting with transition + comma or identical first 2 words)
  let repeatedLeadsCount = 0;
  const leadBigrams = new Map();
  for (const s of sentences) {
    const sWords = tokenizeWords(s);
    if (sWords.length >= 2) {
      const lead = `${sWords[0]} ${sWords[1]}`;
      leadBigrams.set(lead, (leadBigrams.get(lead) || 0) + 1);
    }
  }
  for (const count of leadBigrams.values()) {
    if (count > 1) {
      repeatedLeadsCount += (count - 1);
    }
  }
  const leadRepetitionRatio = sentenceCount > 1 ? (repeatedLeadsCount / sentenceCount) : 0;

  // Repeated phrase n-grams (3-grams appearing across different sentences)
  let repeatedTrigramsCount = 0;
  if (words.length >= 6) {
    const trigrams = new Map();
    for (let i = 0; i <= words.length - 3; i++) {
      const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      trigrams.set(tri, (trigrams.get(tri) || 0) + 1);
    }
    for (const count of trigrams.values()) {
      if (count > 1) {
        repeatedTrigramsCount += (count - 1);
      }
    }
  }
  const trigramRepetitionRatio = wordCount > 5 ? (repeatedTrigramsCount / (wordCount - 2)) : 0;

  return {
    wordCount,
    sentenceCount,
    paragraphCount,
    avgSentenceLength: Number(avgSentenceLength.toFixed(2)),
    sentenceLengthStdDev: Number(sentenceLengthStdDev.toFixed(2)),
    sentenceLengthCV: Number(sentenceLengthCV.toFixed(4)),
    burstinessScore: Number(burstinessScore.toFixed(4)),
    uniqueWords: uniqueCount,
    typeTokenRatio: Number(typeTokenRatio.toFixed(4)),
    rootTTR: Number(rootTTR.toFixed(2)),
    avgWordLength: Number(avgWordLength.toFixed(2)),
    wordLengthStdDev: Number(wordLengthStdDev.toFixed(2)),
    transitionCount,
    transitionDensity: Number(transitionDensity.toFixed(2)),
    avgParagraphLength: Number(avgParagraphLength.toFixed(2)),
    paragraphCV: Number(paragraphCV.toFixed(4)),
    leadRepetitionRatio: Number(leadRepetitionRatio.toFixed(4)),
    trigramRepetitionRatio: Number(trigramRepetitionRatio.toFixed(4))
  };
}

/**
 * Returns safe empty metrics object.
 */
function createEmptyFeatures() {
  return {
    wordCount: 0,
    sentenceCount: 0,
    paragraphCount: 0,
    avgSentenceLength: 0,
    sentenceLengthStdDev: 0,
    sentenceLengthCV: 0,
    burstinessScore: 0,
    uniqueWords: 0,
    typeTokenRatio: 0,
    rootTTR: 0,
    avgWordLength: 0,
    wordLengthStdDev: 0,
    transitionCount: 0,
    transitionDensity: 0,
    avgParagraphLength: 0,
    paragraphCV: 0,
    leadRepetitionRatio: 0,
    trigramRepetitionRatio: 0
  };
}

module.exports = {
  extractStylometricFeatures,
  splitIntoSentences,
  tokenizeWords,
  mean,
  standardDeviation
};
