/**
 * VeriWrite Level 2 — Near Match Engine
 * Detects word substitutions, additions, removals, reorderings, and grammatical shifts.
 * Enforces lexical specificity to avoid treating generic domain definitions as paraphrased plagiarism.
 */

const { tokenize } = require("../document/preprocessor");

// Stopwords that frequently change in paraphrasing without changing meaning
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "can",
  "could", "should", "would", "may", "might", "must", "shall", "will"
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

function hasLexicalSpecificity(tokens) {
  if (tokens.length >= 10) return true;
  const nonGeneric = tokens.filter(t => !STOPWORDS.has(t) && !DOMAIN_GENERIC_WORDS.has(t));
  return nonGeneric.length >= 2;
}

function stemLike(word) {
  if (word.length <= 4) return word;
  return word
    .replace(/(?:ing|tion|tions|ment|ments|ed|es|s|al|ic|ly|ive|ize|ise)$/, "");
}

function computeTokenSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;

  // Filter content words
  const contentA = tokensA.filter(t => !STOPWORDS.has(t));
  const contentB = tokensB.filter(t => !STOPWORDS.has(t));

  const setA = new Set(contentA.length > 0 ? contentA : tokensA);
  const setB = new Set(contentB.length > 0 ? contentB : tokensB);

  // Exact content word intersection
  let exactHits = 0;
  for (const item of setA) {
    if (setB.has(item)) exactHits++;
  }

  // Stem/prefix hits for variations (improves / improve)
  const stemsA = new Set([...setA].map(stemLike));
  const stemsB = new Set([...setB].map(stemLike));
  let stemHits = 0;
  for (const s of stemsA) {
    if (stemsB.has(s)) stemHits++;
  }

  const unionSize = new Set([...setA, ...setB]).size;
  const jaccard = unionSize > 0 ? (exactHits / unionSize) : 0;
  const stemJaccard = new Set([...stemsA, ...stemsB]).size > 0 
    ? (stemHits / new Set([...stemsA, ...stemsB]).size) 
    : 0;

  // Containment ratio (how much of the smaller set is contained in the larger)
  const minSize = Math.min(setA.size, setB.size);
  const maxSize = Math.max(setA.size, setB.size);
  const lengthRatio = maxSize > 0 ? (minSize / maxSize) : 0;

  // Genuine sentence paraphrasing requires compatible scale (reject wordlist dumps)
  if (lengthRatio < 0.3) {
    return Math.max(jaccard, stemJaccard * 0.85);
  }

  const containment = minSize > 0 ? (Math.max(exactHits, stemHits) / minSize) : 0;
  return Math.max(jaccard, stemJaccard * 0.9, containment * 0.95 * Math.min(1, 0.4 + 0.6 * lengthRatio));
}

/**
 * Finds near matches between submitted sentences and source sentences
 */
function findNearMatches(submittedSentences, sourceSentences, threshold = 0.45) {
  const matches = [];

  const subList = submittedSentences.map(s => {
    if (typeof s === "string") {
      return { raw: s, tokens: tokenize(s) };
    }
    return {
      raw: s.raw || s.text || "",
      tokens: s.tokens || tokenize(s.raw || s.text || ""),
      index: s.index || s.sentenceIndex || 0
    };
  }).filter(s => s.tokens.length >= 4);

  const srcList = sourceSentences.map(s => {
    if (typeof s === "string") {
      return { raw: s, tokens: tokenize(s) };
    }
    return {
      raw: s.raw || s.text || "",
      tokens: s.tokens || tokenize(s.raw || s.text || ""),
      index: s.index || 0
    };
  }).filter(s => s.tokens.length >= 4);

  for (let i = 0; i < subList.length; i++) {
    const sub = subList[i];
    // Must possess lexical specificity to qualify as near-match candidate
    if (!hasLexicalSpecificity(sub.tokens)) {
      continue;
    }

    let bestScore = 0;
    let bestSrc = null;

    for (let j = 0; j < srcList.length; j++) {
      const src = srcList[j];
      const sim = computeTokenSimilarity(sub.tokens, src.tokens);

      if (sim > bestScore) {
        bestScore = sim;
        bestSrc = src;
      }
    }

    if (bestScore >= threshold && bestSrc) {
      const scaledScore = Math.round(bestScore * 100);
      matches.push({
        type: "NEAR",
        submittedSentence: sub.raw,
        sourceSentence: bestSrc.raw,
        submittedIndex: sub.index || i,
        similarityScore: scaledScore,
        confidence: bestScore >= 0.70 ? "HIGH" : "MEDIUM"
      });
    }
  }

  return matches;
}

module.exports = {
  findNearMatches,
  computeTokenSimilarity,
  stemLike,
  hasLexicalSpecificity
};
