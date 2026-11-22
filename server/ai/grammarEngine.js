/**
 * Checkra Phase 6 — Grammar & Linguistic Quality Engine
 *
 * Provides high-precision deterministic linguistic, grammatical, and stylistic auditing:
 * - Grammar & syntax (subject-verb agreement, double words, non-standard words)
 * - Punctuation & mechanics (spacing, quotation pairing, repeated punctuation)
 * - Spelling & homophones (their/there/they're, its/it's, affect/effect, your/you're, lead/led)
 * - Wordiness & redundancies (e.g. "due to the fact that" -> "because", "in order to" -> "to")
 * - Readability & clarity (overly complex sentences, weak intensifiers)
 *
 * Strict Compliance:
 * - Never fabricates issues on clean, well-formed prose.
 * - Categorizes severity: HIGH, MEDIUM, LOW.
 * - Does not modify original text.
 */

// Comprehensive high-precision linguistic patterns
const GRAMMAR_RULES = [
  // 1. Homophones & Confused Words
  {
    id: "homophone_there_their",
    regex: /\b(there)\s+(cars?|houses?|dogs?|books?|data|systems?|methods?|results?|papers?|work|ideas?|teams?|code|findings?)\b/gi,
    type: "SPELLING",
    severity: "HIGH",
    test: (match, text, offset) => ({
      original: match,
      suggestion: match.replace(/there/i, (m) => (m[0] === 'T' ? 'Their' : 'their')),
      explanation: "Use possessive 'their' before nouns rather than directional 'there'."
    })
  },
  {
    id: "homophone_their_existential",
    regex: /\b(their)\s+(is|are|was|were|has\s+been|have\s+been)\b/gi,
    type: "SPELLING",
    severity: "HIGH",
    test: (match, text, offset) => ({
      original: match,
      suggestion: match.replace(/their/i, (m) => (m[0] === 'T' ? 'There' : 'there')),
      explanation: "Use existential 'there' before linking verbs rather than possessive 'their'."
    })
  },
  {
    id: "homophone_its_it_is",
    regex: /\b(it's)\s+(components?|properties|attributes|features?|parameters?|results?|significance|purpose|value|speed|color)\b/gi,
    type: "SPELLING",
    severity: "HIGH",
    test: (match, text, offset) => ({
      original: match,
      suggestion: match.replace(/it's/i, (m) => (m[0] === 'I' ? 'Its' : 'its')),
      explanation: "Use possessive 'its' (no apostrophe) before a noun. 'It\\'s' is a contraction for 'it is'."
    })
  },
  {
    id: "homophone_affect_effect",
    regex: /\b(have|has|had|an|the|this|that|adverse|positive|negative|direct|indirect)\s+(affect)\b/gi,
    type: "SPELLING",
    severity: "MEDIUM",
    test: (match, text, offset) => ({
      original: match,
      suggestion: match.replace(/\baffect\b/i, (m) => (m[0] === 'A' ? 'Effect' : 'effect')),
      explanation: "Use 'effect' as a noun when preceded by determiners or adjectives."
    })
  },
  {
    id: "homophone_your_you_are",
    regex: /\b(your)\s+(welcome|going|doing|able|ready|correct|mistaken)\b/gi,
    type: "SPELLING",
    severity: "HIGH",
    test: (match, text, offset) => ({
      original: match,
      suggestion: match.replace(/your/i, (m) => (m[0] === 'Y' ? "You're" : "you're")),
      explanation: "Use 'you're' (contraction of 'you are') instead of possessive 'your'."
    })
  },
  {
    id: "non_standard_irregardless",
    regex: /\b(irregardless)\b/gi,
    type: "GRAMMAR",
    severity: "HIGH",
    suggestion: "regardless",
    explanation: "'Irregardless' is non-standard; use 'regardless'."
  },
  {
    id: "duplicated_words",
    regex: /\b([a-zA-Z]{2,})\s+\1\b/gi,
    type: "GRAMMAR",
    severity: "HIGH",
    test: (match, text, offset) => {
      const parts = match.split(/\s+/);
      const word = parts[0].toLowerCase();
      // Allow legitimate doubling like "that that" or "had had" in specific contexts
      if (["that", "had"].includes(word)) return null;
      return {
        original: match,
        suggestion: parts[0],
        explanation: `Duplicated consecutive word '${parts[0]}'.`
      };
    }
  },

  // 2. Mechanics & Punctuation
  {
    id: "whitespace_before_punctuation",
    regex: /\s+([,;:?.!])/g,
    type: "PUNCTUATION",
    severity: "MEDIUM",
    test: (match, text, offset) => {
      const punct = match.trim();
      return {
        original: match,
        suggestion: punct + " ",
        explanation: `Extraneous whitespace detected before punctuation '${punct}'.`
      };
    }
  },
  {
    id: "repeated_punctuation",
    regex: /([?!.,]){2,}/g,
    type: "PUNCTUATION",
    severity: "LOW",
    test: (match, text, offset) => {
      // Allow ellipsis "..."
      if (match === "..." || match === "....") return null;
      return {
        original: match,
        suggestion: match[0],
        explanation: "Repeated punctuation marks should be avoided in formal writing."
      };
    }
  },

  // 3. Wordiness & Redundancies
  {
    id: "wordiness_in_order_to",
    regex: /\b(in order to)\b/gi,
    type: "WORDINESS",
    severity: "LOW",
    suggestion: "to",
    explanation: "'In order to' is wordy. 'To' conveys the same meaning more directly."
  },
  {
    id: "wordiness_due_to_the_fact",
    regex: /\b(due to the fact that)\b/gi,
    type: "WORDINESS",
    severity: "MEDIUM",
    suggestion: "because",
    explanation: "Replace 'due to the fact that' with 'because' or 'since' for concise clarity."
  },
  {
    id: "wordiness_for_the_purpose_of",
    regex: /\b(for the purpose of)\b/gi,
    type: "WORDINESS",
    severity: "LOW",
    suggestion: "to",
    explanation: "'For the purpose of' can be simplified to 'to' or 'for'."
  },
  {
    id: "wordiness_at_the_present_time",
    regex: /\b(at the present time|at this point in time)\b/gi,
    type: "WORDINESS",
    severity: "LOW",
    suggestion: "currently",
    explanation: "Replace verbose temporal phrases with 'currently' or 'now'."
  },
  {
    id: "wordiness_take_into_consideration",
    regex: /\b(take into consideration|takes into consideration|taking into consideration)\b/gi,
    type: "WORDINESS",
    severity: "LOW",
    suggestion: "consider",
    explanation: "'Take into consideration' can be simplified to 'consider'."
  },
  {
    id: "wordiness_a_broad_variety_of",
    regex: /\b(a broad variety of|a wide variety of)\b/gi,
    type: "WORDINESS",
    severity: "LOW",
    suggestion: "various",
    explanation: "Replace 'a broad variety of' with 'various' or 'many'."
  },
  {
    id: "tautology_collaborate_together",
    regex: /\b(collaborate together|merge together|combine together)\b/gi,
    type: "REPETITION",
    severity: "LOW",
    test: (match) => {
      const firstWord = match.split(/\s+/)[0];
      return {
        original: match,
        suggestion: firstWord,
        explanation: `'${match}' is redundant because '${firstWord}' already implies doing so together.`
      };
    }
  },

  // 4. Clarity & Weak Intensifiers
  {
    id: "weak_intensifier",
    regex: /\b(very|extremely|really)\s+(unique|essential|crucial|vital|irreplaceable|perfect)\b/gi,
    type: "CLARITY",
    severity: "LOW",
    test: (match) => {
      const parts = match.split(/\s+/);
      return {
        original: match,
        suggestion: parts[1],
        explanation: `'${parts[1]}' is an absolute descriptor and does not require '${parts[0]}'.`
      };
    }
  }
];

/**
 * Checks text against high-precision grammatical, mechanical, and stylistic rules.
 *
 * @param {string} text Text to check
 * @returns {Array<Object>} List of detected issues
 */
function checkGrammarRules(text) {
  if (!text || typeof text !== "string") return [];

  const issues = [];
  const seenMatches = new Set();

  for (const rule of GRAMMAR_RULES) {
    let match;
    const regex = new RegExp(rule.regex.source, rule.regex.flags);

    while ((match = regex.exec(text)) !== null) {
      const offset = match.index;
      const matchedStr = match[0];
      const dedupeKey = `${rule.id}_${offset}_${matchedStr}`;

      if (seenMatches.has(dedupeKey)) continue;
      seenMatches.add(dedupeKey);

      let issueData = null;
      if (typeof rule.test === "function") {
        issueData = rule.test(matchedStr, text, offset);
      } else {
        issueData = {
          original: matchedStr,
          suggestion: rule.suggestion || "",
          explanation: rule.explanation || ""
        };
      }

      if (issueData) {
        issues.push({
          id: `g_${rule.id}_${issues.length + 1}`,
          type: rule.type,
          severity: rule.severity,
          original: issueData.original,
          suggestion: issueData.suggestion,
          explanation: issueData.explanation,
          offset,
          length: matchedStr.length
        });
      }
    }
  }

  return issues;
}

/**
 * Analyzes sentence length and readability cadence.
 *
 * @param {string} text
 * @returns {Array<Object>} Readability / structural issues
 */
function checkReadabilityIssues(text) {
  if (!text || typeof text !== "string") return [];

  const issues = [];
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0 && /[a-zA-Z0-9]/.test(s));

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();
    const words = s.split(/\s+/).filter(Boolean);

    // Flag overly complex / run-on sentences (> 45 words)
    if (words.length > 45) {
      issues.push({
        id: `r_length_${i + 1}`,
        type: "READABILITY",
        severity: "MEDIUM",
        original: s.length > 80 ? s.slice(0, 77) + "..." : s,
        suggestion: "Consider splitting into two or more distinct sentences.",
        explanation: `This sentence is unusually long (${words.length} words), which may hinder comprehension.`
      });
    }
  }

  return issues;
}

module.exports = {
  checkGrammarRules,
  checkReadabilityIssues,
  GRAMMAR_RULES
};
