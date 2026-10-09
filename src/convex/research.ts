import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { normalizeHotelName } from "./jobi/matching";
import { PRICE_DISCLAIMER, SEARCH_UNAVAILABLE_MESSAGE, searchCacheTtlSeconds } from "./jobi/config";
import { CachedResearchProvider, type SharedSearchCache } from "./jobi/providers/cachedProvider";
import { createResearchProvider } from "./jobi/providers";
import { runResearch } from "./jobi/engine";
import type { Comparison } from "./jobi/types";

/**
 * Mark every earlier pipeline stage done and the named stage active. Each call
 * reflects a real transition in the research engine — never a timer.
 */
export const markStage = internalMutation({
  args: { searchId: v.id("searches"), key: v.string() },
  handler: async (ctx, { searchId, key }) => {
    const search = await ctx.db.get(searchId);
    if (!search) return;
    const activeIndex = search.stages.findIndex((stage) => stage.key === key);
    if (activeIndex === -1) return;
    const stages = search.stages.map((stage, index) => {
      if (index < activeIndex) return { ...stage, status: "done" as const };
      if (index === activeIndex) return { ...stage, status: "active" as const };
      return { ...stage, status: "pending" as const };
    });
    await ctx.db.patch(searchId, { stages, status: "researching" });
  },
});

export const failSearch = internalMutation({
  args: { searchId: v.id("searches"), error: v.string() },
  handler: async (ctx, { searchId, error }) => {
    const search = await ctx.db.get(searchId);
    if (!search) return;
    await ctx.db.patch(searchId, {
      status: "failed",
      error,
      completedAt: Date.now(),
      stages: search.stages.map((s) => ({ ...s, status: "skipped" as const })),
    });
  },
});

