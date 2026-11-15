/**
 * VeriWrite AI Writing Signal Provider
 * Evaluates probabilistic signals of automated text generation.
 * Strict compliance: Never claims proof of authorship; displays mandatory disclaimer.
 */

const DISCLAIMER = "AI-writing detection is probabilistic and should not be used as proof of authorship.";

async function evaluateAIWritingSignal(text, options = {}) {
  const apiUrl = options.llmApiUrl || process.env.LLM_API_URL;
  const apiKey = options.llmApiKey || process.env.LLM_API_KEY;
  const model = options.llmModel || process.env.LLM_MODEL;

  if (!apiUrl) {
    return {
      status: "UNAVAILABLE",
      signal: "AI-writing signal unavailable",
      available: false,
      message: "AI-writing signal unavailable — configure an AI provider.",
      disclaimer: DISCLAIMER
    };
  }

  // If provider is configured, evaluate linguistic burstiness and entropy via LLM prompt
  const prompt = `Analyze the following text for structural uniformity, sentence burstiness, and stylistic patterns commonly found in large language model outputs versus human academic writing.
Return JSON with:
- "signal": "LOW" | "MODERATE" | "ELEVATED"
- "confidence": "LOW" | "MEDIUM"
- "reasoning": "A concise explanation of observed sentence length variance, lexical diversity, and transition uniformity."
- "note": "Probabilistic assessment only."`;

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey ? `Bearer ${apiKey}` : undefined
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: text.slice(0, 8000) }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = JSON.parse(data.choices?.[0]?.message?.content || "{}");

    return {
      status: "COMPLETED",
      available: true,
      signal: `AI-writing signal: ${result.signal || "MODERATE"}`,
      signalLevel: result.signal || "MODERATE",
      reasoning: result.reasoning || "Evaluation of stylistic uniformity and sentence length variance.",
      disclaimer: DISCLAIMER
    };
  } catch (err) {
    return {
      status: "ERROR",
      available: false,
      signal: "AI-writing signal unavailable",
      message: `Detector error: ${err.message}`,
      disclaimer: DISCLAIMER
    };
  }
}

module.exports = {
  evaluateAIWritingSignal,
  DISCLAIMER
};
