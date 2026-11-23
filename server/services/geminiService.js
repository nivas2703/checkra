/**
 * VeriWrite Gemini AI Service
 * Official Google Gemini integration for:
 * 1. Plagiarism evidence review (evidence-grounded, no invented sources)
 * 2. Google Search Grounding for web source discovery (real metadata check)
 * 3. Natural rewriting / writing improvement across 5 modes
 *
 * Security: GEMINI_API_KEY is never exposed to the client.
 */

const { GoogleGenAI } = require("@google/genai");
const logger = require("../utils/logger");

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return null;
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

function getGeminiModel() {
  const envModel = process.env.GEMINI_MODEL;
  if (envModel && envModel !== "gemini-3.5-flash") {
    return envModel;
  }
  return "gemini-2.5-flash";
}

function isGeminiConfigured() {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 5);
}

/**
 * Tests real live connection to Gemini API
 */
async function testGeminiConnection() {
  if (!isGeminiConfigured()) {
    return { ok: false, error: "GEMINI_NOT_CONFIGURED" };
  }
  const ai = getGeminiClient();
  const modelName = getGeminiModel();
  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: "Respond with the single word: OK"
    });
    return { ok: true, model: modelName, text: (res.text || "").trim() };
  } catch (err) {
    // If model is not found, try gemini-1.5-flash
    if (err.message && (err.message.includes("404") || err.message.includes("NOT_FOUND"))) {
      try {
        const fallbackRes = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: "Respond with the single word: OK"
        });
        return { ok: true, model: "gemini-1.5-flash (fallback)", text: (fallbackRes.text || "").trim() };
      } catch (fallbackErr) {
        return { ok: false, error: fallbackErr.message };
      }
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Tests real live Google Search Grounding with Gemini API
 */
async function testGeminiGrounding() {
  if (!isGeminiConfigured()) {
    return { available: false, status: "NOT_CONFIGURED", reason: "Gemini not configured" };
  }
  const ai = getGeminiClient();
  const modelName = getGeminiModel();
  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: "What is the capital of France?",
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    const gm = res.candidates?.[0]?.groundingMetadata;
    const chunkCount = gm?.groundingChunks?.length || 0;
    return {
      available: true,
      status: "AVAILABLE",
      chunkCount,
      queries: gm?.webSearchQueries || []
    };
  } catch (err) {
    const isQuota = err.message && (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED"));
    return {
      available: false,
      status: isQuota ? "QUOTA_EXHAUSTED" : "UNAVAILABLE",
      reason: isQuota ? "API quota exhausted" : err.message
    };
  }
}

