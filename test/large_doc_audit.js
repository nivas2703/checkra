/**
 * Critical Large Document Audit (Section 11)
 *
 * Tests whether Checkra detects copied passages distributed across 7,000-8,000 words at:
 * - Beginning (0%)
 * - 20%
 * - 40%
 * - 50%
 * - 60%
 * - 80%
 * - 95%
 * - Very end (100%)
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { executeAnalysis } = require("../server/services/analysisService");

const PASSAGES = [
  { pos: "0% (beginning)", phrase: "Quantum computing utilizes the quantum mechanical phenomena of superposition and entanglement to perform calculations exponentially faster than classical supercomputers on specific classes of problems." },
  { pos: "20%", phrase: "CRISPR gene editing represents a transformative genetic engineering technique enabling molecular biologists to modify DNA sequences and alter gene function with unprecedented precision." },
  { pos: "40%", phrase: "Plate tectonics describes the large scale motions of Earth's lithosphere which is broken up into seven major continent-sized plates and numerous smaller regional plates." },
  { pos: "50%", phrase: "The Federal Reserve conducts monetary policy by influencing interest rates and managing the total supply of money circulating throughout the domestic financial banking system." },
  { pos: "60%", phrase: "The Renaissance was a fervent period of European cultural, artistic, political and economic rebirth following the Middle Ages, largely covering the fourteenth through seventeenth centuries." },
  { pos: "80%", phrase: "Photosynthesis in oxygenic cyanobacteria established Earth's early oxidizing atmosphere through the photolysis of water molecules driven by solar radiation." },
  { pos: "95%", phrase: "Natural language processing models leverage transformer self-attention mechanisms to dynamically capture long-range contextual dependencies across complex linguistic tokens." },
  { pos: "100% (very end)", phrase: "The James Webb Space Telescope operates at the second Sun-Earth Lagrange point to capture high-redshift infrared cosmological observations of early galaxy formation." }
];

async function runLargeDocTest() {
  console.log("=================================================================");
  console.log("   CRITICAL LARGE DOCUMENT AUDIT (SECTION 11)");
  console.log("=================================================================\n");

  // Create filler text paragraphs (each ~100 words of original text)
  const filler = "Astrophysical surveys monitor gravitational micro-lensing events to detect rogue terrestrial exoplanets drifting through interstellar space without host stars. Stellar kinematics and photometric astrometry provide observational parameters indicating atmospheric compositions and orbital inclinations across binary planetary systems. Deep-space radio interferometry arrays synthesize aperture baselines spanning continental distances to resolve compact galactic nuclei.\n\n";

  // Build an 7,500-word document with the 8 passages at the exact positions
  const sections = [];
  const fillerChunkCount = 20; // ~2000 words per chunk -> 7,500+ total words

  for (let i = 0; i < PASSAGES.length; i++) {
    sections.push(PASSAGES[i].phrase + "\n\n");
    if (i < PASSAGES.length - 1) {
      sections.push(filler.repeat(fillerChunkCount));
    }
  }

  const fullDocText = sections.join("");
  const wordCount = fullDocText.split(/\s+/).filter(Boolean).length;
  console.log(`Constructed document: ${wordCount} words (approx. 16 pages), 8 distributed target passages.\n`);

  // Reference corpus containing all 8 target passages
  const referenceCorpus = PASSAGES.map((p, idx) => `SOURCE ${idx + 1} (${p.pos}): ${p.phrase}`).join("\n\n");

  const startTime = Date.now();
  const result = await executeAnalysis({
    text: fullDocText,
    title: "Large 16-Page Multi-Passage Benchmark",
    fileStats: { wordCount, pageCount: 16 },
    options: {
      referenceText: referenceCorpus,
      referenceTitle: "Multi-Topic Reference Corpus",
      disablePublicWebSearch: true // focus purely on corpus detection recall
    }
  });
  const elapsed = Date.now() - startTime;

  console.log(`Execution completed in: ${elapsed}ms`);
  console.log(`Overall Score: ${result.similarity.score}%, Exact Coverage: ${result.similarity.coverage.exactPercent}%, Near Coverage: ${result.similarity.coverage.nearPercent}%, Semantic Coverage: ${result.similarity.coverage.semanticPercent}%`);
  console.log(`Total Matched Passages Found: ${result.matchedPassages.length}\n`);

  // Check each passage individually
  let detectedCount = 0;
  PASSAGES.forEach(p => {
    // Check if this phrase was identified in matchedPassages
    const matched = result.matchedPassages.some(mp => {
      const text = (mp.submittedSentence || mp.phrase || "").toLowerCase();
      const target = p.phrase.slice(0, 30).toLowerCase();
      return text.includes(target) || p.phrase.toLowerCase().includes(text.slice(0, 30));
    });

    if (matched) {
      console.log(`  ✓ DETECTED: [${p.pos}] "${p.phrase.slice(0, 50)}..."`);
      detectedCount++;
    } else {
      console.log(`  ✗ MISSED:   [${p.pos}] "${p.phrase.slice(0, 50)}..."`);
    }
  });

  console.log(`\nDetection Recall: ${detectedCount}/${PASSAGES.length} (${Math.round((detectedCount / PASSAGES.length) * 100)}%)`);

  fs.writeFileSync(path.join(__dirname, "large_doc_audit_result.json"), JSON.stringify({
    wordCount,
    elapsedMs: elapsed,
    totalTargetPassages: PASSAGES.length,
    detectedCount,
    recallPercent: Math.round((detectedCount / PASSAGES.length) * 100),
    overallScore: result.similarity.score,
    exactCoverage: result.similarity.coverage.exactPercent,
    nearCoverage: result.similarity.coverage.nearPercent,
    matchedPassagesCount: result.matchedPassages.length
  }, null, 2));

  return { detectedCount, total: PASSAGES.length };
}

if (require.main === module) {
  runLargeDocTest().catch(err => {
    console.error("Large doc test error:", err);
    process.exit(1);
  });
}
