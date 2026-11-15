/**
 * VeriWrite Level 1 — Exact Match Engine
 * Detects matching n-gram sequences (4, 5, 6, 8, 10, 15 words) and exact phrase overlaps.
 * Enforces lexical specificity to avoid treating short generic common knowledge as plagiarism.
 */

const { tokenize } = require("../document/preprocessor");

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "can"
]);

const DOMAIN_GENERIC_WORDS = new Set([
  "machine", "learning", "artificial", "intelligence", "algorithm", "algorithms",
  "data", "dataset", "datasets", "model", "models", "system", "systems", "process",
  "processes", "technology", "technologies", "information", "computer", "computers",
  "science", "scientific", "field", "digital", "modern", "application", "applications",
  "branch", "subset", "concept", "concepts", "theory", "theories",
  "monsoon", "season", "seasons", "seasonal", "agriculture", "agricultural", "farming",
  "farmer", "farmers", "crop", "crops", "harvest", "rainfall", "rain", "production",
  "state", "states", "country", "countries", "region", "regions", "affect", "affects", "impact", "impacts"
]);

function hasLexicalSpecificity(phraseTokens) {
  if (phraseTokens.length >= 10) return true;
  const nonGeneric = phraseTokens.filter(t => !STOPWORDS.has(t) && !DOMAIN_GENERIC_WORDS.has(t));
  return nonGeneric.length >= 2;
}

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
 * @param {number} minWords default 6
 */
function findExactMatches(submittedTokens, sourceTokens, minWords = 6) {
  const subTokens = Array.isArray(submittedTokens) ? submittedTokens : tokenize(submittedTokens);
  const srcTokens = Array.isArray(sourceTokens) ? sourceTokens : tokenize(sourceTokens);

  if (subTokens.length < minWords || srcTokens.length < minWords) {
    return { matches: [], totalMatchedTokens: 0, coverageRatio: 0, exactOverlapPercent: 0 };
  }

  // Build index for source ngrams
  const srcIndex = new Map();
  for (let i = 0; i <= srcTokens.length - minWords; i++) {
    const key = srcTokens.slice(i, i + minWords).join(" ");
    if (!srcIndex.has(key)) srcIndex.set(key, i);
  }

  const matches = [];
  const matchedTokenIndices = new Set();
  let i = 0;

  while (i <= subTokens.length - minWords) {
    const key = subTokens.slice(i, i + minWords).join(" ");
    if (srcIndex.has(key)) {
      let srcStart = srcIndex.get(key);
      let len = minWords;

      // Extend forward as long as tokens continue to match exactly
      while (
        i + len < subTokens.length &&
        srcStart + len < srcTokens.length &&
        subTokens[i + len] === srcTokens[srcStart + len]
      ) {
        len++;
      }

      const phraseTokens = subTokens.slice(i, i + len);
      // Require lexical specificity before treating match as plagiarism
      if (hasLexicalSpecificity(phraseTokens)) {
        const matchedPhrase = phraseTokens.join(" ");
        matches.push({
          type: "EXACT",
          submittedIndex: i,
          sourceIndex: srcStart,
          length: len,
          phrase: matchedPhrase,
          confidence: len >= 10 ? "HIGH" : len >= 6 ? "MEDIUM" : "LOW"
        });

        for (let k = 0; k < len; k++) {
          matchedTokenIndices.add(i + k);
        }
      }

      i += len; // Jump past matched sequence
    } else {
      i++;
    }
  }

  const totalMatchedTokens = matchedTokenIndices.size;
  const coverageRatio = subTokens.length > 0 ? (totalMatchedTokens / subTokens.length) : 0;

  return {
    matches,
    totalMatchedTokens,
    coverageRatio: Math.min(1, coverageRatio),
    exactOverlapPercent: Math.round(Math.min(100, coverageRatio * 100))
  };
}

module.exports = {
  findExactMatches,
  extractNgrams,
  hasLexicalSpecificity
};
