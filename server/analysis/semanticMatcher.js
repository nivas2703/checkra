/**
 * Checkra Level 3 — Semantic Similarity Engine
 * Genuine Sentence Transformer Embeddings + Multi-Signal Evidence Verification
 *
 * Rules:
 * 1. Raw cosine similarity remains strictly raw (no Math.pow, no nonlinear scaling).
 * 2. Semantic similarity ALONE is NEVER proof of plagiarism.
 * 3. Every candidate receives exactly one classification:
 *    - NO_MATCH
 *    - TOPICAL_SIMILARITY
 *    - CONCEPTUAL_SIMILARITY
 *    - POSSIBLE_PARAPHRASE
 *    - STRONG_PARAPHRASE
 *    - NEAR_MATCH
 *    - EXACT_MATCH
 * 4. Only STRONG_PARAPHRASE, NEAR_MATCH, and EXACT_MATCH constitute verified plagiarism evidence.
 */

const { embedTexts, cosineSimilarity } = require("./embeddingProvider");
const { analyzeOverlap, extractTokens } = require("./vocabularyClassifier");

/**
 * Classifies candidate sentence pair based on multiple independent evidentiary signals
 */
function classifyEvidence(rawCosine, overlap, minThreshold = 0.50) {
  const { sharedDistinctive, sharedGeneric, reciprocalCoverage, lengthRatio, distinctiveTerms } = overlap;

  // If raw cosine is below minimum evaluation threshold, it is not a match
  if (rawCosine < minThreshold) {
    return {
      classification: "NO_MATCH",
      tier: "NO_MATCH",
      isPlagiarismEvidence: false,
      label: "No Match",
      description: "Negligible semantic or textual relationship."
    };
  }

  // Length compatibility guard: extreme length mismatch rejects paraphrase
  if (lengthRatio < 0.20) {
    return {
      classification: "CONCEPTUAL_SIMILARITY",
      tier: "CONCEPTUAL_SIMILARITY",
      isPlagiarismEvidence: false,
      label: "Conceptual / Length Mismatch",
      description: "Passage length ratio incompatible with genuine direct paraphrasing."
    };
  }

  // Signal 2: Check for genuine distinctive evidence vs generic domain buzzwords
  if (sharedDistinctive < 2) {
    if (rawCosine >= 0.70) {
      return {
        classification: "CONCEPTUAL_SIMILARITY",
        tier: "CONCEPTUAL_SIMILARITY",
        isPlagiarismEvidence: false,
        label: "Conceptual Similarity",
        description: "Shared conceptual theme without distinctive textual derivation evidence."
      };
    }
    return {
      classification: "TOPICAL_SIMILARITY",
      tier: "TOPICAL_SIMILARITY",
      isPlagiarismEvidence: false,
      label: "Topical Similarity",
      description: "Common domain vocabulary or broad topical overlap."
    };
  }

  // Signal 3: Reciprocal coverage guard (prevents short generic sentence matching long passage)
  if (reciprocalCoverage < 0.30) {
    return {
      classification: "TOPICAL_SIMILARITY",
      tier: "TOPICAL_SIMILARITY",
      isPlagiarismEvidence: false,
      label: "Topical / Asymmetric Match",
      description: "Asymmetric coverage indicates broad topic reference rather than direct derivation."
    };
  }

  // Signal 4: Strong Paraphrase requires high cosine (>= 0.75) + distinctive terms (>= 2) + reciprocal coverage (>= 0.35)
  if (rawCosine >= 0.75 && sharedDistinctive >= 2 && reciprocalCoverage >= 0.35) {
    return {
      classification: "STRONG_PARAPHRASE",
      tier: "HIGH_CONFIDENCE_MATCH",
      isPlagiarismEvidence: true,
      label: "Strong Paraphrase Match",
      description: `High-confidence semantic paraphrase with confirmed distinctive concept alignment (${distinctiveTerms.slice(0, 4).join(", ")}).`
    };
  }

  // Moderate paraphrase: candidate for informational review
  if (rawCosine >= 0.65 && sharedDistinctive >= 2) {
    return {
      classification: "POSSIBLE_PARAPHRASE",
      tier: "POSSIBLE_MATCH",
      isPlagiarismEvidence: false,
      label: "Possible Paraphrase",
      description: `Moderate conceptual alignment with some shared distinctive terms (${distinctiveTerms.slice(0, 3).join(", ")}).`
    };
  }

  return {
    classification: "TOPICAL_SIMILARITY",
    tier: "TOPICAL_SIMILARITY",
    isPlagiarismEvidence: false,
    label: "Topical Similarity",
    description: "Incidental topical domain vocabulary without strong derivation evidence."
  };
}

