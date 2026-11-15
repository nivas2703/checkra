/**
 * VeriWrite Document Text & Structure Extractor
 * Supports PDF, DOCX, DOC, TXT, MD, HTML
 */

const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { sanitizeHtml } = require("../utils/security");

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".html", ".htm", ".txt", ".md", ".markdown"]);

async function extractFromFile(fileBuffer, originalName = "document.txt", mimeType = "") {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error("The uploaded file is empty. Please upload a document with text content.");
  }

  const ext = path.extname(originalName).toLowerCase();
  if (ext && !SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file format "${ext}". Supported formats are PDF, DOCX, TXT, MD, and HTML.`);
  }

  let text = "";
  let pageCount = 1;
  const fileSize = fileBuffer.length;

  if (ext === ".pdf") {
    try {
      const uint8 = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
      const data = await pdfParse(uint8);
      text = data.text || "";
      pageCount = data.numpages || 1;
    } catch (err) {
      throw new Error(`PDF extraction failed: ${err.message}`);
    }
  } else if (ext === ".docx") {
    try {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      text = result.value || "";
      // Estimate pages roughly based on 450 words per page
      const words = (text.match(/\S+/g) || []).length;
      pageCount = Math.max(1, Math.ceil(words / 450));
    } catch (err) {
      throw new Error(`DOCX extraction failed: ${err.message}`);
    }
  } else if (ext === ".html" || ext === ".htm") {
    const raw = fileBuffer.toString("utf8");
    text = sanitizeHtml(raw);
    const words = (text.match(/\S+/g) || []).length;
    pageCount = Math.max(1, Math.ceil(words / 450));
  } else {
    // TXT, MD, or plain text
    text = fileBuffer.toString("utf8");
    const words = (text.match(/\S+/g) || []).length;
    pageCount = Math.max(1, Math.ceil(words / 450));
  }

  const stats = calculateTextStats(text, originalName, fileSize, pageCount);
  return {
    rawText: text,
    ...stats
  };
}

function calculateTextStats(text = "", filename = "pasted_text.txt", fileSize = null, pageCount = null) {
  const words = (text.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) || []);
  const charCount = text.length;
  const wordCount = words.length;
  const estimatedPages = pageCount || Math.max(1, Math.ceil(wordCount / 450));
  const estimatedReadingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200)); // ~200 wpm

  return {
    filename,
    fileSize: fileSize !== null ? fileSize : Buffer.byteLength(text, "utf8"),
    wordCount,
    characterCount: charCount,
    pageCount: estimatedPages,
    estimatedReadingTime: `${estimatedReadingTimeMinutes} min`
  };
}

module.exports = {
  extractFromFile,
  calculateTextStats
};
