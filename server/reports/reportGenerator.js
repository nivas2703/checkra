/**
 * Checkra Professional Report Engine
 * Generates multi-page printable HTML reports, JSON evidence packages,
 * and QR verification seals.
 */

const QRCode = require("qrcode");
const { escapeHtml } = require("../utils/security");

const DISCLAIMER_TEXT = "Checkra reports similarity based on sources accessible to the configured analysis system at the time of analysis. Similarity analysis identifies matching or potentially related text. It is not, by itself, a determination of plagiarism. Users should review source context, quotation, citation, and attribution requirements.";
const AI_DISCLAIMER_TEXT = "AI evidence review is probabilistic and should not be treated as proof of authorship or intent.";

async function generateReportPackage(analysis, baseUrl = "") {
  const analysisId = analysis.id;
  const verifyUrl = `${baseUrl.replace(/\/$/, "")}/verify/${analysisId}`;

  // Generate QR code data URL
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      width: 140,
      margin: 1,
      color: { dark: "#050505", light: "#ffffff" }
    });
  } catch (e) {
    // ignore
  }

  const jsonEvidence = {
    analysisId,
    timestamp: analysis.createdAt || new Date().toISOString(),
    verificationUrl: verifyUrl,
    document: {
      title: analysis.document?.title || analysis.title || "Untitled Document",
      filename: analysis.document?.filename || "document.txt",
      wordCount: analysis.document?.wordCount || 0,
      characterCount: analysis.document?.characterCount || 0,
      pageCount: analysis.document?.pageCount || 1,
      estimatedReadingTime: analysis.document?.estimatedReadingTime || "1 min"
    },
    settings: analysis.settings || {},
    similarity: {
      score: analysis.similarity?.score ?? 0,
      grade: analysis.similarity?.grade || "A",
      gradeLabel: "Checkra similarity grade",
      relevantMatches: analysis.similarity?.relevantMatches ?? 0,
      highRiskPassages: analysis.similarity?.highRisk ?? 0,
      methodology: analysis.similarity?.methodology || ""
    },
    sources: analysis.sources?.items || [],
    matchedPassages: analysis.matchedPassages || [],
    aiReview: analysis.aiReview || { status: "Not run" },
    grammarFindings: analysis.grammar?.findings || [],
    disclaimers: {
      similarity: DISCLAIMER_TEXT,
      ai: AI_DISCLAIMER_TEXT
    }
  };

  const htmlReport = generatePrintableHtml(jsonEvidence, qrDataUrl);

  return {
    analysisId,
    verificationUrl: verifyUrl,
    qrDataUrl,
    jsonEvidence,
    htmlReport
  };
}

