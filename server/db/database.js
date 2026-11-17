/**
 * VeriWrite Session & Settings Store (No Permanent History)
 * As required: Analysis history is completely removed.
 * Only holds active session data in memory and configuration settings.
 */

const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = process.env.VERCEL
  ? path.join("/tmp", "checkra-settings.json")
  : path.join(__dirname, "../../data/settings.json");

const DEFAULT_SETTINGS = {
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  searchApiUrl: process.env.SEARCH_API_URL || "",
  searchApiKey: process.env.SEARCH_API_KEY || "",
  searchEngine: process.env.SEARCH_ENGINE || "",
  grammarApiUrl: process.env.GRAMMAR_API_URL || "",
  grammarApiKey: process.env.GRAMMAR_API_KEY || "",
  embeddingApiUrl: process.env.EMBEDDING_API_URL || "",
  embeddingApiKey: process.env.EMBEDDING_API_KEY || "",
  maxSearchQueries: Number(process.env.MAX_SEARCH_QUERIES || 8),
  maxSources: Number(process.env.MAX_SOURCES || 20),
  minMatchLength: 6,
  ignoreQuotations: false,
  ignoreBibliography: true,
  ignoreCitations: true
};

class SessionStore {
  constructor() {
    this.settings = this._loadSettings();
    // In-memory ephemeral session cache (cleared on reload/restart, no permanent history)
    this.activeSessions = new Map();
  }

  _loadSettings() {
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch (e) {
      // ignore
    }
    return { ...DEFAULT_SETTINGS };
  }

  getSettings() {
    return { ...this.settings };
  }

  updateSettings(updates) {
    this.settings = { ...this.settings, ...updates };
    try {
      const dir = path.dirname(SETTINGS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(this.settings, null, 2), "utf8");
    } catch (e) {
      // Non-fatal
    }
    return this.settings;
  }

  generateAnalysisId() {
    const year = new Date().getFullYear();
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `VW-${year}-${code}`;
  }

  // Ephemeral current session only (max 10 recent in-memory sessions for report export)
  setSessionAnalysis(analysis) {
    if (this.activeSessions.size > 10) {
      const oldestKey = this.activeSessions.keys().next().value;
      this.activeSessions.delete(oldestKey);
    }
    this.activeSessions.set(analysis.id, analysis);
    return analysis;
  }

  getSessionAnalysis(id) {
    return this.activeSessions.get(id) || null;
  }
}

const store = new SessionStore();
module.exports = store;
