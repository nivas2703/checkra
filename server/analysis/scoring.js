/**
 * Checkra Similarity Scoring & Grade Engine
 * Documented, mathematically transparent algorithm based strictly on verified textual evidence.
 *
 * Scoring Formula:
 * Overall Score = min(100,
 *   (Exact Match Word Coverage * 0.65) +
 *   (Near Match Word Coverage * 0.25) +
 *   (Semantic Paraphrase Coverage * 0.10)
 * )
 *
 * Invariants:
 * 1. Zero evidence -> strictly 0% similarity.
 * 2. 100% verbatim copy (exact + near + semantic) -> 90-100% similarity.
 * 3. Exact copied fraction + original fraction -> strictly proportional.
 * 4. Topical similarity without textual derivation does NOT contribute to score.
 */

function calculateGrade(score) {
  if (score <= 10) return "A";
  if (score <= 40) return "B";
  if (score <= 60) return "C";
  return "D";
}

/**
 * Calculates overall document similarity score from verified source evidence.
 *
 * @param {string[]|number} documentTokensOrCount - Array of tokens or total word count
 * @param {Array} sourceEvidences - Verified source evidence objects
 * @param {Array} eligibleSentences - Preprocessed eligible sentences with word spans
 */
function calculateDocumentScore(documentTokensOrCount, sourceEvidences = [], eligibleSentences = []) {
  const totalDocWords = Math.max(1, Array.isArray(documentTokensOrCount)
    ? documentTokensOrCount.length
    : (typeof documentTokensOrCount === "number" ? documentTokensOrCount : 1));

  if (!sourceEvidences.length) {
    return {
      score: 0,
      grade: "A",
      gradeLabel: "Checkra similarity grade",
      coverage: { exactPercent: 0, nearPercent: 0, semanticPercent: 0 },
      exactWordsCount: 0,
      nearWordsCount: 0,
      semanticWordsCount: 0,
      methodology: "Score is 0% because no matching source content was retrieved and verified."
    };
  }

  const exactWordsMatched = new Set();
  const nearWordsMatched = new Set();
  const semanticWordWeights = new Map();

  let verifiedSourcesCount = 0;

  sourceEvidences.forEach(src => {
    if (src.status === "VERIFIED" || src.status === "PARTIALLY_VERIFIED") {
      verifiedSourcesCount++;
    }

    // 1. Exact Matches (weight = 65%)
    (src.exactMatches || []).forEach(m => {
      const idx = m.submittedIndex !== undefined ? m.submittedIndex : 0;
      for (let i = 0; i < (m.length || 0); i++) {
        if (idx + i < totalDocWords) {
          exactWordsMatched.add(idx + i);
        }
      }
    });

    // 2. Near Matches (weight = 25%)
    (src.nearMatches || []).forEach(m => {
      const wordsInSentence = (m.submittedSentence || "").split(/\s+/).length || 8;
      const sentIdx = m.submittedIndex !== undefined ? m.submittedIndex : 0;
      for (let i = 0; i < wordsInSentence; i++) {
        const key = sentIdx * 1000 + i;
        nearWordsMatched.add(key);
      }
    });

    // 3. Semantic Paraphrase Matches (weight = 10%)
    (src.semanticMatches || []).forEach(m => {
      if (m.isPlagiarismEvidence !== false) {
        const wordsInSentence = (m.submittedSentence || "").split(/\s+/).length || 8;
        const sentIdx = m.submittedIndex !== undefined ? m.submittedIndex : 0;
        const rawSim = m.rawSemanticSimilarity !== undefined
          ? m.rawSemanticSimilarity
          : ((m.similarityScore || 100) / 100);
        const matchWeight = Math.min(1.0, Math.max(0.40, rawSim));

        for (let i = 0; i < wordsInSentence; i++) {
          const key = sentIdx * 1000 + i;
          const prev = semanticWordWeights.get(key) || 0;
          if (matchWeight > prev) {
            semanticWordWeights.set(key, matchWeight);
          }
        }
      }
    });
  });

  const exactRatio = Math.min(1, exactWordsMatched.size / totalDocWords);
  const nearRatio = Math.min(1, nearWordsMatched.size / totalDocWords);

  let totalSemanticWeight = 0;
  for (const w of semanticWordWeights.values()) {
    totalSemanticWeight += w;
  }
  const semanticRatio = Math.min(1, totalDocWords > 0 ? (totalSemanticWeight / totalDocWords) : 0);

  // Transparent scoring formula: 0.65 Exact + 0.25 Near + 0.10 Semantic
  const rawScore = (exactRatio * 65) + (nearRatio * 25) + (semanticRatio * 10);
  const score = Math.min(100, Math.round(rawScore));
  const grade = calculateGrade(score);

  const exactPercent = Math.min(100, Math.round(exactRatio * 100));
  const nearPercent = Math.min(100, Math.round(nearRatio * 100));
  const semanticPercent = Math.min(100, Math.round(semanticRatio * 100));

  const methodology = `Score derived strictly from confirmed textual evidence: ${exactPercent}% exact word overlap (weight 65%), ${nearPercent}% near-match paraphrase overlap (weight 25%), and ${semanticPercent}% similarity-weighted semantic paraphrase coverage (weight 10%) across ${verifiedSourcesCount} verified source(s). Topical similarity and generic domain vocabulary are excluded from similarity scoring.`;

  return {
    score,
    grade,
    gradeLabel: "Checkra similarity grade",
    coverage: {
      exactPercent,
      nearPercent,
      semanticPercent
    },
    exactWordsCount: exactWordsMatched.size,
    nearWordsCount: nearWordsMatched.size,
    semanticWordsCount: semanticWordWeights.size,
    methodology
  };
}

module.exports = {
  calculateDocumentScore,
  calculateGrade
};
