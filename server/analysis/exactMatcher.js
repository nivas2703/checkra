/**
 * Checkra Level 1 — Multi-Scale Exact Match Engine
 * Detects consecutive copied sequences using multi-length shingles (5, 7, 9, 12, 15 words)
 * and forward greedy extension.
 * Enforces lexical specificity to eliminate false positives on common idioms.
 */

const { tokenize, normalizeUnicode, normalizeQuotesAndApostrophes } = require("../document/preprocessor");
const { isGenericTerm, STOPWORDS } = require("./vocabularyClassifier");

/**
 * Normalizes text for exact matching
 */
function normalizeExactText(text) {
  if (!text) return "";
  return normalizeQuotesAndApostrophes(normalizeUnicode(text))
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

/**
 * Converts text into normalized token array
 */
function toExactTokens(input) {
  if (Array.isArray(input)) return input.map(t => String(t).toLowerCase());
  if (typeof input === "string") {
    return normalizeExactText(input).split(/\s+/).filter(t => t.length > 0);
  }
  return [];
}

/**
 * Checks if a matched phrase has sufficient lexical specificity
 * (rejects common generic phrases like "in the case of modern business")
 */
function hasLexicalSpecificity(tokens) {
  if (tokens.length >= 10) return true;
  if (tokens.length < 5) return false;
  const contentTokens = tokens.filter(t => !STOPWORDS.has(t) && !isGenericTerm(t));
  return contentTokens.length >= 2;
}

/**
 * Extracts n-grams of a given length
 */
function extractNgrams(tokens, n) {
  const ngrams = new Map();
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n).join(" ");
    if (!ngrams.has(gram)) {
      ngrams.set(gram, []);
    }
    ngrams.get(gram).push(i);
  }
  return ngrams;
}

/**
 * Finds exact sequence overlaps between submitted text and source text
 * @param {string|string[]} submittedTokens
 * @param {string|string[]} sourceTokens
 * @param {number} minWords default 6 (or 5 for shingle seeds)
 * @param {string} sourceUrl optional source URL for reporting
 */
function findExactMatches(submittedTokens, sourceTokens, minWords = 6, sourceUrl = "") {
  const subTokens = toExactTokens(submittedTokens);
  const srcTokens = toExactTokens(sourceTokens);

  const seedSize = Math.max(5, Math.min(minWords, 6));

  if (subTokens.length < seedSize || srcTokens.length < seedSize) {
    return {
      matches: [],
      totalMatchedTokens: 0,
      exactMatchedWords: new Set(),
      coverageRatio: 0,
      exactOverlapPercent: 0,
      exactPassages: [],
      sourceUrls: sourceUrl ? [sourceUrl] : []
    };
  }

  // Index source n-grams at seed size
  const srcIndex = new Map();
  for (let i = 0; i <= srcTokens.length - seedSize; i++) {
    const key = srcTokens.slice(i, i + seedSize).join(" ");
    if (!srcIndex.has(key)) {
      srcIndex.set(key, i);
    }
  }

  const matches = [];
  const matchedTokenIndices = new Set();
  let i = 0;

  while (i <= subTokens.length - seedSize) {
    const key = subTokens.slice(i, i + seedSize).join(" ");
    if (srcIndex.has(key)) {
      let srcStart = srcIndex.get(key);
      let len = seedSize;

      // Extend forward as long as tokens continue to match verbatim
      while (
        i + len < subTokens.length &&
        srcStart + len < srcTokens.length &&
        subTokens[i + len] === srcTokens[srcStart + len]
      ) {
        len++;
      }

      const phraseTokens = subTokens.slice(i, i + len);
      if (hasLexicalSpecificity(phraseTokens)) {
        const matchedPhrase = phraseTokens.join(" ");
        matches.push({
          type: "EXACT",
          submittedIndex: i,
          sourceIndex: srcStart,
          length: len,
          phrase: matchedPhrase,
          sourceUrl: sourceUrl || "",
          confidence: len >= 12 ? "HIGH" : len >= 8 ? "MEDIUM" : "LOW"
        });

        for (let k = 0; k < len; k++) {
          matchedTokenIndices.add(i + k);
        }
      }

      i += len;
    } else {
      i++;
    }
  }

  const totalMatchedTokens = matchedTokenIndices.size;
  const coverageRatio = subTokens.length > 0 ? (totalMatchedTokens / subTokens.length) : 0;

  return {
    matches,
    totalMatchedTokens,
    exactMatchedWords: matchedTokenIndices,
    coverageRatio: Math.min(1, coverageRatio),
    exactOverlapPercent: Math.round(Math.min(100, coverageRatio * 100)),
    exactPassages: matches,
    sourceUrls: sourceUrl ? [sourceUrl] : []
  };
}

module.exports = {
  findExactMatches,
  extractNgrams,
  hasLexicalSpecificity,
  normalizeExactText,
  toExactTokens
};
