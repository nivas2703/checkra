/**
 * Checkra Level 2 — Near / Lexical Match Engine
 * Detects word substitutions, synonym shifts, grammatical reorderings, and numerical variations.
 * Strictly excludes generic domain vocabulary from generating false-positive plagiarism.
 */

const { tokenize } = require("../document/preprocessor");
const { STOPWORDS, isGenericTerm, stemWord, extractTokens } = require("./vocabularyClassifier");

// Canonical concept mappings for genuine near-match paraphrasing
const CANONICAL_NEAR_MAP = {
  "increase": "growth_concept", "increased": "growth_concept", "increases": "growth_concept", "increasing": "growth_concept",
  "grow": "growth_concept", "grew": "growth_concept", "grown": "growth_concept", "growing": "growth_concept", "growth": "growth_concept",
  "annual": "year_concept", "annually": "year_concept", "year": "year_concept", "yearly": "year_concept",
  "company": "firm_concept", "companies": "firm_concept", "firm": "firm_concept", "firms": "firm_concept",
  "revenue": "income_concept", "revenues": "income_concept", "earnings": "income_concept",
  "decrease": "drop_concept", "decreased": "drop_concept", "drop": "drop_concept", "dropped": "drop_concept",
  "quarterly": "period_concept", "quarter": "period_concept",
  "enterprise": "org_concept", "enterprises": "org_concept", "organization": "org_concept", "organizations": "org_concept",
  "optimize": "improve_concept", "optimizes": "improve_concept", "optimizing": "improve_concept",
  "improve": "improve_concept", "improves": "improve_concept", "improving": "improve_concept",
  "efficiency": "perf_concept", "performance": "perf_concept"
};

/**
 * Checks if a token set has sufficient lexical specificity
 */
function hasNearLexicalSpecificity(tokens) {
  if (tokens.length >= 10) return true;
  const distinctive = tokens.filter(t => !STOPWORDS.has(t) && !isGenericTerm(t));
  return distinctive.length >= 2;
}

/**
 * Computes lexical token similarity with distinctive weighting and canonical concept mapping
 */
function computeTokenSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return { score: 0, sharedDistinctive: 0, distinctiveTerms: [] };

  const contentA = tokensA.filter(t => !STOPWORDS.has(t));
  const contentB = tokensB.filter(t => !STOPWORDS.has(t));

  if (!contentA.length || !contentB.length) return { score: 0, sharedDistinctive: 0, distinctiveTerms: [] };

  const stemsA = new Map();
  contentA.forEach(t => stemsA.set(stemWord(t), t));

  const stemsB = new Map();
  contentB.forEach(t => stemsB.set(stemWord(t), t));

  let sharedGeneric = 0;
  let sharedDistinctive = 0;
  const distinctiveTerms = [];

  stemsA.forEach((rawWord, stem) => {
    if (stemsB.has(stem)) {
      if (isGenericTerm(rawWord) || isGenericTerm(stemsB.get(stem)) || isGenericTerm(stem)) {
        sharedGeneric++;
      } else {
        sharedDistinctive++;
        distinctiveTerms.push(rawWord);
      }
    } else {
      // Check canonical near concepts (e.g. increase / grew, annual / year, enterprise / organization)
      const canonA = CANONICAL_NEAR_MAP[rawWord] || CANONICAL_NEAR_MAP[stem];
      if (canonA) {
        let foundConcept = false;
        stemsB.forEach((rawB, stemB) => {
          if (!foundConcept) {
            const canonB = CANONICAL_NEAR_MAP[rawB] || CANONICAL_NEAR_MAP[stemB];
            if (canonB === canonA) {
              sharedDistinctive++;
              distinctiveTerms.push(`${rawWord}~${rawB}`);
              foundConcept = true;
            }
          }
        });
      }
    }
  });

  // CRITICAL GUARD: If zero or only 1 distinctive term is shared, this is NOT a near-match plagiarism!
  // Prevents generic domain definition false positives like:
  // "Companies use machine learning to improve business decisions." vs "Machine learning is widely used in modern businesses."
  if (sharedDistinctive < 2) {
    return { score: 0, sharedDistinctive, distinctiveTerms };
  }

  const lenA = contentA.length;
  const lenB = contentB.length;
  const lengthRatio = Math.min(lenA, lenB) / Math.max(lenA, lenB);

  // Reject extreme length mismatches (e.g. 5-word sentence matching a 50-word sentence)
  if (lengthRatio < 0.25) {
    return { score: 0, sharedDistinctive, distinctiveTerms };
  }

  const totalShared = sharedGeneric + sharedDistinctive;
  const jaccard = totalShared / (lenA + lenB - totalShared);
  const containment = totalShared / Math.min(lenA, lenB);

  // Weighted near-match score: requires both reasonable Jaccard and high containment of distinctive terms
  const rawScore = (containment * 0.70) + (jaccard * 0.30);
  const adjustedScore = Math.min(1, rawScore * Math.min(1, 0.4 + 0.6 * lengthRatio));

  return {
    score: adjustedScore,
    sharedDistinctive,
    distinctiveTerms,
    containment,
    jaccard
  };
}

/**
 * Finds near matches between submitted sentences and source sentences
 */
function findNearMatches(submittedSentences, sourceSentences, threshold = 0.45) {
  const matches = [];

  const subList = submittedSentences.map((s, idx) => {
    const raw = typeof s === "string" ? s : s.raw || s.text || "";
    const tokens = extractTokens(raw);
    return { raw, tokens, index: s.index !== undefined ? s.index : idx };
  }).filter(s => s.tokens.length >= 4);

  const srcList = sourceSentences.map((s, idx) => {
    const raw = typeof s === "string" ? s : s.raw || s.text || "";
    const tokens = extractTokens(raw);
    return { raw, tokens, index: idx };
  }).filter(s => s.tokens.length >= 4);

  for (let i = 0; i < subList.length; i++) {
    const sub = subList[i];
    if (!hasNearLexicalSpecificity(sub.tokens)) {
      continue;
    }

    let bestScore = 0;
    let bestSrc = null;
    let bestDetails = null;

    for (let j = 0; j < srcList.length; j++) {
      const src = srcList[j];
      const result = computeTokenSimilarity(sub.tokens, src.tokens);

      if (result.score > bestScore) {
        bestScore = result.score;
        bestSrc = src;
        bestDetails = result;
      }
    }

    if (bestScore >= threshold && bestSrc && bestDetails && bestDetails.sharedDistinctive >= 2) {
      const scaledScore = Math.round(bestScore * 100);
      matches.push({
        type: "NEAR",
        submittedSentence: sub.raw,
        sourceSentence: bestSrc.raw,
        submittedIndex: sub.index,
        similarityScore: scaledScore,
        confidence: bestScore >= 0.70 ? "HIGH" : "MEDIUM",
        distinctiveTerms: bestDetails.distinctiveTerms,
        sharedDistinctive: bestDetails.sharedDistinctive
      });
    }
  }

  return matches;
}

module.exports = {
  findNearMatches,
  computeTokenSimilarity,
  hasNearLexicalSpecificity
};