function generatePrintableHtml(data, qrDataUrl) {
  const doc = data?.document || {};
  const sim = data?.similarity || {
    score: 0,
    grade: "A",
    gradeLabel: "Minimal / Independent",
    coverage: { exactPercent: 0, nearPercent: 0, semanticPercent: 0 },
    methodology: ""
  };
  const sources = data?.sources || [];
  const passages = data?.matchedPassages || [];

  // Group sources by classification
  const byType = {};
  sources.forEach(s => {
    const t = s.sourceType || "Internet";
    byType[t] = (byType[t] || 0) + 1;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Checkra Writing Integrity Report — ${escapeHtml(data.analysisId)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0a0a0f; margin: 0; background: #fff; line-height: 1.5; font-size: 11pt; }
  .page { page-break-after: always; padding: 20px 0; min-height: 90vh; position: relative; }
  .page:last-child { page-break-after: avoid; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #7c3aed; padding-bottom: 15px; margin-bottom: 25px; }
  .logo { font-size: 20pt; font-weight: 900; letter-spacing: -0.5px; color: #0a0a0f; display: flex; align-items: center; gap: 8px; }
  .logo span { color: #8b5cf6; }
  .tagline { font-size: 8.5pt; color: #71717a; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; }
  .title-block { margin: 40px 0 30px; text-align: center; }
  .title-block h1 { font-size: 26pt; margin: 0 0 10px; letter-spacing: -0.5px; color: #050505; }
  .score-badge { display: inline-flex; align-items: center; justify-content: center; width: 140px; height: 140px; border-radius: 50%; background: conic-gradient(#7c3aed 0% ${sim.score}%, #f4f4f5 ${sim.score}% 100%); margin: 20px auto; position: relative; }
  .score-badge::after { content: "${sim.score}%"; position: absolute; width: 112px; height: 112px; background: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28pt; font-weight: 900; color: #0a0a0f; }
  .grade-pill { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: 800; font-size: 11pt; background: #f5f3ff; color: #7c3aed; margin-top: 10px; border: 1px solid #ddd6fe; }
  .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; background: #fafafa; border: 1px solid #e4e4e7; border-radius: 12px; padding: 18px; margin: 25px 0; font-size: 10pt; }
  .meta-item b { display: block; color: #71717a; font-size: 8pt; text-transform: uppercase; margin-bottom: 3px; letter-spacing: 0.5px; }
  .qr-box { display: flex; align-items: center; gap: 15px; border: 1px dashed #d4d4d8; border-radius: 10px; padding: 12px; margin-top: 30px; background: #fafafa; }
  .qr-box img { width: 90px; height: 90px; }
  .qr-text { font-size: 9pt; color: #3f3f46; line-height: 1.5; }
  .section-title { font-size: 14pt; font-weight: 800; border-bottom: 1px solid #e4e4e7; padding-bottom: 8px; margin: 30px 0 15px; color: #18181b; }
  table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 9pt; }
  th { text-align: left; background: #f4f4f5; padding: 8px 10px; border: 1px solid #e4e4e7; font-weight: 700; color: #27272a; }
  td { padding: 8px 10px; border: 1px solid #e4e4e7; vertical-align: top; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 8pt; font-weight: 800; }
  .badge-exact { background: #ffe4e6; color: #e11d48; }
  .badge-near { background: #ffedd5; color: #ea580c; }
  .badge-semantic { background: #f5f3ff; color: #7c3aed; }
  .badge-review { background: #fef9c3; color: #ca8a04; }
  .passage-card { border: 1px solid #e4e4e7; border-radius: 8px; padding: 14px; margin-bottom: 14px; background: #fff; page-break-inside: avoid; }
  .passage-flex { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
  .passage-col { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 6px; padding: 10px; font-size: 9pt; }
  .passage-col h5 { margin: 0 0 6px; font-size: 8.5pt; color: #52525b; text-transform: uppercase; }
  .disclaimer-box { background: #fafafa; border-left: 4px solid #7c3aed; padding: 14px 18px; margin: 25px 0; font-size: 9pt; color: #3f3f46; border-radius: 0 8px 8px 0; }
  .footer { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8pt; color: #a1a1aa; border-top: 1px solid #e4e4e7; padding-top: 8px; }
</style>
</head>
<body>

<!-- PAGE 1: COVER -->
<div class="page">
  <div class="header">
    <div>
      <div class="logo">Check<span>ra</span></div>
      <div class="tagline">Check • Verify • Improve • <a href="https://nivora-niva.vercel.app/" target="_blank" style="color:#7c3aed; text-decoration:none;">A NIVORA Product</a></div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:800; font-size:10pt; color:#18181b;">WRITING INTEGRITY REPORT</div>
      <div style="font-size:9pt; color:#71717a;">ID: ${escapeHtml(data.analysisId)}</div>
    </div>
  </div>

  <div class="title-block">
    <div style="font-size:11pt; color:#71717a; margin-bottom:8px;">DOCUMENT INTEGRITY & SIMILARITY ANALYSIS</div>
    <h1>${escapeHtml(doc.title)}</h1>
    <div style="color:#71717a; font-size:10pt;">Generated on ${new Date(data.timestamp).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
    
    <div class="score-badge"></div>
    <div>
      <span class="grade-pill">${escapeHtml(sim.gradeLabel)}: Grade ${escapeHtml(sim.grade)}</span>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><b>Analysis Identifier</b> ${escapeHtml(data.analysisId)}</div>
    <div class="meta-item"><b>Overall Similarity</b> ${sim.score}% (Grade ${escapeHtml(sim.grade)})</div>
    <div class="meta-item"><b>Web Sources Retrieved</b> ${data.sources?.retrievedCount ?? (data.sourcesRetrievedCount ?? sources.length)} sources</div>
    <div class="meta-item"><b>Topically Related Sources</b> ${data.sources?.topicalCount ?? 0} sources</div>
    <div class="meta-item"><b>Possible Matching Sources</b> ${data.sources?.possibleCount ?? 0} sources</div>
    <div class="meta-item"><b>Verified Matching Sources</b> ${data.sources?.matchingCount ?? (data.matchingSourcesCount ?? sources.filter(s => (s.similarity || 0) > 0).length)} sources</div>
    <div class="meta-item"><b>Exact Match Coverage</b> ${sim.coverage?.exactPercent ?? 0}%</div>
    <div class="meta-item"><b>Near Match Coverage</b> ${sim.coverage?.nearPercent ?? 0}%</div>
    <div class="meta-item"><b>Semantic Paraphrase Coverage</b> ${sim.coverage?.semanticPercent ?? 0}%</div>
    <div class="meta-item"><b>Document Word Count</b> ${doc.wordCount.toLocaleString()} words</div>
    <div class="meta-item"><b>AI Evidence Review</b> ${escapeHtml(data.aiReview?.status === "SUCCESS" || data.aiReview?.status === "completed" ? "Completed" : (data.aiReview?.status === "UNAVAILABLE" ? "Temporarily Unavailable" : (data.aiReview?.message || "Not configured")))}</div>
  </div>

  <div class="qr-box">
    ${qrDataUrl ? `<img src="${qrDataUrl}" alt="Verification QR Code">` : ""}
    <div class="qr-text">
      <strong>Checkra Verification Seal</strong><br>
      Scan QR code or visit <a href="${escapeHtml(data.verificationUrl)}">${escapeHtml(data.verificationUrl)}</a> to verify report authenticity without exposing document contents.
    </div>
  </div>

  <div class="footer">
    <span>Checkra Evidence-Based Integrity Platform • <a href="https://nivora-niva.vercel.app/" target="_blank" style="color:#71717a; text-decoration:none;">A NIVORA Product</a></span>
    <span>Page 1</span>
  </div>
</div>

<!-- PAGE 2: SUBMISSION INFORMATION & BREAKDOWN -->
<div class="page">
  <div class="header">
    <div class="logo" style="font-size:14pt;">Check<span>ra</span></div>
    <div style="font-size:9pt; color:#71717a;">${escapeHtml(data.analysisId)} · Page 2</div>
  </div>

  <div class="section-title">Submission Details</div>
  <div class="meta-grid">
    <div class="meta-item"><b>Document Title</b> ${escapeHtml(doc.title)}</div>
    <div class="meta-item"><b>Source Filename</b> ${escapeHtml(doc.filename)}</div>
    <div class="meta-item"><b>Word Count</b> ${doc.wordCount.toLocaleString()}</div>
    <div class="meta-item"><b>Character Count</b> ${doc.characterCount.toLocaleString()}</div>
    <div class="meta-item"><b>Page Count (Estimated)</b> ${doc.pageCount}</div>
    <div class="meta-item"><b>Estimated Reading Time</b> ${escapeHtml(doc.estimatedReadingTime)}</div>
  </div>

  <div class="section-title">Source Breakdown by Category</div>
  <table>
    <thead><tr><th>Category</th><th>Count</th><th>Description</th></tr></thead>
    <tbody>
      ${Object.entries(byType).map(([cat, count]) => `
        <tr>
          <td><strong>${escapeHtml(cat)}</strong></td>
          <td>${count}</td>
          <td>${cat === "Educational" ? "University or educational domain (.edu, .ac)" : cat === "Government" ? "Official government resource" : cat === "Journal / Publication" ? "Academic journal, preprint, or digital library" : "Public indexed web source"}</td>
        </tr>
      `).join("") || "<tr><td colspan='3'>No candidate sources detected.</td></tr>"}
    </tbody>
  </table>

  <div class="section-title">Methodology & Scoring System</div>
  <p style="font-size:9.5pt; color:#3f3f46; line-height:1.6;">${escapeHtml(sim.methodology || "Overall similarity is deterministically calculated as (Exact Coverage × 0.65) + (Near Coverage × 0.25) + (Semantic Coverage × 0.10). Score is derived strictly from verified source text matches.")}</p>

  <div class="footer">
    <span>Checkra Evidence-Based Integrity Platform • <a href="https://nivora-niva.vercel.app/" target="_blank" style="color:#71717a; text-decoration:none;">A NIVORA Product</a></span>
    <span>Page 2</span>
  </div>
</div>

<!-- PAGE 3: SOURCE SUMMARY -->
<div class="page">
  <div class="header">
    <div class="logo" style="font-size:14pt;">Check<span>ra</span></div>
    <div style="font-size:9pt; color:#71717a;">${escapeHtml(data.analysisId)} · Page 3</div>
  </div>

  <div class="section-title">Verified Sources Summary</div>
  <table>
    <thead>
      <tr>
        <th style="width:40px;">#</th>
        <th>Source Title & URL</th>
        <th style="width:110px;">Classification</th>
        <th style="width:70px;">Match %</th>
        <th style="width:80px;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${sources.map((src, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>
            <strong>${escapeHtml(src.title || "Untitled Source")}</strong><br>
            <span style="font-size:8pt; color:#71717a; word-break:break-all;">${escapeHtml(src.url || "")}</span>
          </td>
          <td>${escapeHtml(src.sourceType || "Unclassified")}</td>
          <td><strong>${src.similarity || 0}%</strong></td>
          <td><span class="badge ${src.status === "VERIFIED" ? "badge-semantic" : "badge-review"}">${escapeHtml(src.status || "VERIFIED")}</span></td>
        </tr>
      `).join("") || "<tr><td colspan='5'>No verified matching sources found.</td></tr>"}
    </tbody>
  </table>

  ${(data.sources?.topicalSources && data.sources.topicalSources.length > 0) ? `
    <div class="section-title" style="margin-top:25px;">Topically Related Sources Reviewed (Non-Plagiarism Context)</div>
    <p style="font-size:8.5pt; color:#71717a; margin-bottom:8px;">The following sources discuss related subject matter and share domain terminology, but contain no evidence of textual derivation or paraphrasing.</p>
    <table>
      <thead>
        <tr>
          <th style="width:40px;">#</th>
          <th>Source Title & URL</th>
          <th style="width:140px;">Relationship</th>
          <th style="width:90px;">Alignment</th>
        </tr>
      </thead>
      <tbody>
        ${data.sources.topicalSources.slice(0, 8).map((src, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>
              <strong>${escapeHtml(src.title || "Web Source")}</strong><br>
              <span style="font-size:8pt; color:#71717a; word-break:break-all;">${escapeHtml(src.url || "")}</span>
            </td>
            <td>Topical Similarity</td>
            <td>${src.similarity || 50}% Topical</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : ""}

  <div class="footer">
    <span>Checkra Evidence-Based Integrity Platform • <a href="https://nivora-niva.vercel.app/" target="_blank" style="color:#71717a; text-decoration:none;">A NIVORA Product</a></span>
    <span>Page 3</span>
  </div>
</div>

<!-- PAGE 4+: DETAILED MATCHES & EVIDENCE -->
<div class="page">
  <div class="header">
    <div class="logo" style="font-size:14pt;">Check<span>ra</span></div>
    <div style="font-size:9pt; color:#71717a;">${escapeHtml(data.analysisId)} · Detailed Matches</div>
  </div>

  <div class="section-title">Detailed Passage Matching</div>
  ${passages.slice(0, 15).map((p, idx) => `
    <div class="passage-card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span class="badge ${p.type === "EXACT" ? "badge-exact" : p.type === "NEAR" ? "badge-near" : "badge-semantic"}">${escapeHtml(p.type)} MATCH</span>
          <strong style="margin-left:8px; font-size:9pt;">Match #${idx + 1} · ${p.similarityScore || 100}% Similarity</strong>
        </div>
        <div style="font-size:8pt; color:#71717a;">Source: ${escapeHtml(p.sourceTitle || p.sourceUrl || "Web Source")}</div>
      </div>
      <div class="passage-flex">
        <div class="passage-col">
          <h5>Submitted Passage</h5>
          <div>${escapeHtml(p.submittedSentence || p.phrase || "")}</div>
        </div>
        <div class="passage-col">
          <h5>Verified Source Passage</h5>
          <div>${escapeHtml(p.sourceSentence || p.phrase || "")}</div>
        </div>
      </div>
    </div>
  `).join("") || "<p style='font-size:10pt; color:#71717a;'>No significant overlapping passages detected.</p>"}

  <div class="disclaimer-box">
    <strong>Mandatory Integrity Disclaimers:</strong><br><br>
    <strong>General Similarity:</strong> ${escapeHtml(DISCLAIMER_TEXT)}<br><br>
    <strong>AI Review / AI Writing:</strong> ${escapeHtml(AI_DISCLAIMER_TEXT)}
  </div>

  <div class="footer">
    <span>Checkra Evidence-Based Integrity Platform • <a href="https://nivora-niva.vercel.app/" target="_blank" style="color:#71717a; text-decoration:none;">A NIVORA Product</a></span>
    <span>End of Report</span>
  </div>
</div>

</body>
</html>`;
}

module.exports = {
  generateReportPackage,
  DISCLAIMER_TEXT,
  AI_DISCLAIMER_TEXT
};
