/**
 * Checkra AI Provider Abstraction
 * Unified Dual-Provider Gateway (Local Ollama + Vercel Production Gemini)
 *
 * Architecture:
 * - Local Provider: Ollama HTTP API (http://127.0.0.1:11434) running qwen3:1.7b
 * - Production Provider: Google Gemini API (@google/genai) running gemini-2.5-flash
 * - Isolation: Decoupled from deterministic similarity, scoring, and document extraction
 *
 * Security:
 * - Server strictly controls provider, baseUrl, model, and API key server-side
 * - API keys and credentials are never exposed in responses or logs
 * - Never executes shell commands
 */

const { GoogleGenAI } = require("@google/genai");

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3:1.7b";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const FALLBACK_GEMINI_MODEL = "gemini-1.5-flash";
const DEFAULT_TIMEOUT_MS = 60000; // 60s timeout for local CPU generation / remote APIs

function getAiConfig() {
  const envProvider = process.env.AI_PROVIDER
    ? process.env.AI_PROVIDER.toLowerCase().trim()
    : (process.env.VERCEL ? "gemini" : "ollama");

  if (envProvider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY || "";
    const rawModel = process.env.GEMINI_MODEL;
    const model = (rawModel && rawModel !== "gemini-3.5-flash") ? rawModel : DEFAULT_GEMINI_MODEL;
    return {
      provider: "gemini",
      model,
      apiKey,
      configured: Boolean(apiKey && apiKey.trim().length > 5)
    };
  }

  if (envProvider === "ollama") {
    const baseUrl = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
    const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
    return {
      provider: "ollama",
      baseUrl,
      model,
      configured: true
    };
  }

  return {
    provider: envProvider,
    model: "unknown",
    configured: false,
    error: "UNSUPPORTED_PROVIDER"
  };
}

/**
 * Checks connectivity and model availability for the configured AI provider.
 * Does NOT start Ollama or download models automatically.
 * Does NOT fabricate success.
 *
 * @param {Object} [overrideConfig] Optional config override (for testing)
 * @returns {Promise<Object>} Structured health status
 */
