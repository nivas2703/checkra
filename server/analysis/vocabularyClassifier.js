/**
 * Checkra Vocabulary & Lexical Specificity Classifier
 * Distinguishes between ubiquitous domain-generic terms and distinctive content-bearing terms.
 * Computes reciprocal coverage, length compatibility, and term-level evidentiary weight.
 */

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "cannot", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for",
  "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me",
  "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once", "only",
  "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so",
  "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was",
  "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "with", "would",
  "you", "your", "yours", "yourself", "yourselves"
]);

// Ubiquitous generic vocabulary across business, technology, research, and academia
// Overlap in these words alone NEVER constitutes evidence of plagiarism or derivation.
const GENERIC_TERMS = new Set([
  // Core AI & Tech generic terms
  "machine", "learning", "artificial", "intelligence", "algorithm", "algorithms",
  "system", "systems", "technology", "technologies", "computer", "computers",
  "science", "scientific", "field", "digital", "modern", "application", "applications",
  "technique", "techniques", "method", "methods", "approach", "approaches", "tool", "tools",
  "program", "programs", "programming", "software", "hardware", "network", "networks",
  "branch", "subset", "concept", "concepts", "theory", "theories", "principle", "principles",
  // Generic business & organizational terms
  "business", "businesses", "analytics",
  // Common academic & discourse verbs/adjectives
  "study", "studies", "research", "researchers", "results", "result", "analysis",
  "general", "used", "uses", "using", "use", "widely", "increasingly", "based",
  "decision", "decisions", "factor", "factors", "aspect", "aspects",
  // Common environmental & general discourse terms
  "monsoon", "season", "seasons", "seasonal", "agriculture", "agricultural", "farming",
  "farmer", "farmers", "crop", "crops", "harvest", "rainfall", "rain", "rains", "weather",
  "climate", "production", "produce", "state", "states", "country", "countries", "region",
  "regions", "affect", "affects", "affecting", "affected", "impact", "impacts", "impacting",
  "impacted", "economy", "economic", "level", "levels"
]);

// Canonical concept mappings for genuine semantic paraphrasing
const SYNONYM_CANONICAL = {
  "construct": "build_sem", "constructs": "build_sem", "constructed": "build_sem", "constructing": "build_sem",
  "build": "build_sem", "builds": "build_sem", "building": "build_sem", "built": "build_sem",
  "forecast": "predict_sem", "forecasts": "predict_sem", "forecasting": "predict_sem",
  "predict": "predict_sem", "predicts": "predict_sem", "predicting": "predict_sem", "prediction": "predict_sem", "predictions": "predict_sem",
  "manual": "explicit_sem", "manually": "explicit_sem",
  "explicit": "explicit_sem", "explicitly": "explicit_sem",
  "instruction": "program_sem", "instructions": "program_sem",
  "computational": "comput_math_sem", "mathematical": "comput_math_sem", "statistical": "comput_math_sem",
  "observation": "sample_data_sem", "observations": "sample_data_sem", "sample": "sample_data_sem", "samples": "sample_data_sem",
  "outcome": "decision_sem", "outcomes": "decision_sem",
  "enterprise": "org_sem", "enterprises": "org_sem", "organization": "org_sem", "organizations": "org_sem",
  "optimize": "improve_sem", "improve": "improve_sem", "improves": "improve_sem", "optimizing": "improve_sem",
  "pattern": "pattern_concept_sem", "patterns": "pattern_concept_sem", "model": "pattern_concept_sem", "models": "pattern_concept_sem",
  "dataset": "dataset_data_sem", "datasets": "dataset_data_sem", "data": "dataset_data_sem",
  "generate": "produce_make_sem", "generates": "produce_make_sem", "generating": "produce_make_sem", "make": "produce_make_sem", "makes": "produce_make_sem",
  "learn": "train_learn_sem", "learned": "train_learn_sem", "learning": "train_learn_sem", "training": "train_learn_sem"
};

/**
 * Lightweight deterministic suffix stemmer
 */
function stemWord(word) {
  if (!word || word.length <= 3) return word;
  const w = word.toLowerCase();
  return w
    .replace(/(?:ing|tion|tions|ment|ments|ed|es|s|al|ic|ly|ive|ize|ise)$/g, "")
    .replace(/(?:ing|tion|tions|ment|ments|ed|es|s|al|ic|ly|ive|ize|ise)$/g, "");
}

/**
 * Normalizes tokens into clean words, handling percentages and numbers
 */
function extractTokens(text) {
  if (!text) return [];
  const normalized = text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/(\d+)%/g, "$1 percent")
    .replace(/[^a-z0-9\s]/g, " ");
  return normalized.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Checks if a word is a generic domain term or stopword
 */
function isGenericTerm(word) {
  if (!word) return true;
  const lower = word.toLowerCase();
  if (STOPWORDS.has(lower) || GENERIC_TERMS.has(lower)) return true;
  const s = stemWord(lower);
  return GENERIC_TERMS.has(s);
}

/**
 * Extracts distinctive, content-bearing terms from a passage
 */
function getDistinctiveTokens(tokens) {
  return tokens.filter(t => !isGenericTerm(t));
}

/**
 * Analyzes lexical and semantic overlap between two sentences/passages
 */
function analyzeOverlap(textA, textB) {
  const tokensA = extractTokens(textA);
  const tokensB = extractTokens(textB);

  const contentA = tokensA.filter(t => !STOPWORDS.has(t));
  const contentB = tokensB.filter(t => !STOPWORDS.has(t));

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
      // Check canonical concept equivalence (e.g. pattern <-> model, generate <-> make)
      const canonA = SYNONYM_CANONICAL[rawWord] || SYNONYM_CANONICAL[stem];
      if (canonA) {
        let found = false;
        stemsB.forEach((rawB, stemB) => {
          if (!found) {
            const canonB = SYNONYM_CANONICAL[rawB] || SYNONYM_CANONICAL[stemB];
            if (canonB === canonA) {
              sharedDistinctive++;
              distinctiveTerms.push(`${rawWord}~${rawB}`);
              found = true;
            }
          }
        });
      }
    }
  });

  const lenA = Math.max(1, contentA.length);
  const lenB = Math.max(1, contentB.length);

  const totalShared = sharedGeneric + sharedDistinctive;
  const submittedCoverage = totalShared / lenA;
  const sourceCoverage = totalShared / lenB;

  // Harmonic mean for reciprocal coverage
  const reciprocalCoverage = (submittedCoverage + sourceCoverage > 0)
    ? (2 * submittedCoverage * sourceCoverage) / (submittedCoverage + sourceCoverage)
    : 0;

  const lengthRatio = Math.min(lenA, lenB) / Math.max(lenA, lenB);

  return {
    tokensA,
    tokensB,
    contentA,
    contentB,
    sharedGeneric,
    sharedDistinctive,
    distinctiveTerms,
    submittedCoverage,
    sourceCoverage,
    reciprocalCoverage,
    lengthRatio
  };
}

module.exports = {
  STOPWORDS,
  GENERIC_TERMS,
  SYNONYM_CANONICAL,
  stemWord,
  extractTokens,
  isGenericTerm,
  getDistinctiveTokens,
  analyzeOverlap
};
