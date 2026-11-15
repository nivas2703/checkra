/**
 * VeriWrite Document Preprocessor
 * Preprocesses and structure-tags submitted text while preserving original text.
 */

function normalizeUnicode(text) {
  if (!text) return "";
  return text.normalize("NFKC");
}

function removeInvisibleCharacters(text) {
  if (!text) return "";
  // Remove zero-width spaces, soft hyphens, byte-order marks, word joiners
  return text.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u180E]/g, "");
}

function normalizeQuotesAndApostrophes(text) {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"');
}

function normalizeWhitespace(text) {
  if (!text) return "";
  return text.replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function tokenize(text) {
  if (!text) return [];
  // Tokenize words, preserving internal apostrophes
  const norm = normalizeQuotesAndApostrophes(normalizeUnicode(text)).toLowerCase();
  return norm.match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
}

function splitIntoParagraphs(text) {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((p, idx) => ({
      index: idx,
      text: p.trim()
    }))
    .filter(p => p.text.length > 0);
}

function splitIntoSentences(text) {
  if (!text) return [];
  // Match sentences ending in punctuation or end of string, avoiding abbreviations like e.g., i.e., Dr., etc.
  const regex = /[^.!?\n]+(?:[.!?]+(?=\s+|$)|$)/g;
  const matches = text.match(regex) || [];
  return matches
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function detectSections(text) {
  const paragraphs = splitIntoParagraphs(text);
  let inBibliography = false;

  const biblioRegex = /^(references|bibliography|works cited|sources cited|literature cited)\b/i;
  const citationPattern = /\((?:[A-Z][a-zA-Z\s]+,?\s*(?:19|20)\d{2}|(?:19|20)\d{2}|et al\.)\)|\[(?:\d+|[A-Z][a-zA-Z]+(?:\s+(?:19|20)\d{2})?)\]/g;
  const quotePattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|“([^”]*?)”/g;
  const headingPattern = /^#{1,6}\s+.+$|^[A-Z0-9\s]{4,60}$/m;

  const analyzedParagraphs = paragraphs.map(p => {
    const isHeading = headingPattern.test(p.text) && p.text.length < 80;
    if (biblioRegex.test(p.text)) {
      inBibliography = true;
    }

    const citations = p.text.match(citationPattern) || [];
    const quotes = [];
    let match;
    while ((match = quotePattern.exec(p.text)) !== null) {
      quotes.push(match[0]);
    }

    return {
      index: p.index,
      text: p.text,
      isBibliography: inBibliography,
      isHeading,
      hasQuotes: quotes.length > 0,
      quotes,
      citationsCount: citations.length
    };
  });

  return analyzedParagraphs;
}

function preprocessDocument(rawText, options = {}) {
  const original = rawText || "";
  const cleaned = normalizeWhitespace(
    normalizeQuotesAndApostrophes(
      removeInvisibleCharacters(
        normalizeUnicode(original)
      )
    )
  );

  const sections = detectSections(cleaned);

  // Filter text based on options
  const filterParams = {
    ignoreQuotations: options.ignoreQuotations ?? false,
    ignoreBibliography: options.ignoreBibliography ?? true,
    ignoreCitations: options.ignoreCitations ?? true,
    minMatchLength: options.minMatchLength !== undefined ? options.minMatchLength : 4
  };

  const eligibleParagraphs = sections.filter(sec => {
    if (filterParams.ignoreBibliography && sec.isBibliography) return false;
    return true;
  });

  // Extract sentences eligible for matching
  const sentences = [];
  eligibleParagraphs.forEach(sec => {
    let pText = sec.text;
    if (filterParams.ignoreQuotations && sec.hasQuotes) {
      sec.quotes.forEach(q => {
        pText = pText.replace(q, " ");
      });
    }
    if (filterParams.ignoreCitations) {
      pText = pText.replace(/\((?:[A-Z][a-zA-Z\s]+,?\s*(?:19|20)\d{2}|(?:19|20)\d{2}|et al\.)\)|\[(?:\d+|[A-Z][a-zA-Z]+(?:\s+(?:19|20)\d{2})?)\]/g, " ");
    }

    const sList = splitIntoSentences(pText);
    sList.forEach(s => {
      const tokens = tokenize(s);
      if (tokens.length >= (filterParams.minMatchLength || 4)) {
        sentences.push({
          raw: s,
          normalized: tokens.join(" "),
          tokens,
          paragraphIndex: sec.index
        });
      }
    });
  });

  return {
    originalText: original,
    normalizedText: cleaned,
    tokens: tokenize(cleaned),
    sections,
    eligibleSentences: sentences,
    options: filterParams
  };
}

module.exports = {
  preprocessDocument,
  tokenize,
  splitIntoParagraphs,
  splitIntoSentences,
  normalizeUnicode,
  normalizeQuotesAndApostrophes,
  removeInvisibleCharacters
};
