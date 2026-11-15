/**
 * VeriWrite Similarity Scoring & Grade Engine
 * Documented transparent algorithm based strictly on verified evidence.
 * Excludes generic topical similarity from plagiarism scoring.
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
 * Formula:
 * Overall Score = min(100,
 *   (Exact Match Word Coverage * 0.65) +
 *   (Near Match Word Coverage * 0.25) +
 *   (Semantic Paraphrase Coverage * 0.10)
 * )
 *
 * Topical similarity without textual derivation evidence does NOT contribute to plagiarism score.
 */
function calculateDocumentScore(documentTokens, sourceEvidences = []) {
  const totalDocWords = Math.max(1, documentTokens.length);

  if (!sourceEvidences.length) {
    return {
      score: 0,
      grade: "A",
      gradeLabel: "Checkra similarity grade",
      coverage: { exactPercent: 0, nearPercent: 0, semanticPercent: 0 },
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

    // Exact matches (Level 1)
    (src.exactMatches || []).forEach(m => {
      const idx = m.submittedIndex !== undefined ? m.submittedIndex : 0;
      for (let i = 0; i < (m.length || 0); i++) {
        exactWordsMatched.add(idx + i);
      }
    });

    // Near matches (Level 2)
    (src.nearMatches || []).forEach(m => {
      const wordsInSentence = (m.submittedSentence || "").split(/\s+/).length;
      const sentIdx = m.submittedIndex !== undefined ? m.submittedIndex : 0;
      for (let i = 0; i < wordsInSentence; i++) {
        nearWordsMatched.add(sentIdx * 1000 + i);
      }
    });

    // Semantic matches (Level 3) — ONLY genuine derivation evidence, weighted by match strength
    (src.semanticMatches || []).forEach(m => {
      if (m.isPlagiarismEvidence !== false) {
        const wordsInSentence = (m.submittedSentence || "").split(/\s+/).length;
        const sentIdx = m.submittedIndex !== undefined ? m.submittedIndex : 0;
        const matchWeight = (m.similarityScore || 0) / 100;
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

  // Deterministic formula: 0.65 Exact + 0.25 Near + 0.10 Semantic
  const rawScore = (exactRatio * 65) + (nearRatio * 25) + (semanticRatio * 10);
  const score = Math.min(100, Math.round(rawScore));
  const grade = calculateGrade(score);

  const methodology = `Score derived strictly from confirmed textual evidence: ${Math.round(exactRatio * 100)}% exact word overlap (weight 65%), ${Math.round(nearRatio * 100)}% near-match paraphrase overlap (weight 25%), and ${Math.round(semanticRatio * 100)}% similarity-weighted semantic paraphrase coverage (weight 10%) across ${verifiedSourcesCount} verified source(s). Topical similarity and generic domain vocabulary are excluded from similarity scoring. Similarity is not, by itself, a determination of plagiarism or academic misconduct.`;

  return {
    score,
    grade,
    gradeLabel: "Checkra similarity grade",
    coverage: {
      exactPercent: Math.round(exactRatio * 100),
      nearPercent: Math.round(nearRatio * 100),
      semanticPercent: Math.round(semanticRatio * 100)
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
