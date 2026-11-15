/**
 * VeriWrite Natural Rewrite Provider
 * Calls Google Gemini AI to improve clarity and naturalness while preserving factual meaning.
 * Modes:
 * 1. clear-natural
 * 2. academic-readable
 * 3. professional
 * 4. concise
 * 5. simple-english
 */

const { rewriteTextWithGemini, isGeminiConfigured } = require("../services/geminiService");

const MODES = {
  "clear-natural": {
    name: "Clear & Natural",
    description: "Natural flow, engaging transitions, eliminating robotic phrasing while preserving exact meaning."
  },
  "academic-readable": {
    name: "Academic & Readable",
    description: "Scholarly precision, active scholarly verbs, clear signposting without unnecessary jargon."
  },
  "professional": {
    name: "Professional",
    description: "Polished, executive, direct, and structured for workplace or institutional review."
  },
  "concise": {
    name: "Concise",
    description: "Cuts wordiness and filler while preserving all essential factual claims."
  },
  "simple-english": {
    name: "Simple English",
    description: "Accessible vocabulary and plain syntax for straightforward readability."
  }
};

async function rewriteText(text, mode = "clear-natural") {
  if (!text || !text.trim()) {
    return {
      success: false,
      error: {
        code: "EMPTY_TEXT",
        message: "Please enter text to rewrite."
      }
    };
  }

  if (!isGeminiConfigured()) {
    return {
      success: false,
      error: {
        code: "GEMINI_NOT_CONFIGURED",
        message: "AI rewrite is currently unavailable. Please configure Gemini API access (GEMINI_API_KEY in .env)."
      }
    };
  }

  const result = await rewriteTextWithGemini(text, mode);
  return result;
}

module.exports = {
  rewriteText,
  MODES
};
