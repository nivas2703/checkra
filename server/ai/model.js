/**
 * Checkra AI Provider Abstraction
 * Local & Provider-Agnostic AI Service Interface
 *
 * Architecture:
 * - Local Provider: Ollama HTTP API (http://localhost:11434) running qwen3:1.7b
 * - Provider-Agnostic: Future remote providers plug in through this interface
 * - Isolation: Decoupled from deterministic similarity, scoring, and document extraction
 *
 * Security:
 * - Server strictly controls baseUrl and model name via environment variables
 * - No arbitrary client-supplied URLs or models
 * - Never executes shell commands
 */

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3:1.7b";
const DEFAULT_TIMEOUT_MS = 60000; // 60s timeout for local CPU generation

function getAiConfig() {
  const provider = (process.env.AI_PROVIDER || "ollama").toLowerCase().trim();
  const baseUrl = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  return { provider, baseUrl, model };
}

/**
 * Checks connectivity and model availability for the configured AI provider.
 * Does NOT start Ollama or download models automatically.
 *
 * @param {Object} [overrideConfig] Optional config override (for testing)
 * @returns {Promise<Object>} Structured health status
 */
async function checkAiHealth(overrideConfig = {}) {
  const config = { ...getAiConfig(), ...overrideConfig };

  if (config.provider === "ollama") {
    try {
      const tagsUrl = `${config.baseUrl}/api/tags`;
      const res = await fetch(tagsUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        return {
          ok: false,
          provider: config.provider,
          model: config.model,
          configured: true,
          available: false,
          error: `OLLAMA_HTTP_${res.status}`
        };
      }

      const data = await res.json();
      const models = Array.isArray(data?.models) ? data.models : [];
      
      // Match model name exactly or with tag prefix (e.g. "qwen3:1.7b" or "qwen3:1.7b-latest")
      const targetModel = config.model.toLowerCase();
      const modelFound = models.some(m => {
        const name = (m.name || m.model || "").toLowerCase();
        return name === targetModel || name.startsWith(`${targetModel}:`) || targetModel.startsWith(`${name}:`);
      });

      if (!modelFound) {
        return {
          ok: false,
          provider: config.provider,
          model: config.model,
          configured: true,
          available: false,
          error: "MODEL_NOT_FOUND",
          installedModels: models.map(m => m.name || m.model)
        };
      }

      return {
        ok: true,
        provider: config.provider,
        model: config.model,
        configured: true,
        available: true
      };
    } catch (err) {
      const isRefused = err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED");
      const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");

      return {
        ok: false,
        provider: config.provider,
        model: config.model,
        configured: true,
        available: false,
        error: isRefused ? "OLLAMA_UNAVAILABLE" : (isTimeout ? "OLLAMA_TIMEOUT" : "OLLAMA_ERROR")
      };
    }
  }

  return {
    ok: false,
    provider: config.provider,
    model: config.model,
    configured: false,
    available: false,
    error: "UNSUPPORTED_PROVIDER"
  };
}

/**
 * Generates an AI completion using the configured provider.
 * Strict timeout and error handling; never crashes the application.
 *
 * @param {string} prompt Text prompt to generate from
 * @param {Object} [options] Optional parameters (timeoutMs, overrideConfig)
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

  if (config.provider === "ollama") {
    const generateUrl = `${config.baseUrl}/api/generate`;
    const requestBody = {
      model: config.model,
      prompt: prompt.trim(),
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
          provider: config.provider,
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
          provider: config.provider,
          model: config.model,
          error: "OLLAMA_INVALID_JSON"
        };
      }

      // Ollama returns { response: "...", done: true, thinking: "..." }
      const text = typeof data?.response === "string" ? data.response.trim() : "";
      if (!text && !data?.thinking) {
        return {
          ok: false,
          provider: config.provider,
          model: config.model,
          error: "OLLAMA_EMPTY_RESPONSE"
        };
      }

      return {
        ok: true,
        provider: config.provider,
        model: config.model,
        response: text || (typeof data.thinking === "string" ? data.thinking.trim() : "")
      };
    } catch (err) {
      const isRefused = err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED");
      const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");

      return {
        ok: false,
        provider: config.provider,
        model: config.model,
        error: isRefused ? "OLLAMA_UNAVAILABLE" : (isTimeout ? "OLLAMA_TIMEOUT" : "OLLAMA_REQUEST_FAILED")
      };
    }
  }

  return {
    ok: false,
    provider: config.provider,
    model: config.model,
    error: "UNSUPPORTED_PROVIDER"
  };
}

module.exports = {
  getAiConfig,
  checkAiHealth,
  generateAiCompletion
};