function classifyGeminiError(err) {
  const msg = String(err?.message || "");
  const status = String(err?.status || "");

  // Check for HTTP 503 / Service Unavailable / High demand
  const is503 = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand") || status === "503";
  // Check for transient 429 / Rate limit
  const isTransient429 = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("rate-limit") || status === "429";
  // Check for network timeout or connection reset
  const isNetwork = msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed");

  // Check for permanent errors (do not retry)
  const isAuth = msg.includes("API_KEY_INVALID") || msg.includes("invalid API key") || msg.includes("PERMISSION_DENIED") || msg.includes("401") || msg.includes("403");
  const isNotFound = msg.includes("404") || msg.includes("NOT_FOUND") || msg.includes("is not found");
  const isBadRequest = msg.includes("400") || msg.includes("INVALID_ARGUMENT");

  if (isAuth) {
    return {
      type: "PERMANENT_AUTH",
      status: "FAILED",
      state: "AI_REVIEW_FAILED",
      retryable: false,
      userMessage: "Gemini API authentication failed. Please verify your GEMINI_API_KEY."
    };
  }

  if (isNotFound) {
    return {
      type: "PERMANENT_MODEL_NOT_FOUND",
      status: "FAILED",
      state: "AI_REVIEW_FAILED",
      retryable: false,
      userMessage: "Configured Gemini model is not accessible. Please check your GEMINI_MODEL setting."
    };
  }

  if (isBadRequest) {
    return {
      type: "PERMANENT_BAD_REQUEST",
      status: "FAILED",
      state: "AI_REVIEW_FAILED",
      retryable: false,
      userMessage: "Gemini request validation failed."
    };
  }

  if (is503) {
    return {
      type: "TRANSIENT_503",
      status: "UNAVAILABLE",
      state: "AI_REVIEW_UNAVAILABLE",
      retryable: true,
      userMessage: "Gemini is currently experiencing high demand. Your similarity analysis and web-source matching are still available."
    };
  }

  if (isTransient429) {
    return {
      type: "TRANSIENT_429",
      status: "UNAVAILABLE",
      state: "AI_REVIEW_UNAVAILABLE",
      retryable: true,
      userMessage: "Gemini request quota temporarily reached. Please retry in a few moments."
    };
  }

  if (isNetwork) {
    return {
      type: "TRANSIENT_NETWORK",
      status: "UNAVAILABLE",
      state: "AI_REVIEW_UNAVAILABLE",
      retryable: true,
      userMessage: "Temporary network interruption while connecting to Gemini. Please try again."
    };
  }

  return {
    type: "UNKNOWN",
    status: "UNAVAILABLE",
    state: "AI_REVIEW_UNAVAILABLE",
    retryable: true,
    userMessage: "Gemini is currently experiencing high demand. Your similarity analysis and web-source matching are still available."
  };
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 1. Evidence Review: Evaluates actual retrieved evidence.
 * Gemini reviews only provided submitted passage and retrieved source passage.
 * Does NOT generate new sources or proclaim guilt.
 * Features automatic 3x retry with exponential backoff for transient 503/UNAVAILABLE errors.
 */
async function reviewEvidenceWithGemini(evidenceItems = [], options = {}) {
  if (!isGeminiConfigured()) {
    return {
      status: "NOT_CONFIGURED",
      state: "AI_REVIEW_NOT_CONFIGURED",
      available: false,
      retryable: false,
      message: "Gemini AI review unavailable — configure GEMINI_API_KEY in environment.",
      items: []
    };
  }

  if (!evidenceItems.length) {
    return {
      status: "SKIPPED",
      state: "NO_PASSAGES_TO_REVIEW",
      available: false,
      retryable: false,
      message: "No passages met the criteria for AI evidence review.",
      items: []
    };
  }

  const ai = getGeminiClient();
  let modelName = getGeminiModel();

  const prompt = `You are the VeriWrite Research Integrity & Evidence Review Layer.
CRITICAL INTEGRITY RULES:
1. You must review ONLY the supplied evidence items (submitted passages and retrieved source passages).
2. NEVER invent sources, URLs, authors, journals, or quotations.
3. NEVER accuse the author of deliberate plagiarism or academic misconduct.
4. For each evidence item, classify the confidence of the match as:
   - "HIGH CONFIDENCE MATCH"
   - "POSSIBLE MATCH"
   - "LOW CONFIDENCE"
   - "NOT A MATCH"
5. For each item provide:
   - id: match the input id
   - classification: one of the 4 categories above
   - reason: concise explanation of wording overlap or alignment
   - evidenceExplanation: breakdown of identical vs paraphrased sequences
   - recommendedAction: neutral guidance (e.g., "Add quotation marks and formal citation", "Verify original author attribution", "No action needed")

EVIDENCE ITEMS TO REVIEW:
${JSON.stringify(evidenceItems, null, 2)}

Respond ONLY with valid JSON in this exact structure:
{
  "summary": "Overall assessment of evidence overlap",
  "items": [
    {
      "id": "item id",
      "classification": "HIGH CONFIDENCE MATCH | POSSIBLE MATCH | LOW CONFIDENCE | NOT A MATCH",
      "reason": "...",
      "evidenceExplanation": "...",
      "recommendedAction": "..."
    }
  ]
}`;

  logger.logEvent("gemini_evidence_review_started", { count: evidenceItems.length, model: modelName });

  const timeoutMs = options.timeoutMs || 4000;
  const maxAttempts = options.maxAttempts || 2;
  const backoffDelays = [800, 1500];
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        logger.info(`Retrying Gemini AI evidence review (attempt ${attempt}/${maxAttempts})...`);
      }
      const response = await Promise.race([
        ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.1
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`ETIMEDOUT: Gemini API call timed out after ${timeoutMs}ms`)), timeoutMs))
      ]);

      const text = response.text || "{}";
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        const clean = text.replace(/```(?:json)?/gi, "").trim();
        parsed = JSON.parse(clean);
      }

      logger.info(`Gemini AI evidence review succeeded on attempt ${attempt}`);
      return {
        status: "SUCCESS",
        state: "COMPLETED",
        available: true,
        retryable: false,
        model: modelName,
        summary: parsed.summary || "Gemini evidence review completed.",
        items: parsed.items || []
      };
    } catch (err) {
      lastError = err;
      const errorInfo = classifyGeminiError(err);

      // Log detailed error on server only — never expose raw JSON to user
      logger.warn(`Gemini evidence review attempt ${attempt} failed`, {
        error: err.message,
        type: errorInfo.type,
        retryable: errorInfo.retryable
      });

      // Stop immediately on permanent non-retryable errors
      if (!errorInfo.retryable) {
        return {
          status: errorInfo.status,
          state: errorInfo.state,
          available: false,
          retryable: false,
          message: errorInfo.userMessage,
          items: []
        };
      }

      // If more attempts remain, wait exponential backoff
      if (attempt < maxAttempts) {
        const delay = backoffDelays[attempt - 1] || 4000;
        logger.info(`Waiting ${delay}ms before next Gemini retry...`);
        await sleep(delay);
      }
    }
  }

  // All 3 automatic retries failed — return clean structured unavailable state
  const finalErrorInfo = classifyGeminiError(lastError);
  logger.error("Gemini evidence review unavailable after all retries", {
    attempts: maxAttempts,
    error: lastError?.message
  });

  return {
    status: finalErrorInfo.status,
    state: finalErrorInfo.state,
    available: false,
    retryable: finalErrorInfo.retryable,
    message: finalErrorInfo.userMessage,
    items: []
  };
}

/**
 * 2. Gemini Web Grounding: Uses official Google Search tool to find actual web sources.
 * If grounding metadata is returned, extracts real grounding URLs and queries.
 * If unavailable or rate-limited, reports unavailable cleanly.
 */
async function searchWebWithGeminiGrounding(documentText, queries = []) {
  if (!isGeminiConfigured()) {
    return {
      supported: false,
      grounded: false,
      sources: [],
      error: "Gemini is not configured."
    };
  }

  const ai = getGeminiClient();
  let modelName = getGeminiModel();

  const sampleText = documentText.slice(0, 2000);
  const prompt = `Search the public web using Google Search to identify published articles, academic papers, and websites that contain passages matching or discussing the following text:

TEXT TO CHECK:
"""
${sampleText}
"""

SEARCH QUERIES TO PRIORITIZE:
${queries.slice(0, 5).map(q => `- ${q}`).join("\n")}

Identify exact and near-match published sources.`;

  try {
    logger.logEvent("gemini_web_grounding_started", { queryCount: queries.length, model: modelName });
    let response;
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.1
        }
      });
    } catch (e) {
      if (e.message && (e.message.includes("404") || e.message.includes("503"))) {
        modelName = "gemini-3.5-flash-lite";
        response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.1
          }
        });
      } else {
        throw e;
      }
    }

    const candidate = response.candidates?.[0];
    const groundingMetadata = candidate?.groundingMetadata;

    const sources = [];
    if (groundingMetadata && groundingMetadata.groundingChunks?.length > 0) {
      const chunks = groundingMetadata.groundingChunks || [];
      const searchQueries = groundingMetadata.webSearchQueries || [];

      chunks.forEach((chunk, idx) => {
        if (chunk.web && chunk.web.uri) {
          sources.push({
            title: chunk.web.title || `Grounded Web Source #${idx + 1}`,
            url: chunk.web.uri,
            snippet: (response.text || "").slice(0, 200),
            sourceType: "Internet",
            groundedByGemini: true
          });
        }
      });

      return {
        supported: true,
        grounded: true,
        queries: searchQueries,
        sources,
        summary: response.text
      };
    }

    // Grounding tool ran but returned no grounding chunks
    return {
      supported: true,
      grounded: false,
      sources: [],
      error: "Gemini executed search but returned no specific grounding chunks."
    };
  } catch (err) {
    logger.warn("Gemini web grounding unavailable for model/tier", { error: err.message });
    return {
      supported: false,
      grounded: false,
      sources: [],
      error: err.message
    };
  }
}