/**
 * Evaluates semantic sentence similarity between submitted and source passages
 */
async function findSemanticMatches(submittedSentences, sourceSentences, options = {}) {
  const minThreshold = options.threshold !== undefined
    ? (options.threshold <= 1.0 ? options.threshold : options.threshold / 100)
    : 0.35;

  const subTexts = submittedSentences
    .map(s => typeof s === "string" ? s : s.raw || s.text || "")
    .map(t => t.trim())
    .filter(t => t.length >= 20);

  const srcTexts = sourceSentences
    .map(s => typeof s === "string" ? s : s.raw || s.text || "")
    .map(t => t.trim())
    .filter(t => t.length >= 20);

  if (!subTexts.length || !srcTexts.length) {
    return { matches: [], provider: "none" };
  }

  // Lexical candidate pre-filtering to avoid O(N*M) heavy embedding generation
  const candidatesPerSub = [];
  const srcTokensList = srcTexts.map(extractTokens);

  for (let i = 0; i < subTexts.length; i++) {
    const subTokens = extractTokens(subTexts[i]);
    const scoredSrcs = [];

    for (let j = 0; j < srcTexts.length; j++) {
      const srcTokens = srcTokensList[j];
      const overlap = analyzeOverlap(subTexts[i], srcTexts[j]);
      const lexicalScore = (overlap.sharedDistinctive * 3) + overlap.sharedGeneric;
      scoredSrcs.push({ index: j, text: srcTexts[j], lexicalScore, overlap });
    }

    scoredSrcs.sort((a, b) => b.lexicalScore - a.lexicalScore);
    const topCandidates = scoredSrcs.slice(0, 8);
    candidatesPerSub.push({ subIndex: i, subText: subTexts[i], candidates: topCandidates });
  }

  // Gather unique sentences needing embeddings
  const sentencesToEmbedSet = new Set();
  candidatesPerSub.forEach(item => {
    sentencesToEmbedSet.add(item.subText);
    item.candidates.forEach(c => sentencesToEmbedSet.add(c.text));
  });

  const sentencesList = Array.from(sentencesToEmbedSet);
  const { embeddings, provider } = await embedTexts(sentencesList, options);

  const embeddingMap = new Map();
  sentencesList.forEach((text, idx) => {
    embeddingMap.set(text, embeddings[idx]);
  });

  const matches = [];

  for (const item of candidatesPerSub) {
    const subVec = embeddingMap.get(item.subText);
    if (!subVec) continue;

    let bestCosine = -1;
    let bestCandidate = null;
    let bestClassification = null;

    for (const cand of item.candidates) {
      const srcVec = embeddingMap.get(cand.text);
      if (!srcVec) continue;

      const rawCosine = cosineSimilarity(subVec, srcVec);
      const classification = classifyEvidence(rawCosine, cand.overlap, minThreshold);

      if (rawCosine > bestCosine) {
        bestCosine = rawCosine;
        bestCandidate = cand;
        bestClassification = classification;
      }
    }

    if (bestCandidate && bestCosine >= minThreshold && bestClassification.classification !== "NO_MATCH") {
      const cosinePercent = Math.max(0, Math.round(bestCosine * 100));

      matches.push({
        type: "SEMANTIC",
        submittedSentence: item.subText,
        sourceSentence: bestCandidate.text,
        rawSemanticSimilarity: Math.round(bestCosine * 10000) / 10000,
        semanticSimilarityPercent: cosinePercent,
        similarityScore: cosinePercent,
        displayedSimilarityScore: cosinePercent,
        classification: bestClassification.classification,
        tier: bestClassification.tier,
        label: bestClassification.label,
        isPlagiarismEvidence: bestClassification.isPlagiarismEvidence,
        sharedDistinctStemsCount: bestCandidate.overlap.sharedDistinctive,
        sharedGenericStemsCount: bestCandidate.overlap.sharedGeneric,
        distinctiveTerms: bestCandidate.overlap.distinctiveTerms,
        reciprocalCoverage: Math.round(bestCandidate.overlap.reciprocalCoverage * 100) / 100,
        lengthRatio: Math.round(bestCandidate.overlap.lengthRatio * 100) / 100,
        description: bestClassification.description,
        provider
      });
    }
  }

  return {
    matches,
    provider
  };
}

module.exports = {
  findSemanticMatches,
  classifyEvidence,
  cosineSimilarity
};
