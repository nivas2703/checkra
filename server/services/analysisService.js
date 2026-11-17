/**
 * Checkra Resilient Analysis Service
 * Implements decoupled, independent analysis stages with partial-success tolerance.
 *
 * STAGES:
 * 1. Document Preprocessing & Normalization
 * 2. Multi-Tier Search Discovery (SearXNG / Configured API / Wikipedia Fallback / Local Corpus)
 * 3. Safe Source Retrieval (Per-source isolation; unreachable pages marked SOURCE_NOT_VERIFIABLE)
 * 4. Multi-Level Evidence Comparison:
 *    - Level 1: Multi-scale Exact Match (5, 7, 9, 12, 15 n-grams with lexical specificity)
 *    - Level 2: Near / Lexical Match (stemming, Jaccard, containment, distinctive vocabulary)
 *    - Level 3: Semantic Embeddings (Transformers.js Xenova/all-MiniLM-L6-v2 + Multi-Signal Verification)
 * 5. Deterministic Non-Overlapping Scoring (Word coverage, zero artificial inflation)
 * 6. Optional Gemini AI Evidence Review (isolated, never affects score)
 * 7. Transparent Reporting & Ephemeral Session Caching
 */

const db = require("../db/database");
const logger = require("../utils/logger");
const { preprocessDocument } = require("../document/preprocessor");
const { findExactMatches } = require("../analysis/exactMatcher");
const { findNearMatches } = require("../analysis/nearMatcher");
const { findSemanticMatches } = require("../analysis/semanticMatcher");
const { calculateDocumentScore } = require("../analysis/scoring");
const { discoverCandidateSources, getLocalReferenceSources } = require("../providers/searchProvider");
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
  const tTotalStart = Date.now();
  let tExtraction = 0;
  let tPreprocess = 0;
  let tSearch = 0;
  let tSourceRetrieval = 0;
  let tExact = 0;
  let tNear = 0;
  let tSemantic = 0;
  let tScoring = 0;
  let tGemini = 0;
  let tReport = 0;

  const analysisId = db.generateAnalysisId();
  logger.logEvent("analysis_started", { analysisId, title, wordCount: fileStats.wordCount });

  const stageStatuses = {
    documentProcessing: "pending",
    localSimilarity: "pending",
    webSearch: "pending",
    sourceRetrieval: "pending",
    geminiReview: "pending"
  };

  // STAGE 1 — Document Processing
  onProgress({ step: 1, label: "Step 1 — Reading and validating document", percent: 10 });
  const rawDocument = text || "";
  if (!rawDocument.trim() || rawDocument.trim().length < 20) {
    throw new Error("Document contains insufficient text for analysis (minimum 20 characters required).");
  }

  onProgress({ step: 2, label: "Step 2 — Normalizing and splitting into passages", percent: 20 });
  let processed;
  const tP0 = Date.now();
  try {
    processed = preprocessDocument(rawDocument, options);
    stageStatuses.documentProcessing = "success";
  } catch (err) {
    logger.error("Document preprocessing failed", { error: err.message });
    throw new Error(`Document preprocessing failed: ${err.message}`);
  }
  tPreprocess = Date.now() - tP0;

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

  const tS0 = Date.now();
  try {
    discovery = await discoverCandidateSources(rawDocument, processed.eligibleSentences, options);
    stageStatuses.webSearch = discovery.mode === "LOCAL_COMPARISON" ? "local_fallback" : "success";
  } catch (err) {
    logger.warn("Web search discovery encountered error", { error: err.message });
    stageStatuses.webSearch = "failed";
    discovery.message = `Web search encountered an error: ${err.message}. Running local comparison.`;
  }
  tSearch = Date.now() - tS0;

  // STAGE 4 — Safe Source Retrieval
  onProgress({ step: 5, label: "Step 5 — Retrieving candidate sources safely", percent: 50 });
  let retrievedSources = [];
  const tR0 = Date.now();
  try {
    const localRefSources = getLocalReferenceSources().map(s => ({ ...s, status: "VERIFIED" }));

    if (discovery.sources.some(s => s.isLocal)) {
      retrievedSources = discovery.sources.map(s => ({ ...s, status: "VERIFIED" }));
      stageStatuses.sourceRetrieval = "local";
    } else if (discovery.sources.length > 0) {
      retrievedSources = await retrieveMultipleSources(discovery.sources, 4, 3200);
      stageStatuses.sourceRetrieval = "success";
      if (localRefSources.length > 0) {
        retrievedSources.push(...localRefSources);
      }
    } else {
      stageStatuses.sourceRetrieval = "no_sources";
      if (localRefSources.length > 0) {
        retrievedSources = localRefSources;
        stageStatuses.sourceRetrieval = "local_fallback";
      }
    }

    // Fallback if zero readable external pages were retrieved
    const hasReadable = retrievedSources.some(s => s.text && s.status === "VERIFIED");
    if (!hasReadable && localRefSources.length > 0) {
      retrievedSources = [
        ...retrievedSources,
        ...localRefSources
      ];
    }

    // Direct reference document comparison if supplied in request
    if (options.referenceText && typeof options.referenceText === "string" && options.referenceText.trim().length > 20) {
      retrievedSources.push({
        title: options.referenceTitle || "Submitted Reference Document",
        url: "local://submitted-reference",
        snippet: options.referenceText.slice(0, 200),
        text: options.referenceText,
        sourceType: "Reference Document",
        status: "VERIFIED",
        isLocal: true
      });
    }
  } catch (err) {
    logger.warn("Source retrieval batch error", { error: err.message });
    stageStatuses.sourceRetrieval = "failed";
  }
  tSourceRetrieval = Date.now() - tR0;

  // Track unverifiable sources (e.g. 403, 404, 500, timeouts)
  const unverifiableSources = [];
  retrievedSources.forEach(src => {
    if (src.status === "SOURCE_NOT_VERIFIABLE" || src.status === "INACCESSIBLE") {
      unverifiableSources.push({
        title: src.title,
        url: src.url,
        status: "SOURCE_NOT_VERIFIABLE",
        reason: src.reason || "Web page could not be accessed or extracted"
      });
    }
  });

  // STAGE 5 — Multi-Level Evidence Comparison (Exact + Near + Semantic)
  onProgress({ step: 6, label: "Step 6 — Comparing exact and near-match evidence", percent: 65 });
  const sourceEvidences = [];
  const allMatchedPassages = [];

  const tE0 = Date.now();
  for (const src of retrievedSources) {
    if (!src.text || src.status !== "VERIFIED") {
      continue;
    }

    const srcClassification = classifySource(src.url);

    // Level 1: Exact matches
    let exactResult = { matches: [], exactOverlapPercent: 0 };
    try {
      exactResult = findExactMatches(processed.tokens, src.text, options.minMatchLength || 6, src.url);
    } catch (e) {
      logger.warn("Exact match error", { url: src.url, error: e.message });
    }

    // Level 2: Near matches
    const tN0 = Date.now();
    let nearResult = [];
    try {
      const srcSentences = (src.text.match(/[^.!?\r\n]+[.!?]?/g) || [])
        .map(s => s.trim())
        .filter(s => s.length >= 20 && s.length <= 450);
      nearResult = findNearMatches(processed.eligibleSentences, srcSentences, 0.45);
    } catch (e) {
      logger.warn("Near match error", { url: src.url, error: e.message });
    }
    tNear += (Date.now() - tN0);

    const exactWeight = exactResult.exactOverlapPercent || 0;
    const avgNearScore = nearResult.length > 0
      ? Math.round(nearResult.reduce((sum, n) => sum + (n.similarityScore || 70), 0) / nearResult.length)
      : 0;
    const sourceSim = Math.min(100, Math.max(exactWeight, avgNearScore));

    if (sourceSim > 0 || exactResult.matches.length > 0 || nearResult.length > 0) {
      sourceEvidences.push({
        title: src.title,
        url: src.url,
        snippet: src.snippet,
        status: "VERIFIED",
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
          status: "VERIFIED",
          confidence: em.confidence || "HIGH",
          isPlagiarismEvidence: true
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
          status: "VERIFIED",
          confidence: nm.confidence || "MEDIUM",
          isPlagiarismEvidence: true
        });
      });
    }
  }
  tExact = (Date.now() - tE0) - tNear;

  // Level 3: Semantic comparison with sentence transformers & multi-signal evidence classification
  onProgress({ step: 7, label: "Step 7 — Evaluating semantic sentence similarity", percent: 75 });
  const topicalSources = [];
  const possibleSources = [];

  const tSem0 = Date.now();
  // Bound semantic comparison to top verified sources for serverless performance
  const semanticTargetSources = retrievedSources.filter(s => s.text && s.status === "VERIFIED").slice(0, 4);

  for (const src of semanticTargetSources) {
    if (src.text && src.status === "VERIFIED") {
      try {
        const srcSentences = (src.text.match(/[^.!?\r\n]+[.!?]?/g) || [])
          .map(s => s.trim())
          .filter(s => s.length >= 20 && s.length <= 450);

        let candidateSentences = processed.eligibleSentences;
        if (candidateSentences.length > 40) {
          const sampled = [];
          const step = candidateSentences.length / 35;
          for (let sIdx = 0; sIdx < 35; sIdx++) {
            sampled.push(candidateSentences[Math.floor(sIdx * step)]);
          }
          candidateSentences = sampled;
        }

        const semResult = await findSemanticMatches(
          candidateSentences,
          srcSentences.slice(0, 40),
          {
            embeddingApiUrl: options.embeddingApiUrl,
            embeddingApiKey: options.embeddingApiKey
          }
        );

        if (semResult.matches && semResult.matches.length > 0) {
          const strongParaphrases = semResult.matches.filter(m => m.classification === "STRONG_PARAPHRASE" && m.isPlagiarismEvidence === true);
          const possibleParaphrases = semResult.matches.filter(m => m.classification === "POSSIBLE_PARAPHRASE");
          const conceptualOrTopical = semResult.matches.filter(m => m.classification === "TOPICAL_SIMILARITY" || m.classification === "CONCEPTUAL_SIMILARITY");

          // 1. Strong Paraphrase -> Verified matching evidence
          if (strongParaphrases.length > 0) {
            let existingEvidence = sourceEvidences.find(s => s.url === src.url);
            if (!existingEvidence) {
              existingEvidence = {
                title: src.title,
                url: src.url,
                snippet: src.snippet,
                status: "VERIFIED",
                similarity: 0,
                sourceType: classifySource(src.url).type,
                exactMatches: [],
                nearMatches: [],
                semanticMatches: []
              };
              sourceEvidences.push(existingEvidence);
            }
            existingEvidence.semanticMatches = strongParaphrases;
            existingEvidence.similarity = Math.max(existingEvidence.similarity, strongParaphrases[0].similarityScore);

            strongParaphrases.forEach(sm => {
              allMatchedPassages.push({
                id: `p_${allMatchedPassages.length + 1}`,
                type: "SEMANTIC",
                color: "PURPLE",
                category: "High-confidence semantic match",
                submittedSentence: sm.submittedSentence,
                sourceSentence: sm.sourceSentence,
                sourceTitle: src.title,
                sourceUrl: src.url,
                similarityScore: sm.similarityScore,
                rawSemanticSimilarity: sm.rawSemanticSimilarity,
                semanticSimilarityPercent: sm.semanticSimilarityPercent,
                matchedWords: (sm.submittedSentence || "").split(/\s+/).length,
                status: "VERIFIED",
                confidence: "HIGH",
                tier: sm.tier,
                classification: sm.classification,
                isPlagiarismEvidence: true
              });
            });
          }

          // 2. Possible Paraphrases -> Informational review only
          if (possibleParaphrases.length > 0 && !sourceEvidences.some(s => s.url === src.url) && !possibleSources.some(s => s.url === src.url)) {
            possibleSources.push({
              title: src.title,
              url: src.url,
              snippet: src.snippet,
              status: "VERIFIED",
              classification: "Possible Paraphrase",
              similarity: possibleParaphrases[0].similarityScore,
              reason: possibleParaphrases[0].description
            });

            possibleParaphrases.forEach(pm => {
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
                rawSemanticSimilarity: pm.rawSemanticSimilarity,
                matchedWords: (pm.submittedSentence || "").split(/\s+/).length,
                status: "VERIFIED",
                confidence: "POSSIBLE",
                tier: pm.tier,
                classification: pm.classification,
                isPlagiarismEvidence: false
              });
            });
          }

          // 3. Conceptual / Topical overlap -> Non-plagiarism topical source
          if (conceptualOrTopical.length > 0 && !sourceEvidences.some(s => s.url === src.url) && !possibleSources.some(s => s.url === src.url) && !topicalSources.some(s => s.url === src.url)) {
            topicalSources.push({
              title: src.title,
              url: src.url,
              snippet: src.snippet,
              status: "VERIFIED",
              classification: "Topically Related / No Derivation Evidence",
              similarity: 0,
              reason: conceptualOrTopical[0].description
            });
          }
        }
      } catch (err) {
        logger.warn("Semantic matching error for source", { url: src.url, error: err.message });
      }
    }
  }
  tSemantic = Date.now() - tSem0;

  // Populate topical sources for retrieved candidate pages that do not have derivation matches
  for (const src of retrievedSources) {
    if (src.text && src.status === "VERIFIED" && !src.isLocal) {
      const isVerified = sourceEvidences.some(s => s.url === src.url);
      const isPossible = possibleSources.some(s => s.url === src.url);
      const isTopical = topicalSources.some(s => s.url === src.url);
      if (!isVerified && !isPossible && !isTopical) {
        topicalSources.push({
          title: src.title,
          url: src.url,
          snippet: src.snippet,
          status: "VERIFIED",
          classification: "Topically Related / No Derivation Evidence",
          similarity: 0,
          reason: "Topically related web source retrieved for query, but contains no textual derivation or paraphrasing evidence."
        });
      }
    }
  }

  stageStatuses.localSimilarity = "success";

  // STAGE 6 — Deterministic Scoring & Status Determination
  // Computed strictly from verified exact, near, and semantic matches.
  // CRITICAL: Similarity score NEVER depends on Gemini.
  onProgress({ step: 9, label: "Step 9 — Calculating transparent score", percent: 90 });
  const verifiedMatchingSources = sourceEvidences.filter(s =>
    (s.exactMatches?.length || 0) > 0 ||
    (s.nearMatches?.length || 0) > 0 ||
    (s.semanticMatches?.length || 0) > 0
  );

  const tScore0 = Date.now();
  const scoreResult = calculateDocumentScore(processed.tokens, verifiedMatchingSources, processed.eligibleSentences);
  tScoring = Date.now() - tScore0;

  verifiedMatchingSources.sort((a, b) => b.similarity - a.similarity);

  const highRiskCount = allMatchedPassages.filter(p => p.type === "EXACT" || (p.similarityScore || 0) >= 80).length;

  // Determine overall status and context-aware messaging
  const isLimited = (stageStatuses.webSearch !== "success" && stageStatuses.webSearch !== "local_fallback");
  const overallStatus = isLimited ? "completed_with_limitations" : "completed";

  let statusMessage = "";
  if (discovery.mode === "LOCAL_COMPARISON") {
    statusMessage = "Web search unavailable. Local similarity analysis completed.";
  } else if (retrievedSources.length === 0 || (!retrievedSources.some(s => s.status === "VERIFIED") && unverifiableSources.length > 0)) {
    statusMessage = "No external sources could be verified in this analysis.";
  } else if (scoreResult.score === 0) {
    statusMessage = "0% verified similarity found in the sources successfully checked.";
  } else if (isLimited) {
    statusMessage = "Analysis completed with limited services.";
  } else {
    statusMessage = discovery.message || "Complete analysis finished successfully.";
  }

  // STAGE 7 — Optional Gemini AI Evidence Review
  // Decoupled from core scoring, bounded by strict timeout so Vercel execution never exceeds time limit.
  onProgress({ step: 10, label: "Step 10 — Gemini AI reviewing evidence (optional)", percent: 95 });
  let aiReview = {
    status: "NOT_CONFIGURED",
    state: "AI_REVIEW_NOT_CONFIGURED",
    available: false,
    retryable: false,
    message: "Gemini review unavailable — configure GEMINI_API_KEY in environment.",
    items: []
  };

  const tG0 = Date.now();
  const elapsedBeforeAi = Date.now() - tTotalStart;
  const passagesForAiReview = allMatchedPassages.filter(p => p.type === "EXACT" || p.type === "NEAR" || p.type === "SEMANTIC" || p.type === "POSSIBLE");

  try {
    if (elapsedBeforeAi > 6500) {
      // Bounded pipeline budget reached: preserve core analysis and skip external AI call
      aiReview = {
        status: "UNAVAILABLE",
        state: "AI_REVIEW_UNAVAILABLE",
        available: false,
        retryable: true,
        message: "AI evidence review deferred to conserve serverless budget. Core similarity score is complete.",
        items: []
      };
      stageStatuses.geminiReview = "limited";
    } else if (passagesForAiReview.length > 0) {
      // Bound AI review by strict 2000ms timeout
      aiReview = await Promise.race([
        reviewEvidenceWithAI(passagesForAiReview.slice(0, 8), { timeoutMs: 2000, maxAttempts: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("AI review timeout")), 2200))
      ]);
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
    logger.warn("Gemini evidence review failed or timed out", { error: err.message });
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
  tGemini = Date.now() - tG0;

  const tRep0 = Date.now();
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
      unverifiableCount: unverifiableSources.length,
      reviewed: retrievedSources.length,
      groundingStatus: discovery.groundingStatus || "NOT_TESTED",
      groundingError: discovery.groundingError || null,
      topicalSources,
      possibleSources,
      unverifiableSources,
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

  tReport = Date.now() - tRep0;
  const tTotal = Date.now() - tTotalStart;

  analysisRecord.timings = {
    extraction: tExtraction,
    preprocessing: tPreprocess,
    search: tSearch,
    sourceRetrieval: tSourceRetrieval,
    exactMatching: tExact,
    nearMatching: tNear,
    semanticMatching: tSemantic,
    scoring: tScoring,
    geminiReview: tGemini,
    report: tReport,
    total: tTotal
  };

  db.setSessionAnalysis(analysisRecord);

  // Lightweight server-side stage timing instrumentation (Step 9)
  console.log(`[Checkra] extraction: ${tExtraction} ms`);
  console.log(`[Checkra] preprocessing: ${tPreprocess} ms`);
  console.log(`[Checkra] exact matching: ${tExact} ms`);
  console.log(`[Checkra] near matching: ${tNear} ms`);
  console.log(`[Checkra] semantic matching: ${tSemantic} ms`);
  console.log(`[Checkra] core scoring: ${tScoring} ms`);
  console.log(`[Checkra] search: ${tSearch} ms`);
  console.log(`[Checkra] source verification: ${tSourceRetrieval} ms`);
  console.log(`[Checkra] Gemini review: ${tGemini} ms`);
  console.log(`[Checkra] report generation: ${tReport} ms`);
  console.log(`[Checkra] total: ${tTotal} ms`);

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