async function checkAiHealth(overrideConfig = {}) {
  const overrides = (overrideConfig && typeof overrideConfig === "object" && overrideConfig.overrideConfig)
    ? overrideConfig.overrideConfig
    : (overrideConfig || {});
  const config = { ...getAiConfig(), ...overrides };

  // ==========================================
  // 1. OLLAMA PROVIDER HEALTH
  // ==========================================
  if (config.provider === "ollama") {
    try {
      const baseUrl = config.baseUrl || DEFAULT_OLLAMA_BASE_URL;
      const tagsUrl = `${baseUrl}/api/tags`;
      const res = await fetch(tagsUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        return {
          ok: false,
          provider: "ollama",
          model: config.model || DEFAULT_OLLAMA_MODEL,
          configured: true,
          available: false,
          error: `OLLAMA_HTTP_${res.status}`
        };
      }

      const data = await res.json();
      const models = Array.isArray(data?.models) ? data.models : [];
      
      const targetModel = (config.model || DEFAULT_OLLAMA_MODEL).toLowerCase();
      const modelFound = models.some(m => {
        const name = (m.name || m.model || "").toLowerCase();
        return name === targetModel || name.startsWith(`${targetModel}:`) || targetModel.startsWith(`${name}:`);
      });

      if (!modelFound) {
        return {
          ok: false,
          provider: "ollama",
          model: config.model || DEFAULT_OLLAMA_MODEL,
          configured: true,
          available: false,
          error: "MODEL_NOT_FOUND",
          installedModels: models.map(m => m.name || m.model)
        };
      }

      return {
        ok: true,
        provider: "ollama",
        model: config.model || DEFAULT_OLLAMA_MODEL,
        configured: true,
        available: true
      };
    } catch (err) {
      const isRefused = err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED") || err.message?.includes("connect");
      const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");

      return {
        ok: false,
        provider: "ollama",
        model: config.model || DEFAULT_OLLAMA_MODEL,
        configured: true,
        available: false,
        error: isRefused ? "OLLAMA_UNAVAILABLE" : (isTimeout ? "OLLAMA_TIMEOUT" : "OLLAMA_ERROR")
      };
    }
  }

  // ==========================================
  // 2. GEMINI PROVIDER HEALTH
  // ==========================================
  if (config.provider === "gemini") {
    const apiKey = typeof config.apiKey === "string" ? config.apiKey : (process.env.GEMINI_API_KEY || "");
    const envModel = process.env.GEMINI_MODEL;
    const model = (config.model && config.model.toLowerCase().startsWith("gemini") && config.model !== "gemini-3.5-flash")
      ? config.model
      : ((envModel && envModel !== "gemini-3.5-flash") ? envModel : DEFAULT_GEMINI_MODEL);

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 6) {
      return {
        ok: false,
        provider: "gemini",
        model,
        configured: false,
        available: false,
        error: "GEMINI_NOT_CONFIGURED",
        message: "GEMINI_API_KEY is not configured in the environment."
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      const res = await Promise.race([
        ai.models.generateContent({
          model,
          contents: "Respond with the single word: OK"
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini health check timed out")), 8000))
      ]);

      const text = (res && typeof res.text === "string" ? res.text.trim() : "");
      if (!text) {
        return {
          ok: false,
          provider: "gemini",
          model,
          configured: true,
          available: false,
          error: "GEMINI_EMPTY_RESPONSE"
        };
      }

      return {
        ok: true,
        provider: "gemini",
        model,
        configured: true,
        available: true
      };
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      let error = "GEMINI_ERROR";
      let userMessage = "Gemini service is unavailable.";

      if (msg.includes("401") || msg.includes("unauthenticated") || msg.includes("api key not valid") || msg.includes("access_token_type_unsupported")) {
        error = "GEMINI_AUTH_FAILED";
        userMessage = "Invalid or unsupported GEMINI_API_KEY.";
      } else if (msg.includes("403") || msg.includes("permission_denied")) {
        error = "GEMINI_PERMISSION_DENIED";
        userMessage = "Gemini API key lacks required permissions.";
      } else if (msg.includes("404") || msg.includes("not_found")) {
        // Fallback test
        if (model !== FALLBACK_GEMINI_MODEL) {
          try {
            const aiFallback = new GoogleGenAI({ apiKey: apiKey.trim() });
            const fbRes = await Promise.race([
              aiFallback.models.generateContent({
                model: FALLBACK_GEMINI_MODEL,
                contents: "Respond with the single word: OK"
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 6000))
            ]);
            if (fbRes && fbRes.text) {
              return {
                ok: true,
                provider: "gemini",
                model: FALLBACK_GEMINI_MODEL,
                configured: true,
                available: true,
                fallback: true
              };
            }
          } catch (fbErr) {
            // keep primary model error
          }
        }
        error = "GEMINI_MODEL_NOT_FOUND";
        userMessage = `Configured Gemini model '${model}' was not found.`;
      } else if (msg.includes("429") || msg.includes("resource_exhausted") || msg.includes("quota")) {
        error = "GEMINI_QUOTA_EXCEEDED";
        userMessage = "Gemini quota or rate limit exceeded.";
      } else if (msg.includes("timeout")) {
        error = "GEMINI_TIMEOUT";
        userMessage = "Gemini health check timed out.";
      }

      return {
        ok: false,
        provider: "gemini",
        model,
        configured: true,
        available: false,
        error,
        message: userMessage
      };
    }
  }

  // ==========================================
  // 3. UNSUPPORTED PROVIDER
  // ==========================================
  return {
    ok: false,
    provider: config.provider,
    model: config.model || "unknown",
    configured: false,
    available: false,
    error: "UNSUPPORTED_PROVIDER",
    message: `Unsupported AI_PROVIDER '${config.provider}'. Allowed values are 'ollama' or 'gemini'.`
  };
}

/**
 * Generates an AI completion using the configured provider.
 * Strict timeout and error handling; never crashes the application.
 * Never fabricates responses.
 *
 * @param {string} prompt Text prompt to generate from
 * @param {Object} [options] Optional parameters (timeoutMs, overrideConfig, systemPrompt, temperature)
 * @returns {Promise<Object>} Structured completion result or structured error
 */
async function generateAiCompletion(prompt, options = {}) {
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return {
      ok: false,
      provider: getAiConfig().provider,
      model: getAiConfig().model,
      error: "EMPTY_PROMPT"
    };
  }

  const config = { ...getAiConfig(), ...(options.overrideConfig || {}) };
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  // ==========================================
  // 1. OLLAMA COMPLETION
  // ==========================================
  if (config.provider === "ollama") {
    const baseUrl = config.baseUrl || DEFAULT_OLLAMA_BASE_URL;
    const generateUrl = `${baseUrl}/api/generate`;
    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt.trim()}`
      : prompt.trim();

    const requestBody = {
      model: config.model || DEFAULT_OLLAMA_MODEL,
      prompt: fullPrompt,
      stream: false,
      think: options.think !== undefined ? options.think : false
    };

    try {
      const res = await fetch(generateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) {
        return {
          ok: false,
          provider: "ollama",
          model: config.model,
          error: `OLLAMA_HTTP_${res.status}`
        };
      }

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        return {
          ok: false,
          provider: "ollama",
          model: config.model,
          error: "OLLAMA_INVALID_JSON"
        };
      }

      const text = typeof data?.response === "string" ? data.response.trim() : "";
      if (!text && !data?.thinking) {
        return {
          ok: false,
          provider: "ollama",
          model: config.model,
          error: "OLLAMA_EMPTY_RESPONSE"
        };
      }

      return {
        ok: true,
        provider: "ollama",
        model: config.model,
        response: text || (typeof data.thinking === "string" ? data.thinking.trim() : "")
      };
    } catch (err) {
      const isRefused = err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED") || err.message?.includes("connect");
      const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");

      return {
        ok: false,
        provider: "ollama",
        model: config.model,
        error: isRefused ? "OLLAMA_UNAVAILABLE" : (isTimeout ? "OLLAMA_TIMEOUT" : "OLLAMA_REQUEST_FAILED")
      };
    }
  }

  // ==========================================
  // 2. GEMINI COMPLETION
  // ==========================================
  if (config.provider === "gemini") {
    const apiKey = typeof config.apiKey === "string" ? config.apiKey : (process.env.GEMINI_API_KEY || "");
    const envModel = process.env.GEMINI_MODEL;
    const model = (config.model && config.model.toLowerCase().startsWith("gemini") && config.model !== "gemini-3.5-flash")
      ? config.model
      : ((envModel && envModel !== "gemini-3.5-flash") ? envModel : DEFAULT_GEMINI_MODEL);

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 6) {
      return {
        ok: false,
        provider: "gemini",
        model,
        error: "GEMINI_NOT_CONFIGURED",
        message: "GEMINI_API_KEY is not configured in the environment."
      };
    }

    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt.trim()}`
      : prompt.trim();

    const generateReq = {
      model,
      contents: fullPrompt
    };
    if (options.temperature !== undefined) {
      generateReq.config = { temperature: options.temperature };
    }

    try {
      const res = await Promise.race([
        ai.models.generateContent(generateReq),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini generation timed out")), timeoutMs))
      ]);

      const text = typeof res?.text === "string" ? res.text.trim() : "";
      if (!text) {
        return {
          ok: false,
          provider: "gemini",
          model,
          error: "GEMINI_EMPTY_RESPONSE",
          message: "Gemini returned an empty response."
        };
      }

      return {
        ok: true,
        provider: "gemini",
        model,
        response: text
      };
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      let error = "GEMINI_ERROR";
      let userMessage = "Gemini generation failed.";

      if (msg.includes("401") || msg.includes("unauthenticated") || msg.includes("api key not valid") || msg.includes("access_token_type_unsupported")) {
        error = "GEMINI_AUTH_FAILED";
        userMessage = "Invalid or unsupported GEMINI_API_KEY.";
      } else if (msg.includes("403") || msg.includes("permission_denied")) {
        error = "GEMINI_PERMISSION_DENIED";
        userMessage = "Gemini API key lacks required permissions.";
      } else if (msg.includes("404") || msg.includes("not_found")) {
        error = "GEMINI_MODEL_NOT_FOUND";
        userMessage = `Configured Gemini model '${model}' was not found.`;
      } else if (msg.includes("429") || msg.includes("resource_exhausted") || msg.includes("quota")) {
        error = "GEMINI_QUOTA_EXCEEDED";
        userMessage = "Gemini quota or rate limit exceeded.";
      } else if (msg.includes("timeout")) {
        error = "GEMINI_TIMEOUT";
        userMessage = "Gemini generation request timed out.";
      }

      return {
        ok: false,
        provider: "gemini",
        model,
        error,
        message: userMessage
      };
    }
  }

  // ==========================================
  // 3. UNSUPPORTED PROVIDER
  // ==========================================
  return {
    ok: false,
    provider: config.provider,
    model: config.model || "unknown",
    error: "UNSUPPORTED_PROVIDER",
    message: `Unsupported AI_PROVIDER '${config.provider}'. Allowed values are 'ollama' or 'gemini'.`
  };
}

module.exports = {
  getAiConfig,
  checkAiHealth,
  generateAiCompletion,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODEL
};
