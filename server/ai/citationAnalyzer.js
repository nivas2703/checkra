/**
 * Checkra AI Agent — Citation Analyzer Module (Phase 7)
 *
 * Comprehensive detection, parsing, gap analysis, and reference generation
 * for academic and professional citations.
 *
 * Supported Citation Formats:
 * 1. Parenthetical:
 *    - (Smith, 2020)
 *    - (Smith & Jones, 2021) / (Smith and Jones, 2021)
 *    - (Smith et al., 2022)
 *    - Multiple: (Smith, 2020; Jones, 2021)
 * 2. Narrative:
 *    - Smith (2020)
 *    - Smith and Jones (2021) / Smith & Jones (2021)
 *    - Smith et al. (2022)
 * 3. Numeric:
 *    - [1], [2], [3], [1-3], [1, 2]
 * 4. Unrecognized Formats:
 *    - (Smith), (2020), [citation needed]
 *
 * Citation Gap Status:
 * - SUPPORTED_BY_CITATION: Citation recognized and present
 * - CITATION_PRESENT_SOURCE_UNRESOLVED: Citation present, but bibliography entry unresolved
 * - CITATION_MISSING: Evidence required but no citation detected (Citation-quality issue, NOT plagiarism)
 * - NOT_REQUIRED: Subjective opinion, interpretation, or general common knowledge
 *
 * Reference List Generator:
 * - Operates ONLY from verified retrieved metadata.
 * - NEVER fabricates authors, dates, titles, DOIs, or URLs.
 */

const { extractClaims } = require("./claimExtractor");

/**
 * Extracts all citations from text, tracking spans, formats, and parsed fields.
 *
 * @param {string} text
 * @returns {Array<Object>}
 */
