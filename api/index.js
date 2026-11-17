/**
 * Checkra — Vercel Serverless Function Entry Point
 *
 * Bridges incoming Vercel serverless requests to the Checkra Express application.
 * Normalizes request paths if stripped by upstream rewrites and delegates execution.
 */

const app = require("../server/server");

module.exports = (req, res) => {
  // Normalize path if a rewrite forwarded a path without /api prefix
  if (
    !req.url.startsWith("/api") &&
    !req.url.startsWith("/verify") &&
    req.url !== "/" &&
    !req.url.startsWith("/?")
  ) {
    const urlWithoutQuery = req.url.split("?")[0];
    const knownApiPaths = [
      "/health",
      "/extract",
      "/analyze",
      "/rewrite",
      "/grammar",
      "/report",
      "/reports",
      "/test-document",
      "/settings",
      "/analysis"
    ];
    if (knownApiPaths.some(p => urlWithoutQuery === p || urlWithoutQuery.startsWith(p + "/"))) {
      req.url = "/api" + req.url;
    }
  }

  try {
    return app(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({
        success: false,
        error: {
          code: "SERVERLESS_INVOCATION_ERROR",
          message: err.message || "Serverless execution error."
        }
      });
    }
  }
};
