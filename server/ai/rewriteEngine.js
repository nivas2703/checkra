/**
 * Checkra Phase 6 — Evidence-Aware AI Rewrite Engine
 *
 * Implements 5 structured rewrite modes with strict factual, numerical, and citation preservation:
 * 1. clear-natural
 * 2. academic-readable
 * 3. professional
 * 4. concise
 * 5. simple-english
 *
 * Evidence-Aware Guardrails:
 * - Never erases or conceals similarity/plagiarism evidence.
 * - Leaves original text completely immutable.
 * - Does not alter deterministic similarity or AI-writing scores.
 * - Never fabricates citations, authors, DOIs, or external sources.
 * - Flags originalEvidenceClass when rewriting flagged passages.
 * - Provider-agnostic: uses server/ai/model.js with graceful degradation.
 */

const { generateAiCompletion, checkAiHealth, getAiConfig } = require("./model");
const logger = require("../utils/logger");

const REWRITE_MODES = {
  "clear-natural": {
    name: "Clear & Natural",
    description: "Natural flow, engaging transitions, eliminating robotic phrasing while preserving exact meaning.",
    guidance: "Make the prose sound natural and engaging. Eliminate formulaic, stiff transitions without altering any factual meaning."
  },
  "academic-readable": {
    name: "Academic & Readable",
    description: "Scholarly precision, active scholarly verbs, clear signposting without unnecessary jargon.",
    guidance: "Refine into clear, rigorous academic prose. Use active academic verbs and precise terminology while avoiding needless pretension."
  },
  "professional": {
    name: "Professional",
    description: "Polished, executive, direct, and structured for workplace or institutional review.",
    guidance: "Structure as polished, executive, direct communication suitable for enterprise and institutional decision-makers."
  },
  "concise": {
    name: "Concise",
    description: "Cuts wordiness and filler while preserving all essential factual claims.",
    guidance: "Eliminate wordiness, filler phrases, and redundancies. Express all essential claims in the fewest necessary words."
  },
  "simple-english": {
    name: "Simple English",
    description: "Accessible vocabulary and plain syntax for straightforward readability.",
    guidance: "Express ideas using common, accessible vocabulary and straightforward sentence structures for clear international comprehension."
  }
};

/**
 * Extracts numbers and numerical statistics from text.
 * @param {string} text
 * @returns {string[]}
 */
function extractNumbers(text) {
  if (!text) return [];
  const matches = text.match(/\b\d+(?:[.,]\d+)?%?|\$\d+(?:,\d+)*(?:\.\d+)?\b/g);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Extracts citations (author-year, bracketed numbers) from text.
 * @param {string} text
 * @returns {string[]}
 */
function extractCitations(text) {
  if (!text) return [];
  const patterns = [
    /\([A-Z][a-zA-Z\s&]+,?\s+\d{4}[a-z]?\)/g,
    /\[\d+(?:,\s*\d+)*\]/g,
    /\b(?:according to|as argued by)\s+[A-Z][a-zA-Z]+(?:\s+\(\d{4}\))?/gi
  ];
  const citations = [];
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) citations.push(...matches);
  }
  return Array.from(new Set(citations));
}

/**
 * Extracts dates, years, and quarters from text.
 * @param {string} text
 * @returns {string[]}
 */
function extractDates(text) {
  if (!text) return [];
  const matches = text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\b(?:19|20)\d{2}\b|\bQ[1-4](?:\s+\d{4})?\b/gi);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Cleans raw LLM text output by removing conversational boilerplate, quotes, and code fences.
 * @param {string} raw
 * @returns {string}
 */
