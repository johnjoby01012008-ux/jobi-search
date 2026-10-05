import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
  detectSearXNGConfig,
  searchWeb,
  SearchMalformedResponseError,
} from "./jobi/search/searxng";

/**
 * Internal diagnostics for the SearXNG search layer.
 *
 * These are `internalAction`s: they are NOT callable from the browser, so they
 * can never leak the SearXNG URL or any server configuration to the frontend.
 * Run them from the CLI or the Convex dashboard:
 *
 *   bunx convex run searchWeb:searxngHealth
 *   bunx convex run searchWeb:debugSearch '{"query":"hotels in Goa December 12 2026 2 guests"}'
 */

/** Report whether SearXNG is configured, reachable and returning results. */
export const searxngHealth = internalAction({
  args: {},
  handler: async () => {
    const config = detectSearXNGConfig(process.env);
    if (!config) {
      return { ok: false, configured: false, reason: "SEARXNG_URL is not set" };
    }

    const startedAt = Date.now();
    try {
      const results = await searchWeb("hotels in Goa India", { env: process.env });
      return {
        ok: true,
        configured: true,
        resultCount: results.length,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const reason =
        error instanceof SearchMalformedResponseError
          ? "malformed_response"
          : "unreachable";
      // Never surface the internal URL or raw error to a caller.
      return { ok: false, configured: true, reason, latencyMs: Date.now() - startedAt };
    }
  },
});

/** Run a single raw query and return a compact, secret-free summary. */
export const debugSearch = internalAction({
  args: { query: v.string() },
  handler: async (_ctx, { query }) => {
    const startedAt = Date.now();
    try {
      const results = await searchWeb(query, { env: process.env });
      return {
        ok: true,
        count: results.length,
        latencyMs: Date.now() - startedAt,
        // Only the normalized shape — no environment or internal URLs.
        results: results.slice(0, 5),
      };
    } catch {
      return { ok: false, count: 0, latencyMs: Date.now() - startedAt, results: [] };
    }
  },
});
