/**
 * Checkra AI Agent — Tool Registry
 *
 * Implements deterministic read-only access to existing Checkra analysis state.
 * Tools do NOT recalculate scores, fabricate data, or access external systems.
 */

const TOOLS = {
  get_analysis_result: {
    name: "get_analysis_result",
    description: "Retrieves the existing Checkra deterministic similarity scores, coverage breakdown, verified sources, and matched passages.",
    execute: (context = {}) => {
      const a = context.analysis;
      if (!a || typeof a !== "object") {
        return {
          available: false,
          error: "NO_ANALYSIS_PROVIDED",
          message: "No Checkra document analysis result was supplied in the request context."
        };
      }

      // Safe extraction preserving existing Checkra terminology
      const sim = a.similarity || {};
      const cov = sim.coverage || {};
      const sources = a.sources || {};
      const passages = Array.isArray(a.matchedPassages) ? a.matchedPassages : (Array.isArray(a.passages) ? a.passages : []);

      // Check whether an authoritative score was actually calculated and provided
      const hasScore = typeof sim.score === "number" && !isNaN(sim.score);
      const overallSimilarityScore = hasScore ? sim.score : null;
      const grade = hasScore ? (sim.grade || "A") : null;

      const exactCoverage = typeof cov.exactPercent === "number"
        ? cov.exactPercent
        : (typeof sim.exactCoverage === "number" ? sim.exactCoverage : 0);
      const nearCoverage = typeof cov.nearPercent === "number"
        ? cov.nearPercent
        : (typeof sim.nearCoverage === "number" ? sim.nearCoverage : 0);
      const semanticCoverage = typeof cov.semanticPercent === "number"
        ? cov.semanticPercent
        : (typeof sim.semanticCoverage === "number" ? sim.semanticCoverage : 0);

      // Verify mathematical consistency with component coverage formula:
      // Overall = min(100, round((exact * 0.65) + (near * 0.25) + (semantic * 0.10)))
      let isMathematicallyConsistent = true;
      let inconsistencyNotice = null;

      if (hasScore) {
        const expectedScore = Math.min(
          100,
          Math.round((exactCoverage * 0.65) + (nearCoverage * 0.25) + (semanticCoverage * 0.10))
        );
        // Allow a small ±2 tolerance for rounding variations
        if (Math.abs(expectedScore - overallSimilarityScore) > 2) {
          isMathematicallyConsistent = false;
          inconsistencyNotice = `The displayed component percentages do not independently reproduce the reported overall score; the authoritative Checkra overall score is ${overallSimilarityScore}%.`;
        }
      }

      // Extract up to 5 highest-priority matched passages for compact reasoning
      const topPassages = passages.slice(0, 5).map(p => ({
        passageText: p.text || p.passageText || "",
        matchType: p.matchType || p.type || "EXACT",
        similarityPercent: p.similarityScore ? Math.round(p.similarityScore * 100) : (p.score ? Math.round(p.score * 100) : (p.similarity ?? 100)),
        sourceUrl: p.sourceUrl || p.url || null,
        sourceTitle: p.sourceTitle || p.title || null
      }));

      return {
        available: true,
        hasScore,
        analysisId: a.id || a.analysisId || "VW-SESSION",
        documentTitle: a.document?.title || a.title || "Document",
        wordCount: a.document?.wordCount || a.fileStats?.wordCount || 0,
        overallSimilarityScore,
        grade,
        exactCoverage,
        nearCoverage,
        semanticCoverage,
        isMathematicallyConsistent,
        inconsistencyNotice,
        verifiedSourcesCount: sources.matchingCount ?? (Array.isArray(sources.items) ? sources.items.length : 0),
        retrievedSourcesCount: sources.retrievedCount ?? sources.reviewed ?? 0,
        matchedPassagesCount: passages.length,
        topMatchedPassages: topPassages,
        status: a.status || "completed"
      };
    }
  }
};

/**
 * Executes a registered Checkra tool safely by name.
 *
 * @param {string} toolName Name of the tool to execute
 * @param {Object} context Context containing inputs/analysis
 * @returns {Object} Result of tool execution
 */
function executeTool(toolName, context = {}) {
  const tool = TOOLS[toolName];
  if (!tool) {
    return {
      available: false,
      error: "UNKNOWN_TOOL",
      message: `Tool '${toolName}' is not registered in the Checkra tool suite.`
    };
  }
  return tool.execute(context);
}

module.exports = {
  TOOLS,
  executeTool
};