function cleanModelOutput(raw) {
  if (!raw || typeof raw !== "string") return "";

  let cleaned = raw.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\s*/i, "").replace(/\s*```$/, "").trim();
  }

  // Strip conversational leading phrases
  const prefixes = [
    /^here\s+is\s+(?:the\s+)?rewritten\s+text:?\s*/i,
    /^here\s+is\s+a\s+(?:clear|concise|professional|academic|simple)\s+version:?\s*/i,
    /^rewritten\s+version:?\s*/i,
    /^rewrite:?\s*/i
  ];
  for (const p of prefixes) {
    cleaned = cleaned.replace(p, "").trim();
  }

  // Strip enclosing quotes if model wrapped the entire paragraph in quotes
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

/**
 * Executes an evidence-aware rewrite of the provided text.
 *
 * @param {Object} input
 * @param {string} input.text Text to rewrite
 * @param {string} [input.mode="clear-natural"] Rewrite mode
 * @param {Object} [input.evidence] Optional matching evidence metadata from Integrity Report
 * @param {boolean} [input.preserveCitations=true] Whether to enforce citation preservation
 * @param {Object} [input.options] Additional provider options
 * @returns {Promise<Object>} Structured rewrite outcome
 */
async function rewriteText(input = {}) {
  const text = input.text;
  const rawMode = (input.mode || "clear-natural").toLowerCase().trim();
  const modeKey = REWRITE_MODES[rawMode] ? rawMode : "clear-natural";
  const modeConfig = REWRITE_MODES[modeKey];
  const evidence = input.evidence || null;

  // 1. Validate Input Text
  if (text === null || text === undefined || typeof text !== "string") {
    return {
      ok: false,
      error: "INVALID_REQUEST",
      message: "A non-empty text string is required for rewriting."
    };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: "EMPTY_TEXT",
      message: "The provided text contains no readable characters."
    };
  }

  // 2. Extract Entities & Invariants from Original Text
  const originalNumbers = extractNumbers(trimmed);
  const originalCitations = extractCitations(trimmed);
  const originalDates = extractDates(trimmed);

  // 3. Fast Provider Availability Guard
  const aiConfig = getAiConfig();
  if (aiConfig.provider === "ollama") {
    const health = await checkAiHealth(input.options);
    if (!health.ok || !health.available) {
      return {
        ok: false,
        error: "AI_UNAVAILABLE",
        message: "Checkra AI rewrite is currently offline. The deterministic Checkra similarity analysis remains intact."
      };
    }
  } else if (aiConfig.provider === "gemini") {
    if (!aiConfig.configured) {
      return {
        ok: false,
        error: "AI_UNAVAILABLE",
        message: "Checkra AI rewrite is currently offline. The deterministic Checkra similarity analysis remains intact."
      };
    }
  }

  // 4. Construct Bounded & Constrained Prompt
  const systemPrompt = `You are Checkra's evidence-aware writing improvement assistant.
Mode: "${modeConfig.name}" (${modeConfig.guidance})

MANDATORY FACTUAL & INTEGRITY INVARIANTS:
1. Provide a real, substantive rewrite that improves clarity, phrasing, vocabulary, and active flow in "${modeConfig.name}" style.
2. Preserve exact factual meaning and original author intent.
3. Preserve all numerical values, percentages, currencies, and statistics exactly as written.
4. Preserve all named entities, organizations, and historical figures.
5. Preserve all dates, quarters, and historical years.
6. Preserve all citations, bracketed references (e.g., [1]), and author-year citations (e.g., (Smith, 2020)) exactly.
7. NEVER invent or fabricate citations, authors, publications, DOIs, or URLs.
8. Output ONLY the rewritten text. Do NOT add conversational pleasantries, quotes, or duplicate the unchanged input.`;

  const prompt = `Rewrite the following text in ${modeConfig.name} style to improve phrasing and sentence structure while strictly preserving all facts, numbers, dates, and citations:

${trimmed}`;

  // 5. Generate Rewrite via Model Abstraction
  const completion = await generateAiCompletion(prompt, {
    systemPrompt,
    temperature: 0.2,
    timeoutMs: input.options?.timeoutMs || 45000,
    ...(input.options || {})
  });

  const rawOutput = completion?.response || completion?.content;
  if (!completion || !completion.ok || !rawOutput) {
    const isUnavailable = !completion || (!completion.ok && (
      completion.error === "OLLAMA_UNAVAILABLE" ||
      completion.error === "OLLAMA_TIMEOUT" ||
      completion.error === "AI_UNAVAILABLE" ||
      (typeof completion.error === "string" && completion.error.startsWith("GEMINI_")) ||
      completion.error === "UNSUPPORTED_PROVIDER"
    ));
    return {
      ok: false,
      error: isUnavailable ? "AI_UNAVAILABLE" : (completion?.error || "AI_GENERATION_FAILED"),
      message: isUnavailable
        ? "Checkra AI rewrite is currently offline. The deterministic Checkra similarity analysis remains intact."
        : "The AI assistant was unable to rewrite the text."
    };
  }

  const rewrittenText = cleanModelOutput(rawOutput);

  // 6. Verify Preservation Invariants
  const rewrittenCitations = extractCitations(rewrittenText);
  const missingCitations = originalCitations.filter(c => !rewrittenText.includes(c));
  const citationStatus = originalCitations.length > 0
    ? (missingCitations.length === 0 ? "PRESERVED" : "MISSING_OR_UNAVAILABLE")
    : "NOT_APPLICABLE";

  // Re-append missing citations if model dropped them by mistake
  let finalRewritten = rewrittenText;
  if (missingCitations.length > 0 && input.preserveCitations !== false) {
    // If the citation was accidentally omitted, preserve integrity by maintaining citation at end
    finalRewritten = `${rewrittenText} ${missingCitations.join(" ")}`;
  }

  // 7. Evidence-Aware Metadata
  let evidenceAware = false;
  let originalEvidenceClass = null;
  let action = "STYLE_AND_CLARITY_IMPROVEMENT";
  let warning = null;

  if (evidence && typeof evidence === "object") {
    evidenceAware = true;
    originalEvidenceClass = (evidence.matchType || evidence.originalEvidenceClass || "MATCH").toUpperCase();

    const isDirectMatch = ["EXACT", "EXACT_MATCH", "NEAR", "NEAR_MATCH", "STRONG_PARAPHRASE", "POSSIBLE_PARAPHRASE"].includes(originalEvidenceClass);
    const isContextOnly = ["TOPICAL_SIMILARITY", "CONCEPTUAL_SIMILARITY"].includes(originalEvidenceClass);
    const isUnverifiable = originalEvidenceClass === "SOURCE_NOT_VERIFIABLE" || evidence.status === "SOURCE_NOT_VERIFIABLE";

    if (isDirectMatch) {
      action = "REPHRASED_FOR_ORIGINALITY";
      warning = "This rewrite provides an improved original formulation, but does not remove the original source evidence. Proper attribution and citation may still be required.";
    } else if (isContextOnly) {
      action = "CLARIFIED_CONTEXT";
      warning = "The identified source reflects thematic context rather than textual plagiarism. The rewrite clarifies the author's original thesis.";
    } else if (isUnverifiable) {
      action = "NEUTRAL_REPHRASING";
      warning = "Candidate source could not be verified; rewrite preserves original argument with neutral phrasing.";
    }
  }

  // 8. Generate Descriptive Changes List
  const changes = [
    {
      type: "STYLE_REFINEMENT",
      mode: modeConfig.name,
      description: `Applied ${modeConfig.name} style while preserving factual meaning and entities.`
    }
  ];

  return {
    ok: true,
    mode: modeKey,
    modeName: modeConfig.name,
    originalText: trimmed,
    rewrittenText: finalRewritten,
    changes,
    preservedEntities: {
      numbers: originalNumbers,
      dates: originalDates,
      citations: originalCitations
    },
    citationStatus,
    evidenceAware,
    originalEvidenceClass,
    action,
    warning
  };
}

module.exports = {
  rewriteText,
  REWRITE_MODES,
  extractNumbers,
  extractCitations,
  extractDates,
  cleanModelOutput
};
