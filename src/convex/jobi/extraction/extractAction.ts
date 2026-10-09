"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { resolveExtractionBackendConfig, extractBatch, ExtractionServiceError } from "./fetch";
import { extractOffers } from "./normalize";
import type { ParsedQuery } from "../types";
import type { Id } from "../../_generated/dataModel";
import { getSearchInternal } from "../../research";

/** Run extraction for one search session: many URLs, one set of dates/guests. */
export const runExtraction = internalAction({
  args: {
    searchId: v.id("searches"),
    parsed: v.object({
      destination: v.string(),
      checkIn: v.string(),
      checkOut: v.string(),
      guests: v.number(),
      rooms: v.number(),
    }),
    urls: v.array(v.string()),
  },
  handler: async (ctx: any, args: { searchId: Id<"searches">; parsed: ParsedQuery; urls: string[] }) => {
    const search = await ctx.runQuery(getSearchInternal, { searchId: args.searchId });
    if (!search) return { success: false, reason: "search_not_found" };

    const config = resolveExtractionBackendConfig(process.env);
    if (!config || !config.enabled) {
      return {
        success: false,
        reason: "extraction_backend_disabled",
        details: { message: "BACKEND_EXTRACTOR_URL is not configured" },
      };
    }

    const capped = args.urls.slice(0, config.maxUrlsPerBatch);
    const trimmedUrls: string[] = [];
    for (const url of capped) {
      try {
        const parsedUrl = new URL(url);
        if (["http:", "https:"].includes(parsedUrl.protocol)) {
          trimmedUrls.push(url);
        }
      } catch {
        // Skip malformed URLs.
      }
    }

    if (trimmedUrls.length === 0) {
      return {
        success: false,
        reason: "no_valid_urls",
        details: { message: "No valid URLs to extract" },
      };
    }

    const request = {
      urls: trimmedUrls,
      check_in: args.parsed.checkIn,
      check_out: args.parsed.checkOut,
      guests: args.parsed.guests,
      rooms: args.parsed.rooms,
      timeout_seconds: Math.round(config.timeoutMs / 1000),
    };

    const startedAt = Date.now();
    let result;
    try {
      result = await extractBatch(config, request);
    } catch (error) {
      const message = error instanceof ExtractionServiceError
        ? error.message
        : "extraction backend request failed";
      return {
        success: false,
        reason: "extraction_backend_error",
        details: { message, status: (error as ExtractionServiceError).status ?? 0 },
      };
    } finally {
      const durationMs = Date.now() - startedAt;
      console.log(
        JSON.stringify({
          event: "extraction_run",
          searchId: args.searchId,
          urlsConsidered: trimmedUrls.length,
          successfulOffers: result?.successful?.filter((r) => r.success).length ?? 0,
          failedUrls: result?.failed?.length ?? 0,
          durationMs,
        }),
      );
    }

    const offers = extractOffers(result.successful, new Date().toISOString());
    const failed = result.failed;

    return {
      success: true,
      offers,
      failed,
      metrics: {
        urlsConsidered: trimmedUrls.length,
        successfulOffers: offers.length,
        failedUrls: failed.length,
        durationMs: Date.now() - startedAt,
        jsonldFound: result.successful.some((r) => r.jsonld_found),
        playwrightUsed: result.successful.some((r) => r.playwright_used),
      },
    };
  },
});