export const persistResults = internalMutation({
  args: {
    searchId: v.id("searches"),
    offers: v.array(v.any()),
    metrics: v.any(),
    report: v.any(),
    status: v.union(v.literal("completed"), v.literal("partial")),
  },
  handler: async (ctx, { searchId, offers, metrics, report, status }) => {
    const search = await ctx.db.get(searchId);
    if (!search) return;
    const userId = search.userId;

    // Clear any previous results (idempotent re-runs).
    const existing = await ctx.db
      .query("searchResults")
      .withIndex("by_search", (q) => q.eq("searchId", searchId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const comparison = report.comparison as Comparison | undefined;
    const cheapestVerifiedTotal = comparison?.cheapestVerified?.total;

    for (const offer of offers as Array<Record<string, unknown>>) {
      const total = offer.totalPrice as number | undefined;
      const hotelName = offer.hotelName as string;
      const canonicalName = (offer.canonicalHotelName as string | undefined) ?? hotelName;
      const isCheapestVerified =
        comparison?.cheapestVerified !== undefined &&
        cheapestVerifiedTotal !== undefined &&
        total === cheapestVerifiedTotal &&
        offer.priceStatus === "verified" &&
        offer.providerName === comparison.cheapestVerified.offer.providerName;

      // Upsert a canonical hotel entity for the matching system.
      const normalized = normalizeHotelName(canonicalName);
      const existingEntity = await ctx.db
        .query("hotelEntities")
        .withIndex("by_normalized", (q) =>
          q.eq("normalizedName", normalized).eq("destination", search.parsed.destination),
        )
        .first();
      let hotelEntityId = existingEntity?._id;
      if (!hotelEntityId) {
        hotelEntityId = await ctx.db.insert("hotelEntities", {
          canonicalName,
          normalizedName: normalized,
          destination: search.parsed.destination,
          address: offer.hotelAddress as string | undefined,
          aliases: [hotelName],
          createdAt: Date.now(),
        });
      }

      const resultId = await ctx.db.insert("searchResults", {
        searchId,
        userId,
        hotelEntityId,
        canonicalHotelName: canonicalName,
        matchConfidence: (offer.matchConfidence as "high" | "medium" | "low") ?? "high",
        providerName: offer.providerName as string,
        hotelName,
        roomName: offer.roomName as string | undefined,
        bookingUrl: offer.bookingUrl as string,
        sourceUrl: offer.sourceUrl as string,
        basePrice: offer.basePrice as number | undefined,
        taxes: offer.taxes as number | undefined,
        mandatoryFees: offer.mandatoryFees as number | undefined,
        totalPrice: total,
        currency: offer.currency as string,
        priceStatus: offer.priceStatus as "verified" | "observed" | "estimated" | "unknown",
        confidence: offer.confidence as "high" | "medium" | "low",
        mealPlan: offer.mealPlan as string | undefined,
        cancellationPolicy: offer.cancellationPolicy as string | undefined,
        checkedAt: offer.checkedAt as string,
        rating: offer.rating as number | undefined,
        imageUrl: offer.imageUrl as string | undefined,
        amenities: offer.amenities as string[] | undefined,
        isCheapestVerified,
        savingsVsAverage: isCheapestVerified
          ? (comparison?.savingsVsAverage as number | undefined)
          : undefined,
        metadata: {
          notes: offer.notes,
          sourceDomain: safeHost(offer.sourceUrl as string),
          matchConfidence: offer.matchConfidence,
          differences: (offer.comparisonDifferences as string[] | undefined) ?? [],
        },
      });

      await ctx.db.insert("hotelProviderMatches", {
        hotelEntityId,
        providerName: offer.providerName as string,
        providerHotelName: hotelName,
        matchConfidence: (offer.matchConfidence as "high" | "medium" | "low") ?? "high",
        signals: ["name", "destination"],
        createdAt: Date.now(),
      });

      void resultId;
    }

    await ctx.db.patch(searchId, {
      status,
      metrics,
      report: {
        sourcesChecked: report.sourcesChecked,
        unavailable: report.unavailable,
        limitations: [...report.limitations, PRICE_DISCLAIMER],
        checkedAt: report.checkedAt,
      },
      completedAt: Date.now(),
      stages: search.stages.map((s) => ({ ...s, status: "done" as const })),
    });

    await ctx.db.insert("auditLogs", {
      userId,
      searchId,
      action: "research_completed",
      detail: `${metrics.offersFound} offers, ${metrics.offersVerified} verified`,
      createdAt: Date.now(),
    });
  },
});

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The deep-search entry point. Scheduled right after a payment is verified. */
export const runSearch = internalAction({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const search = await ctx.runQuery(internal.research.getSearchInternal, { searchId });
    if (!search) return;

    const searchDoc = await ctx.runQuery(internal.research.getSearchInternal, { searchId });
    if (!searchDoc) return;

    const { providers, demoMode } = createResearchProvider(process.env, searchDoc.parsed);
    // `runResearch` owns the provider interface; it only ever uses a single provider's
    // `.search`, so a single live provider is enough even when more are configured.
    const provider = providers[0];

    // Wrap the live provider in the shared, cross-worker cache so identical
    // queries are only sent to SearXNG once per TTL window. The mock provider
    // needs no caching (it is generated in-process already).
    const sharedCache: SharedSearchCache = {
      get: async (key) => (await ctx.runQuery(internal.searchCache.getEntry, { key })) ?? null,
      set: async (key, query, results, ttlSeconds) => {
        await ctx.runMutation(internal.searchCache.putEntry, {
          key,
          query,
          results,
          ttlSeconds,
        });
      },
    };
    const searchProvider = demoMode
      ? provider
      : new CachedResearchProvider(provider, sharedCache, {
          ttlSeconds: searchCacheTtlSeconds(process.env),
        });

    try {
      const result = await runResearch({
        parsed: search.parsed,
        provider: searchProvider,
        hooks: {
          onStage: async (key) => {
            await ctx.runMutation(internal.research.markStage, { searchId, key });
          },
        },
      });

      // If every query failed, the search layer itself is unavailable. Fail
      // with a clean application-level message instead of a confusing partial
      // result that leaks internals.
      if (result.metrics.queriesRun === 0) {
        await ctx.runMutation(internal.research.failSearch, {
          searchId,
          error: SEARCH_UNAVAILABLE_MESSAGE,
        });
        return;
      }

      const status =
        result.comparison.verified.length === 0 || result.metrics.truncated
          ? "partial"
          : "completed";

      await ctx.runMutation(internal.research.persistResults, {
        searchId,
        offers: result.offers,
        metrics: { ...result.metrics, demoMode },
        report: { ...result.report, comparison: result.comparison },
        status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Research failed";
      await ctx.runMutation(internal.research.failSearch, { searchId, error: message });
    }
  },
});

export const getSearchInternal = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    return await ctx.db.get(searchId);
  },
});

export type { Id };
