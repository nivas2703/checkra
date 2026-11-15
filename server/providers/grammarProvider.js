/**
 * VeriWrite Grammar & Style Engine
 * Multi-provider architecture:
 * 1. LanguageTool API endpoint adapter (if GRAMMAR_API_URL is configured)
 * 2. LLM Grammar & Style adapter (if LLM is configured)
 * 3. High-precision built-in linguistic rules engine for offline/immediate checking
 */

const BUILT_IN_RULES = [
  {
    regex: /\b(their|there|they're)\b/gi,
    test: (match, text, offset) => {
      const window = text.slice(Math.max(0, offset - 15), Math.min(text.length, offset + 35)).toLowerCase();
      if (/\bthere\s+(cars?|houses?|dogs?|books?|data|systems?|methods?|results?|papers?|work|ideas?)\b/.test(window)) {
        return {
          original: match,
          replacement: "their",
          category: "Spelling",
          severity: "error",
          explanation: "Use 'their' for possessive nouns instead of 'there'."
        };
      }
      if (/\btheir\s+(is|are|was|were)\b/.test(window)) {
        return {
          original: match,
          replacement: "there",
          category: "Spelling",
          severity: "error",
          explanation: "Use 'there' to indicate existence instead of possessive 'their'."
        };
      }
      return null;
    }
  },
  {
    regex: /\b(in order to)\b/gi,
    finding: {
      category: "Conciseness & Clarity",
      severity: "suggestion",
      replacement: "to",
      explanation: "'In order to' is wordy. 'To' conveys the same meaning more directly."
    }
  },
  {
    regex: /\b(due to the fact that)\b/gi,
    finding: {
      category: "Clarity",
      severity: "suggestion",
      replacement: "because",
      explanation: "Replace 'due to the fact that' with 'because' or 'since' for stronger clarity."
    }
  },
  {
    regex: /\b(a broad variety of)\b/gi,
    finding: {
      category: "Word Choice",
      severity: "suggestion",
      replacement: "various",
      explanation: "Replace 'a broad variety of' with 'various' or 'many'."
    }
  },
  {
    regex: /\b(utilize|utilizes|utilized|utilizing)\b/gi,
    finding: {
      category: "Word Choice",
      severity: "suggestion",
      replacement: "use",
      explanation: "'Use' is generally preferred over 'utilize' in clear academic writing."
    }
  },
  {
    regex: /\b(irregardless)\b/gi,
    finding: {
      category: "Grammar",
      severity: "error",
      replacement: "regardless",
      explanation: "'Irregardless' is non-standard; use 'regardless'."
    }
  },
  {
    regex: /\b([a-z]+)\s+([a-z]+)\b/gi,
    test: (match, text, offset) => {
      const parts = match.toLowerCase().split(/\s+/);
      if (parts[0] === parts[1] && parts[0].length > 2 && !["that", "had"].includes(parts[0])) {
        return {
          original: match,
          replacement: parts[0],
          category: "Grammar",
          severity: "error",
          explanation: `Duplicated word '${parts[0]}'.`
        };
      }
      return null;
    }
  },
  {
    regex: /\s+([,;:?.!])/g,
    test: (match, text, offset) => {
      const punct = match.trim();
      return {
        original: match,
        replacement: punct + " ",
        category: "Punctuation",
        severity: "warning",
        explanation: "Unexpected whitespace before punctuation mark."
      };
    }
  },
  {
    regex: /\b(very|extremely|really)\s+([a-z]+)\b/gi,
    finding: {
      category: "Style",
      severity: "suggestion",
      replacement: "specific adjective",
      explanation: "Avoid weak intensifiers ('very', 'really'); prefer stronger, specific vocabulary."
    }
  }
];

async function checkWithLanguageTool(text, apiUrl) {
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("language", "en-US");

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!res.ok) throw new Error(`LanguageTool HTTP ${res.status}`);
  const data = await res.json();

  return (data.matches || []).map((m, idx) => ({
    id: `g_lt_${idx}`,
    category: m.rule?.category?.name || "Grammar",
    severity: m.rule?.issueType === "misspelling" ? "error" : "warning",
    original: text.slice(m.offset, m.offset + m.length),
    replacement: m.replacements?.[0]?.value || "",
    explanation: m.message,
    offset: m.offset,
    length: m.length
  }));
}

function runBuiltInRules(text) {
  const findings = [];
  let idCounter = 1;

  BUILT_IN_RULES.forEach(rule => {
    let match;
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    while ((match = regex.exec(text)) !== null) {
      if (rule.test) {
        const res = rule.test(match[0], text, match.index);
        if (res) {
          findings.push({
            id: `g_${idCounter++}`,
            category: res.category,
            severity: res.severity,
            original: res.original,
            replacement: res.replacement,
            explanation: res.explanation,
            offset: match.index,
            length: match[0].length
          });
        }
      } else if (rule.finding) {
        findings.push({
          id: `g_${idCounter++}`,
          category: rule.finding.category,
          severity: rule.finding.severity,
          original: match[0],
          replacement: rule.finding.replacement,
          explanation: rule.finding.explanation,
          offset: match.index,
          length: match[0].length
        });
      }
      if (findings.length >= 50) break;
    }
  });

  return findings;
}

async function checkGrammar(text, options = {}) {
  const ltUrl = options.grammarApiUrl || process.env.GRAMMAR_API_URL;

  if (ltUrl) {
    try {
      const results = await checkWithLanguageTool(text, ltUrl);
      return {
        provider: "LanguageTool",
        findings: results
      };
    } catch (e) {
      // Fallback to built-in rules
    }
  }

  const findings = runBuiltInRules(text);
  return {
    provider: "Checkra Linguistic Engine",
    findings
  };
}

module.exports = {
  checkGrammar
};
