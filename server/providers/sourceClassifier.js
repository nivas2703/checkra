/**
 * VeriWrite Source Type Classifier
 * Classifies candidate sources by domain, TLD, and URL structure.
 * Never guesses without grounded evidence; returns "Unclassified" when uncertain.
 */

const { URL } = require("url");

function classifySource(urlString) {
  if (!urlString) return { type: "Unclassified", confidence: "LOW" };

  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    // Government
    if (/\.(gov|mil|gov\.[a-z]{2})$/i.test(host)) {
      return { type: "Government", confidence: "HIGH" };
    }

    // Educational / University
    if (/\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/i.test(host)) {
      return { type: "Educational", confidence: "HIGH" };
    }

    // Academic / Journal / Publication
    if (
      /(ncbi\.nlm\.nih\.gov|sciencedirect\.com|springer\.com|nature\.com|wiley\.com|ieeexplore\.ieee\.org|jstor\.org|tandfonline\.com|cell\.com|sagepub\.com|frontiersin\.org|plos\.org|biorxiv\.org|arxiv\.org)/i.test(host) ||
      /\/doi\/|\/article\/|\/paper\/|\/journal\//i.test(pathname)
    ) {
      return { type: "Journal / Publication", confidence: "HIGH" };
    }

    // Repositories
    if (
      /(github\.com|gitlab\.com|bitbucket\.org|zenodo\.org|figshare\.com|researchgate\.net|semanticscholar\.org|kaggle\.com)/i.test(host)
    ) {
      return { type: "Repository", confidence: "HIGH" };
    }

    // News
    if (
      /(nytimes\.com|bbc\.(com|co\.uk)|reuters\.com|theguardian\.com|washingtonpost\.com|bloomberg\.com|wsj\.com|cnn\.com|forbes\.com|techcrunch\.com)/i.test(host)
    ) {
      return { type: "News", confidence: "HIGH" };
    }

    // Blogs
    if (
      /(medium\.com|substack\.com|wordpress\.com|blogger\.com)/i.test(host) ||
      /\/blog\/|\/posts\//i.test(pathname)
    ) {
      return { type: "Blog", confidence: "MEDIUM" };
    }

    // General Web / Company
    if (/\.(com|org|io|ai|net|co)$/i.test(host)) {
      return { type: "Internet", confidence: "MEDIUM" };
    }

    return { type: "Unclassified", confidence: "LOW" };
  } catch (e) {
    return { type: "Unclassified", confidence: "LOW" };
  }
}

module.exports = {
  classifySource
};