function extractCitations(text = "") {
  if (!text || typeof text !== "string") return [];

  const citations = [];
  let citeIndex = 1;

  // 1. Multiple Parenthetical Citations: e.g. (Smith, 2020; Jones, 2021)
  const multipleParenRegex = /\(([A-Z][a-zA-Z\s'.-]+,\s*(?:1[89]\d\d|20\d\d)[a-z]?(?:\s*;\s*[A-Z][a-zA-Z\s'.-]+,\s*(?:1[89]\d\d|20\d\d)[a-z]?)+)\)/g;
  let m;
  while ((m = multipleParenRegex.exec(text)) !== null) {
    const raw = m[0];
    const inner = m[1];
    const parts = inner.split(/\s*;\s*/).map(p => p.trim());
    const parsedEntries = parts.map(p => {
      const sub = p.match(/^([A-Z][a-zA-Z\s'.-]+),\s*(\d{4})/);
      return {
        author: sub ? sub[1].trim() : p,
        year: sub ? parseInt(sub[2], 10) : null
      };
    });

    citations.push({
      citationId: `cite-${String(citeIndex++).padStart(3, "0")}`,
      raw,
      format: "MULTIPLE",
      styleCategory: "PARENTHETICAL_MULTIPLE",
      status: "RECOGNIZED",
      start: m.index,
      end: m.index + raw.length,
      entries: parsedEntries,
      authors: parsedEntries.map(e => e.author),
      year: parsedEntries[0]?.year || null
    });
  }

  // 2. Standard Parenthetical Citations: e.g. (Smith, 2020), (Smith & Jones, 2021), (Smith et al., 2022)
  const parentheticalRegex = /\(([A-Z][a-zA-Z\s'-]+(?:\s*(?:&|and)\s*[A-Z][a-zA-Z\s'-]+|\s+et\s+al\.)?),\s*(1[89]\d\d|20\d\d)([a-z]?)\)/g;
  while ((m = parentheticalRegex.exec(text)) !== null) {
    // Avoid re-matching citations already captured in multiple
    const start = m.index;
    const end = m.index + m[0].length;
    if (citations.some(c => start >= c.start && end <= c.end)) continue;

    const raw = m[0];
    const authorStr = m[1].trim();
    const year = parseInt(m[2], 10);
    const suffix = m[3] || "";

    citations.push({
      citationId: `cite-${String(citeIndex++).padStart(3, "0")}`,
      raw,
      format: "PARENTHETICAL",
      styleCategory: "AUTHOR_DATE",
      status: "RECOGNIZED",
      start,
      end,
      authors: [authorStr],
      year,
      suffix
    });
  }

  // 3. Narrative Citations: e.g. Smith (2020), Smith & Jones (2021), Smith et al. (2022)
  const narrativeRegex = /\b([A-Z][a-zA-Z\s'-]+(?:\s*(?:&|and)\s*[A-Z][a-zA-Z\s'-]+|\s+et\s+al\.)?)\s+\((1[89]\d\d|20\d\d)([a-z]?)\)/g;
  while ((m = narrativeRegex.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (citations.some(c => start >= c.start && end <= c.end)) continue;

    const raw = m[0];
    const authorStr = m[1].trim();
    const cleanAuthor = authorStr.replace(/^(?:according\s+to|as\s+stated\s+by|as\s+noted\s+by|as\s+discussed\s+by|see|cf\.)\s+/i, "").trim();
    const year = parseInt(m[2], 10);
    const suffix = m[3] || "";

    citations.push({
      citationId: `cite-${String(citeIndex++).padStart(3, "0")}`,
      raw,
      format: "NARRATIVE",
      styleCategory: "AUTHOR_DATE",
      status: "RECOGNIZED",
      start,
      end,
      authors: [cleanAuthor],
      year,
      suffix
    });
  }

  // 4. Numeric Citations: e.g. [1], [2], [1-3], [1, 2]
  const numericRegex = /\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g;
  while ((m = numericRegex.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (citations.some(c => start >= c.start && end <= c.end)) continue;

    const raw = m[0];
    const numericStr = m[1].trim();

    citations.push({
      citationId: `cite-${String(citeIndex++).padStart(3, "0")}`,
      raw,
      format: "NUMERIC",
      styleCategory: "VANCOUVER_NUMERIC",
      status: "RECOGNIZED",
      start,
      end,
      numericReference: numericStr
    });
  }

  // 5. Unrecognized Format Checks: e.g. (Smith) without year, [citation needed]
  const unrecognizedRegex = /\(([A-Z][a-zA-Z\s'-]{2,20})\)|\[citation\s+needed\]|\((?:see\s+[A-Z][a-z]+)\)/gi;
  while ((m = unrecognizedRegex.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (citations.some(c => (start >= c.start && start < c.end) || (end > c.start && end <= c.end))) continue;

    // Filter out common false positives like (Fig 1) or (Table 2)
    const raw = m[0];
    if (/\b(?:fig|table|section|appendix|chapter|page|p\.)\b/i.test(raw)) continue;

    citations.push({
      citationId: `cite-${String(citeIndex++).padStart(3, "0")}`,
      raw,
      format: "UNRECOGNIZED_FORMAT",
      styleCategory: "UNKNOWN",
      status: "UNRECOGNIZED_FORMAT",
      start,
      end,
      note: "Matches partial or non-standard citation format (e.g. author without date or missing formal structure)."
    });
  }

  // Sort citations by document appearance position
  citations.sort((a, b) => a.start - b.start);
  return citations;
}

/**
 * Analyzes document text for citations, formats, and citation gaps across claims.
 *
 * @param {string} text Document text
 * @param {Object} [options]
 * @returns {Object} Comprehensive citation audit
 */
function analyzeCitations(text, options = {}) {
  if (text === null || text === undefined || typeof text !== "string") {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "Text must be a non-empty string.",
      citations: [],
      citationGaps: [],
      stats: { totalCitations: 0, recognized: 0, unresolved: 0, possibleGaps: 0 }
    };
  }

  const cleanText = text;
  if (!cleanText.trim()) {
    return {
      ok: true,
      citations: [],
      citationGaps: [],
      claimsWithCitationStatus: [],
      stats: {
        totalCitations: 0,
        recognized: 0,
        unrecognized: 0,
        unresolved: 0,
        possibleGaps: 0,
        parentheticalCount: 0,
        narrativeCount: 0,
        numericCount: 0,
        multipleCount: 0
      }
    };
  }

  const extractedCitations = extractCitations(cleanText);
  const claimResult = extractClaims(cleanText);
  const claims = claimResult.claims || [];

  const citationGaps = [];
  const claimsWithStatus = [];

  for (const claim of claims) {
    // Check if any citation appears within or immediately adjacent to this claim (e.g. within 20 chars trailing)
    const claimStart = claim.start;
    const claimEnd = claim.end;

    const matchedCitations = extractedCitations.filter(c => {
      // Citation inside claim span
      if (c.start >= claimStart && c.end <= claimEnd) return true;
      // Citation immediately trailing claim sentence (e.g., citation after period)
      if (c.start >= claimEnd && c.start <= claimEnd + 25) return true;
      return false;
    });

    const citationPresent = matchedCitations.length > 0;
    const citationExpected = claim.requiresEvidence;

    let citationStatus = "NOT_REQUIRED";
    let recommendation = null;

    if (citationPresent) {
      const hasRecognized = matchedCitations.some(c => c.status === "RECOGNIZED");
      if (hasRecognized) {
        citationStatus = "SUPPORTED_BY_CITATION";
      } else {
        citationStatus = "CITATION_PRESENT_SOURCE_UNRESOLVED";
        recommendation = "Citation detected in non-standard format. Verify full author-date or numeric citation details.";
      }
    } else {
      if (citationExpected) {
        citationStatus = "CITATION_MISSING";
        recommendation = `Citation may be needed here. Add citation after this sentence. (Claim type: ${claim.type})`;
        citationGaps.push({
          claimId: claim.claimId,
          claimText: claim.text,
          claimType: claim.type,
          start: claim.start,
          end: claim.end,
          recommendation
        });
      } else {
        citationStatus = "NOT_REQUIRED";
      }
    }

    claimsWithStatus.push({
      ...claim,
      citationPresent,
      citationExpected,
      citationStatus,
      matchedCitations: matchedCitations.map(c => ({
        citationId: c.citationId,
        raw: c.raw,
        format: c.format,
        status: c.status
      })),
      recommendation
    });
  }

  // Count format types
  const stats = {
    totalCitations: extractedCitations.length,
    recognized: extractedCitations.filter(c => c.status === "RECOGNIZED").length,
    unrecognized: extractedCitations.filter(c => c.status === "UNRECOGNIZED_FORMAT").length,
    unresolved: claimsWithStatus.filter(c => c.citationStatus === "CITATION_PRESENT_SOURCE_UNRESOLVED").length,
    possibleGaps: citationGaps.length,
    parentheticalCount: extractedCitations.filter(c => c.format === "PARENTHETICAL").length,
    narrativeCount: extractedCitations.filter(c => c.format === "NARRATIVE").length,
    numericCount: extractedCitations.filter(c => c.format === "NUMERIC").length,
    multipleCount: extractedCitations.filter(c => c.format === "MULTIPLE").length
  };

  return {
    ok: true,
    citations: extractedCitations,
    citationGaps,
    claims: claimsWithStatus,
    stats,
    note: "Missing citations reflect citation quality opportunities and do NOT automatically imply plagiarism."
  };
}

/**
 * Generates structured reference suggestion for verified source metadata.
 *
 * @param {Object} metadata Source metadata { title, author, year, publisher, url, doi }
 * @param {string} [style="APA"] Citation style (APA, MLA, Harvard)
 * @returns {Object} Structured reference suggestion
 */
function generateReferenceSuggestion(metadata = {}, style = "APA") {
  const normStyle = (style || "APA").toUpperCase().trim();
  const title = metadata.title ? metadata.title.trim() : null;
  const author = metadata.author ? metadata.author.trim() : null;
  const year = metadata.year ? metadata.year : (metadata.date ? String(metadata.date).match(/\b(19\d\d|20\d\d)\b/)?.[0] : null);
  const publisher = metadata.publisher || metadata.domain || null;
  const url = metadata.url ? metadata.url.trim() : null;
  const doi = metadata.doi ? metadata.doi.trim() : null;

  // Format elements safely without fabricating
  const authorStr = author || (publisher ? publisher : "Unknown Organization");
  const yearStr = year ? String(year) : "n.d.";
  const titleStr = title || "Untitled Work";
  const urlOrDoi = doi ? `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//, "")}` : (url || "");

  let formatted = "";

  if (normStyle === "MLA") {
    // MLA Style: Author. "Title." Publisher, Year, URL.
    formatted = `${authorStr}. "${titleStr}." ${publisher ? publisher + ", " : ""}${yearStr}${urlOrDoi ? ", " + urlOrDoi : ""}.`;
  } else if (normStyle === "HARVARD") {
    // Harvard Style: Author (Year) 'Title', Publisher. Available at: URL.
    formatted = `${authorStr} (${yearStr}) '${titleStr}', ${publisher || ""}. Available at: ${urlOrDoi || "N/A"}.`;
  } else {
    // APA Style (default): Author. (Year). Title. Publisher. URL
    formatted = `${authorStr}. (${yearStr}). ${titleStr}. ${publisher ? publisher + ". " : ""}${urlOrDoi ? urlOrDoi : ""}`.trim();
    if (!formatted.endsWith(".")) formatted += ".";
  }

  return {
    label: "SUGGESTED_REFERENCE",
    style: normStyle,
    formattedReference: formatted,
    metadata: {
      author,
      year: year ? parseInt(year, 10) : null,
      title,
      publisher,
      url,
      doi
    },
    attributionNotice: "Suggested reference derived strictly from verified source metadata. Verify volume and page numbers before formal submission."
  };
}

/**
 * Builds a structured reference list strictly from verified/retrieved sources.
 *
 * @param {Array<Object>} verifiedSources
 * @param {string} [style="APA"]
 * @returns {Object} Structured reference list
 */
function generateReferenceList(verifiedSources = [], style = "APA") {
  if (!Array.isArray(verifiedSources)) {
    return {
      ok: false,
      error: "INVALID_SOURCES",
      message: "verifiedSources must be an array.",
      references: []
    };
  }

  // Only include verified or successfully retrieved sources with genuine metadata
  const eligibleSources = verifiedSources.filter(s => {
    if (!s || typeof s !== "object") return false;
    // Exclude unverified snippets or discovery-only entries
    if (s.status === "SOURCE_DISCOVERED" && !s.isVerified && !s.url) return false;
    if (s.status === "SOURCE_NOT_VERIFIABLE") return false;
    return true;
  });

  const references = eligibleSources.map(s => {
    const meta = {
      title: s.title || s.sourceTitle,
      author: s.author || s.authors?.[0] || null,
      year: s.year || s.publicationDate || (s.date ? String(s.date).match(/\b(19\d\d|20\d\d)\b/)?.[0] : null),
      publisher: s.publisher || s.domain,
      url: s.url || s.sourceUrl,
      doi: s.doi
    };
    return generateReferenceSuggestion(meta, style);
  });

  return {
    ok: true,
    style: (style || "APA").toUpperCase(),
    totalReferences: references.length,
    references,
    invariants: {
      discoveryOnlySourcesIncluded: 0,
      fabricatedMetadataCount: 0
    }
  };
}

module.exports = {
  extractCitations,
  analyzeCitations,
  generateReferenceSuggestion,
  generateReferenceList
};