/**
 * 3. AI Rewrite / Humanize: Rewrites supplied text using Gemini
 * Supported modes: clear-natural, academic-readable, professional, concise, simple-english
 */
const REWRITE_MODE_PROMPTS = {
  "clear-natural": "Clear & Natural: Improve natural cadence, transition smoothness, and phrasing flow while maintaining exact meaning.",
  "academic-readable": "Academic & Readable: Scholarly tone, active scholarly verbs, rigorous structure, and clarity without unnecessary jargon.",
  "professional": "Professional: Executive, polished, action-oriented, and direct.",
  "concise": "Concise: Remove wordiness, filler phrases, and redundancy while preserving every essential piece of factual information.",
  "simple-english": "Simple English: Use plain English, straightforward sentence structures, and accessible vocabulary."
};

async function rewriteTextWithGemini(text, mode = "clear-natural") {
  if (!isGeminiConfigured()) {
    return {
      success: false,
      error: {
        code: "GEMINI_NOT_CONFIGURED",
        message: "AI rewrite is currently unavailable. Please configure Gemini API access (GEMINI_API_KEY in .env)."
      }
    };
  }

  if (!text || !text.trim()) {
    return {
      success: false,
      error: {
        code: "EMPTY_TEXT",
        message: "No text provided for rewriting."
      }
    };
  }

  const ai = getGeminiClient();
  let modelName = getGeminiModel();
  const modeInstruction = REWRITE_MODE_PROMPTS[mode] || REWRITE_MODE_PROMPTS["clear-natural"];

  const systemInstruction = `You are a professional writing editor. Rewrite the supplied text to improve clarity, readability, sentence flow, grammar, and natural expression while preserving the original meaning, factual claims, citations, and important terminology. Do not invent facts. Do not remove citations. Do not intentionally evade plagiarism or AI-detection systems.
STYLE TARGET: ${modeInstruction}
CRITICAL FORMATTING INSTRUCTION:
Return ONLY the single rewritten version of the text. Do NOT provide multiple options. Do NOT provide preamble, introductory phrases (such as "Here is..."), markdown bold headers, bullet lists, notes, or explanations. Return just the clean rewritten passage.`;

  try {
    logger.logEvent("gemini_rewrite_started", { mode, charLength: text.length, model: modelName });
    let response;
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: text,
        config: {
          systemInstruction,
          temperature: 0.2
        }
      });
    } catch (e) {
      if (e.message && (e.message.includes("404") || e.message.includes("503") || e.message.includes("429") || e.message.includes("RESOURCE_EXHAUSTED"))) {
        modelName = "gemini-3.5-flash-lite";
        response = await ai.models.generateContent({
          model: modelName,
          contents: text,
          config: {
            systemInstruction,
            temperature: 0.2
          }
        });
      } else {
        throw e;
      }
    }

    let rewritten = (response.text || "").trim();
    // Strip leading/trailing quote marks if the model enclosed the whole text in quotes
    if ((rewritten.startsWith('"') && rewritten.endsWith('"')) || (rewritten.startsWith("'") && rewritten.endsWith("'"))) {
      rewritten = rewritten.slice(1, -1).trim();
    }

    if (!rewritten) {
      throw new Error("Gemini returned an empty response.");
    }

    return {
      success: true,
      originalText: text,
      revisedText: rewritten,
      mode,
      model: modelName
    };
  } catch (err) {
    logger.error("Gemini rewrite API error", { error: err.message });
    return {
      success: false,
      error: {
        code: "REWRITE_FAILED",
        message: `Gemini rewrite failed: ${err.message}`
      }
    };
  }
}

module.exports = {
  getGeminiClient,
  getGeminiModel,
  isGeminiConfigured,
  testGeminiConnection,
  testGeminiGrounding,
  reviewEvidenceWithGemini,
  searchWebWithGeminiGrounding,
  rewriteTextWithGemini,
  classifyGeminiError
};
