/**
 * VeriWrite Resilient Analysis Service
 * Implements decoupled, independent analysis stages with partial-success tolerance.
 *
 * STAGES:
 * 1. Document Preprocessing (Fails ONLY if text is empty/unreadable)
 * 2. Local Similarity Engine (Always executes)
 * 3. Web Search & Grounding (Graceful degradation if unconfigured/failing)
 * 4. Safe Source Retrieval (Per-source error isolation)
 * 5. Multi-Level Evidence Comparison (Exact, Near, Semantic)
 * 6. Gemini Evidence Review (Graceful fallback if unconfigured)
 * 7. Transparent Scoring & Session Report Preparation
 */

const db = require("../db/database");
const logger = require("../utils/logger");
const { preprocessDocument } = require("../document/preprocessor");
const { findExactMatches } = require("../analysis/exactMatcher");
const { findNearMatches } = require("../analysis/nearMatcher");
const { findSemanticMatches } = require("../analysis/semanticMatcher");
const { calculateDocumentScore } = require("../analysis/scoring");
const { discoverCandidateSources } = require("../providers/searchProvider");
const { retrieveMultipleSources } = require("../providers/pageRetriever");
const { classifySource } = require("../providers/sourceClassifier");
const { reviewEvidenceWithAI } = require("../providers/aiReviewProvider");

