/**
 * Checkra Embedding Provider Abstraction
 * Supports:
 * 1. LocalTransformersProvider (@xenova/transformers Xenova/all-MiniLM-L6-v2)
 * 2. RemoteEmbeddingProvider (OpenAI-compatible embedding endpoint)
 * 3. LocalFastEmbeddingProvider (Deterministic mathematical fallback for offline/low-memory environments)
 *
 * CRITICAL RULE:
 * Cosine similarity remains RAW. Zero artificial scaling curves or Math.pow inflation.
 */

const path = require("path");
const logger = require("../utils/logger");

let transformersPipelinePromise = null;

/**
 * Initializes and caches the Transformers.js feature-extraction pipeline
 */
async function getTransformersPipeline() {
  if (transformersPipelinePromise) {
    return transformersPipelinePromise;
  }

  transformersPipelinePromise = (async () => {
    try {
      const { pipeline, env } = require("@xenova/transformers");
      if (process.env.VERCEL) {
        env.cacheDir = path.join("/tmp", "transformers_cache");
      }
      env.allowLocalModels = false;
      env.useBrowserCache = false;

      const modelName = process.env.TRANSFORMERS_MODEL || "Xenova/all-MiniLM-L6-v2";
      logger.logEvent("embedding_model_loading", { model: modelName });
      const extractor = await pipeline("feature-extraction", modelName, { quantized: true });
      logger.logEvent("embedding_model_ready", { model: modelName });
      return extractor;
    } catch (err) {
      logger.warn("Transformers.js pipeline initialization failed, falling back to local vectorizer", { error: err.message });
      transformersPipelinePromise = null;
      throw err;
    }
  })();

  return transformersPipelinePromise;
}

/**
 * Computes standard mathematical cosine similarity between two numeric vectors.
 * Returns raw float in range [-1.0, 1.0].
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < len; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(-1, Math.min(1, sim));
}

/**
 * Deterministic mathematical fallback vectorizer for zero-dependency or constrained environments
 */
function fallbackEmbedTexts(texts) {
  const { stemWord, STOPWORDS, GENERIC_TERMS } = require("./vocabularyClassifier");
  const vocab = new Map();
  const tokenizedList = texts.map(t => {
    const words = (t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 0);
    const features = [];
    words.forEach((w, idx) => {
      const isStop = STOPWORDS.has(w);
      const isGeneric = GENERIC_TERMS.has(w);
      const stem = stemWord(w);
      const weight = isStop ? 0.1 : (isGeneric ? 0.8 : 2.5);
      features.push({ key: `w_${w}`, weight });
      features.push({ key: `s_${stem}`, weight: weight * 1.2 });
      if (idx < words.length - 1) {
        const next = words[idx + 1];
        if (!STOPWORDS.has(next)) {
          features.push({ key: `bi_${stem}_${stemWord(next)}`, weight: 3.0 });
        }
      }
    });
    features.forEach(f => {
      if (!vocab.has(f.key)) vocab.set(f.key, vocab.size);
    });
    return features;
  });

  const dim = vocab.size || 1;
  return tokenizedList.map(features => {
    const vec = new Float32Array(dim);
    features.forEach(f => {
      const idx = vocab.get(f.key);
      if (idx !== undefined) vec[idx] += f.weight;
    });
    let sumSq = 0;
    for (let i = 0; i < dim; i++) sumSq += vec[i] * vec[i];
    const mag = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= mag;
    return Array.from(vec);
  });
}

/**
 * Generates embeddings for an array of text passages using the active provider
 */
async function embedTexts(texts, options = {}) {
  if (!texts || texts.length === 0) return { embeddings: [], provider: "none" };

  const apiUrl = options.embeddingApiUrl || process.env.EMBEDDING_API_URL;
  const apiKey = options.embeddingApiKey || process.env.EMBEDDING_API_KEY;
  const model = options.embeddingModel || process.env.EMBEDDING_MODEL;

  // 1. External remote embedding API if configured
  if (apiUrl) {
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": apiKey ? `Bearer ${apiKey}` : undefined
        },
        body: JSON.stringify({ input: texts, model: model || "text-embedding-3-small" }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const data = await res.json();
        const embeddings = (data.data || []).map(item => item.embedding);
        if (embeddings.length === texts.length) {
          return { embeddings, provider: "remote-api" };
        }
      }
    } catch (e) {
      logger.warn("Remote embedding API failed, falling back to local", { error: e.message });
    }
  }

  // 2. Transformers.js with Xenova/all-MiniLM-L6-v2 (quantized)
  if (process.env.DISABLE_TRANSFORMERS !== "true") {
    try {
      const extractor = await getTransformersPipeline();
      const embeddings = [];
      for (const text of texts) {
        const output = await extractor(text, { pooling: "mean", normalize: true });
        embeddings.push(Array.from(output.data));
      }
      return { embeddings, provider: "xenova-minilm" };
    } catch (err) {
      logger.warn("Local Transformers.js failed, falling back to mathematical vectorizer", { error: err.message });
    }
  }

  // 3. High-dimensional mathematical vectorizer fallback
  const embeddings = fallbackEmbedTexts(texts);
  return { embeddings, provider: "deterministic-vectorizer" };
}

module.exports = {
  embedTexts,
  cosineSimilarity,
  getTransformersPipeline
};