async function executeAnalysis({
  text,
  title = "Untitled Document",
  filename = "document.txt",
  fileStats = {},
  options = {},
  onProgress = () => {}
}) {
  const analysisId = db.generateAnalysisId();
  logger.logEvent("analysis_started", { analysisId, title, wordCount: fileStats.wordCount });

  const stageStatuses = {
    documentProcessing: "pending",
    localSimilarity: "pending",
    webSearch: "pending",
    sourceRetrieval: "pending",
    geminiReview: "pending"
  };

  // STAGE 1 — Document Processing (Only critical stage that can fail)
  onProgress({ step: 1, label: "Step 1 — Reading and validating document", percent: 10 });
  const rawDocument = text || "";
  if (!rawDocument.trim() || rawDocument.trim().length < 20) {
    throw new Error("Document contains insufficient text for analysis (minimum 20 characters required).");
  }

  onProgress({ step: 2, label: "Step 2 — Normalizing and splitting into passages", percent: 20 });
  let processed;
  try {
    processed = preprocessDocument(rawDocument, options);
    stageStatuses.documentProcessing = "success";
  } catch (err) {
    logger.error("Document preprocessing failed", { error: err.message });
    throw new Error(`Document preprocessing failed: ${err.message}`);
  }

  // STAGE 2 & 3 — Web Search & Candidate Discovery
  onProgress({ step: 3, label: "Step 3 — Generating distinctive search queries", percent: 30 });
  onProgress({ step: 4, label: "Step 4 — Searching web & discover candidate sources", percent: 40 });
  
  let discovery = {
    mode: "LOCAL_COMPARISON",
    modeLabel: "Local Comparison (Web search not configured)",
    message: "Web search is not configured.",
    queries: [],
    sources: []
  };

  try {
    discovery = await discoverCandidateSources(rawDocument, processed.eligibleSentences, options);
    stageStatuses.webSearch = discovery.mode === "LOCAL_COMPARISON" ? "local_fallback" : "success";
  } catch (err) {
    logger.warn("Web search discovery encountered error", { error: err.message });
    stageStatuses.webSearch = "failed";
    discovery.message = `Web search encountered an error: ${err.message}. Running local comparison.`;
  }

  // STAGE 4 — Safe Source Retrieval (Per-source isolation)
  onProgress({ step: 5, label: "Step 5 — Retrieving candidate sources safely", percent: 50 });
  let retrievedSources = [];
  try {
    if (discovery.sources.some(s => s.isLocal)) {
      retrievedSources = discovery.sources.map(s => ({ ...s, status: "VERIFIED" }));
      stageStatuses.sourceRetrieval = "local";
    } else if (discovery.sources.length > 0) {
      retrievedSources = await retrieveMultipleSources(discovery.sources, 4);
      stageStatuses.sourceRetrieval = "success";
    } else {
      stageStatuses.sourceRetrieval = "no_sources";
    }
  } catch (err) {
    logger.warn("Source retrieval batch error", { error: err.message });
    stageStatuses.sourceRetrieval = "failed";
  }

  // STAGE 5 — Multi-Level Evidence Comparison (Exact + Near + Semantic)
  onProgress({ step: 6, label: "Step 6 — Comparing exact and near-match evidence", percent: 65 });
  const sourceEvidences = [];
  const allMatchedPassages = [];

  for (const src of retrievedSources) {
    if (!src.text || src.status === "INACCESSIBLE") {
      continue;
    }

    const srcClassification = classifySource(src.url);

    // Level 1: Exact matches
    let exactResult = { matches: [], exactOverlapPercent: 0 };
    try {
      exactResult = findExactMatches(processed.tokens, src.text, options.minMatchLength || 6);
    } catch (e) {
      logger.warn("Exact match error", { url: src.url, error: e.message });
    }

    // Level 2: Near matches
    let nearResult = [];
    try {
      const srcSentences = (src.text.match(/[^.!?\r\n]+[.!?]?/g) || [])
        .map(s => s.trim())
        .filter(s => s.length >= 20 && s.length <= 450);
      nearResult = findNearMatches(processed.eligibleSentences, srcSentences, 0.45);
    } catch (e) {
      logger.warn("Near match error", { url: src.url, error: e.message });
    }

    const exactWeight = exactResult.exactOverlapPercent || 0;
    const avgNearScore = nearResult.length > 0 
      ? Math.round(nearResult.reduce((sum, n) => sum + (n.similarityScore || 50), 0) / nearResult.length) 
      : 0;
    const sourceSim = Math.min(100, Math.max(exactWeight, Math.round((exactWeight * 0.6) + (avgNearScore * 0.4))));

    if (sourceSim > 0 || exactResult.matches.length > 0 || nearResult.length > 0) {
      sourceEvidences.push({
        title: src.title,
        url: src.url,
        snippet: src.snippet,
        status: src.status || "VERIFIED",
        similarity: sourceSim,
        sourceType: srcClassification.type,
        exactMatches: exactResult.matches,
        nearMatches: nearResult,
        semanticMatches: []
      });

      exactResult.matches.forEach(em => {
        allMatchedPassages.push({
          id: `p_${allMatchedPassages.length + 1}`,
          type: "EXACT",
          color: "RED",
          category: "High-confidence exact match",
          phrase: em.phrase,
          submittedSentence: em.phrase,
          sourceSentence: em.phrase,
          sourceTitle: src.title,
          sourceUrl: src.url,
          similarityScore: 100,
          matchedWords: em.length,
          status: src.status || "VERIFIED",
          confidence: em.confidence || "HIGH"
        });
      });

      nearResult.forEach(nm => {
        allMatchedPassages.push({
          id: `p_${allMatchedPassages.length + 1}`,
          type: "NEAR",
          color: "ORANGE",
          category: "Near match (modified wording)",
          submittedSentence: nm.submittedSentence,
          sourceSentence: nm.sourceSentence,
          sourceTitle: src.title,
          sourceUrl: src.url,
          similarityScore: nm.similarityScore || 70,
          matchedWords: (nm.submittedSentence || "").split(/\s+/).length,
          status: src.status || "VERIFIED",
          confidence: nm.confidence || "MEDIUM"
        });
      });
    }
  }

  // Level 3: Semantic comparison with conservative 4-tier thresholds
  onProgress({ step: 7, label: "Step 7 — Evaluating semantic sentence similarity", percent: 75 });
  const topicalSources = [];
  const possibleSources = [];

  for (const src of retrievedSources) {
    if (src.text && src.status === "VERIFIED") {
      try {
        const srcSentences = (src.text.match(/[^.!?\r\n]+[.!?]?/g) || []).map(s => s.trim()).filter(s => s.length >= 20 && s.length <= 450);
        const semResult = await findSemanticMatches(processed.eligibleSentences.slice(0, 40), srcSentences.slice(0, 60), {
          embeddingApiUrl: options.embeddingApiUrl,
          embeddingApiKey: options.embeddingApiKey,
          threshold: 35 // Threshold for candidate semantic evaluation
        });

        if (semResult.matches && semResult.matches.length > 0) {
          const highConfidenceMatches = semResult.matches.filter(m => m.tier === "HIGH_CONFIDENCE_MATCH" && m.isPlagiarismEvidence === true);
          const possibleMatches = semResult.matches.filter(m => m.tier === "POSSIBLE_MATCH");
          const lowConfidenceMatches = semResult.matches.filter(m => m.tier === "LOW_CONFIDENCE");

          // High Confidence Semantic Match (>= 45% with distinctive multi-token evidence)
          if (highConfidenceMatches.length > 0) {
            let existingEvidence = sourceEvidences.find(s => s.url === src.url);
            if (!existingEvidence) {
              existingEvidence = {
                title: src.title,
                url: src.url,
                snippet: src.snippet,
                status: src.status || "VERIFIED",
                similarity: 0,
                sourceType: classifySource(src.url).type,
                exactMatches: [],
                nearMatches: [],
                semanticMatches: []
              };
              sourceEvidences.push(existingEvidence);
            }
            existingEvidence.semanticMatches = highConfidenceMatches;
            existingEvidence.similarity = Math.max(existingEvidence.similarity, highConfidenceMatches[0].similarityScore);

            highConfidenceMatches.forEach(sm => {
              allMatchedPassages.push({
                id: `p_${allMatchedPassages.length + 1}`,
                type: "SEMANTIC",
                color: "PURPLE",
                category: "High-confidence semantic match",
                submittedSentence: sm.submittedSentence,
                sourceSentence: sm.sourceSentence,
                sourceTitle: src.title,
                sourceUrl: src.url,
                similarityScore: sm.similarityScore || 85,
                matchedWords: (sm.submittedSentence || "").split(/\s+/).length,
                status: src.status,
                confidence: "HIGH",
                tier: sm.tier,
                isPlagiarismEvidence: true
              });
            });
          } else if (possibleMatches.length > 0) {
            // Possible Semantic Similarity (75-84%) — Informational / Possible, not auto-verified match
            if (!sourceEvidences.some(s => s.url === src.url) && !possibleSources.some(s => s.url === src.url)) {
              possibleSources.push({
                title: src.title,
                url: src.url,
                snippet: src.snippet,
                status: src.status || "VERIFIED",
                classification: "Possible Semantic Similarity",
                similarity: possibleMatches[0].similarityScore,
                reason: possibleMatches[0].description
              });
            }
            possibleMatches.forEach(pm => {
              allMatchedPassages.push({
                id: `p_${allMatchedPassages.length + 1}`,
                type: "POSSIBLE",
                color: "AMBER",
                category: "Possible semantic similarity",
                submittedSentence: pm.submittedSentence,
                sourceSentence: pm.sourceSentence,
                sourceTitle: src.title,
                sourceUrl: src.url,
                similarityScore: pm.similarityScore,
                matchedWords: (pm.submittedSentence || "").split(/\s+/).length,
                status: src.status,
                confidence: "POSSIBLE",
                tier: pm.tier,
                isPlagiarismEvidence: false
              });
            });
          } else if (lowConfidenceMatches.length > 0) {
            // Low Confidence / Informational (65-74%)
            if (!sourceEvidences.some(s => s.url === src.url) && !possibleSources.some(s => s.url === src.url) && !topicalSources.some(s => s.url === src.url)) {
              topicalSources.push({
                title: src.title,
                url: src.url,
                snippet: src.snippet,
                status: src.status || "VERIFIED",
                classification: "Low Confidence / Informational",
                similarity: lowConfidenceMatches[0].similarityScore,
                reason: lowConfidenceMatches[0].description
              });
            }
          }
        }
      } catch (err) {
        logger.warn("Semantic matching error for source", { url: src.url, error: err.message });
      }
    }
  }

  // Populate topical sources for retrieved candidate pages that do not have derivation matches
  for (const src of retrievedSources) {
    if (src.text && src.status === "VERIFIED") {
      const isVerified = sourceEvidences.some(s => s.url === src.url);
      const isPossible = possibleSources.some(s => s.url === src.url);
      const isTopical = topicalSources.some(s => s.url === src.url);
      if (!isVerified && !isPossible && !isTopical) {
        topicalSources.push({
          title: src.title,
          url: src.url,
          snippet: src.snippet,
          status: src.status || "VERIFIED",
          classification: "Topically Related / No Derivation Evidence",
          similarity: 0,
          reason: "Topically related web source retrieved for query, but contains no textual derivation or paraphrasing evidence."
        });
      }
    }
  }

  stageStatuses.localSimilarity = "success";

  // STAGE 6 — Gemini AI Evidence Review
  onProgress({ step: 8, label: "Step 8 — Gemini AI reviewing evidence", percent: 85 });
  let aiReview = {
    status: "NOT_CONFIGURED",
    state: "AI_REVIEW_NOT_CONFIGURED",
    available: false,
    retryable: false,
    message: "Gemini review unavailable — configure GEMINI_API_KEY in environment.",
    items: []
  };
  const passagesForAiReview = allMatchedPassages.filter(p => p.type === "EXACT" || p.type === "NEAR" || p.type === "SEMANTIC" || p.type === "POSSIBLE");
  try {
    if (passagesForAiReview.length > 0) {
      aiReview = await reviewEvidenceWithAI(passagesForAiReview.slice(0, 10));
      stageStatuses.geminiReview = (aiReview.status === "SUCCESS" || aiReview.status === "completed") ? "success" : "limited";
    } else {
      aiReview = {
        status: "SUCCESS",
        state: "COMPLETED",
        available: true,
        retryable: false,
        message: "No candidate matching passages detected to review. Content appears independently written.",
        items: []
      };
      stageStatuses.geminiReview = "not_needed";
    }
  } catch (err) {
    logger.warn("Gemini evidence review failed", { error: err.message });
    aiReview = {
      status: "UNAVAILABLE",
      state: "AI_REVIEW_UNAVAILABLE",
      available: false,
      retryable: true,
      message: "Gemini is currently experiencing high demand. Your similarity analysis and web-source matching are still available.",
      items: []
    };
    stageStatuses.geminiReview = "limited";
  }

  // STAGE 7 — Scoring & Status Determination
  onProgress({ step: 9, label: "Step 9 — Calculating transparent score", percent: 92 });
  const verifiedMatchingSources = sourceEvidences.filter(s =>
    (s.exactMatches?.length || 0) > 0 ||
    (s.nearMatches?.length || 0) > 0 ||
    (s.semanticMatches?.length || 0) > 0
  );
  const scoreResult = calculateDocumentScore(processed.tokens, verifiedMatchingSources);
  verifiedMatchingSources.sort((a, b) => b.similarity - a.similarity);

  const highRiskCount = allMatchedPassages.filter(p => p.type === "EXACT" || (p.similarityScore || 0) >= 85).length;

  // Determine overall status — Gemini failure must NEVER mark the analysis as failed
  const isLimited = (stageStatuses.webSearch !== "success" && stageStatuses.webSearch !== "local_fallback");
  const overallStatus = isLimited ? "completed_with_limitations" : "completed";
  const statusMessage = discovery.mode === "LOCAL_COMPARISON"
    ? (discovery.message || "Local comparison completed. Web checking is unavailable.")
    : isLimited
      ? "Analysis completed with limited services."
      : (discovery.message || "Complete analysis finished successfully.");

  const matchingSourcesCount = verifiedMatchingSources.length;

  const analysisRecord = {
    id: analysisId,
    status: overallStatus,
    statusMessage,
    webCheckMode: discovery.modeLabel || discovery.mode,
    stageStatuses,
    createdAt: new Date().toISOString(),
    document: {
      title,
      filename: filename || "document.txt",
      wordCount: fileStats.wordCount || processed.tokens.length,
      characterCount: fileStats.characterCount || rawDocument.length,
      pageCount: fileStats.pageCount || Math.max(1, Math.ceil(processed.tokens.length / 450)),
      estimatedReadingTime: fileStats.estimatedReadingTime || "1 min"
    },
    similarity: {
      score: scoreResult.score,
      grade: scoreResult.grade,
      gradeLabel: scoreResult.gradeLabel,
      coverage: {
        exactPercent: scoreResult.coverage?.exactPercent ?? 0,
        nearPercent: scoreResult.coverage?.nearPercent ?? 0,
        semanticPercent: scoreResult.coverage?.semanticPercent ?? 0
      },
      relevantMatches: matchingSourcesCount,
      highRisk: highRiskCount,
      methodology: scoreResult.methodology
    },
    sources: {
      mode: discovery.mode,
      modeLabel: discovery.modeLabel || discovery.mode,
      retrievedCount: retrievedSources.length,
      topicalCount: topicalSources.length,
      possibleCount: possibleSources.length,
      matchingCount: matchingSourcesCount,
      reviewed: retrievedSources.length,
      groundingStatus: discovery.groundingStatus || "NOT_TESTED",
      groundingError: discovery.groundingError || null,
      topicalSources,
      possibleSources,
      items: verifiedMatchingSources
    },
    matchedPassages: allMatchedPassages,
    aiReview,
    settings: {
      searchMode: discovery.mode,
      minMatchLength: options.minMatchLength || 6,
      ignoreQuotations: Boolean(options.ignoreQuotations),
      ignoreBibliography: Boolean(options.ignoreBibliography ?? true),
      ignoreCitations: Boolean(options.ignoreCitations ?? true)
    }
  };

  onProgress({ step: 10, label: "Step 10 — Report ready", percent: 100 });

  // Store in ephemeral session cache only (no permanent history)
  db.setSessionAnalysis(analysisRecord);

  logger.logEvent("analysis_completed", {
    analysisId,
    score: scoreResult.score,
    grade: scoreResult.grade,
    status: overallStatus
  });

  return analysisRecord;
}

module.exports = {
  executeAnalysis
};
