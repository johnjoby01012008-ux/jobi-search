import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { parsedQueryValidator } from "./schema";
import { CURRENCY, initialStages, RATE_LIMITS } from "./jobi/config";
import { isValidParsedQuery } from "./jobi/parse";
import { canAccessRecord } from "./jobi/access";
import { detectSearXNGConfig } from "./jobi/providers";

async function requireUserId(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("You must be signed in.");
  return userId;
}

/**
 * Report whether the live web-search layer (SearXNG) is actually configured.
 *
 * Without `SEARXNG_URL` the engine falls back to the mock provider, so the UI
 * can tell the user honestly whether a run searches real sources or demo data.
 * The SearXNG base URL itself is never returned to the client.
 */
export const researchSource = query({
  args: {},
  handler: async () => {
    const forcedDemo =
      process.env.JOBI_FORCE_DEMO === "1" || process.env.JOBI_FORCE_DEMO === "true";
    const config = forcedDemo ? null : detectSearXNGConfig(process.env);
    if (!config) {
      return { live: false, providerLabel: "Demo data", reason: "no_key" as const };
    }
    return { live: true, providerLabel: "SearXNG", reason: "configured" as const };
  },
});

/**
 * Create a free, ad-supported search and start the deep research immediately.
 *
 * There is no charge and no gate. Results include the booking URLs, and a
 * clearly labelled sponsored card sits between them (see `SearchDetail`).
 */
export const createSearch = mutation({
  args: {
    query: v.string(),
    parsed: parsedQueryValidator,
  },
  handler: async (ctx, { query, parsed }) => {
    const userId = await requireUserId(ctx);

    const trimmed = query.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      throw new ConvexError("Please describe your trip in a little more detail.");
    }
    if (!isValidParsedQuery(parsed)) {
      throw new ConvexError(
        "We couldn't understand the destination or dates. Please review the details.",
      );
    }

    // Rate limiting: cap searches per rolling hour and enforce a minimum gap.
    const since = Date.now() - 60 * 60 * 1000;
    const recent = await ctx.db
      .query("searches")
      .withIndex("by_user_created", (q) => q.eq("userId", userId).gte("createdAt", since))
      .collect();
    if (recent.length >= RATE_LIMITS.maxSearchesPerHour) {
      throw new ConvexError("Too many searches in the last hour. Please try again later.");
    }
    const last = recent.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (last && Date.now() - last.createdAt < RATE_LIMITS.minMsBetweenSearches) {
      throw new ConvexError("Please wait a few seconds before starting another search.");
    }

    const now = Date.now();
    const searchId = await ctx.db.insert("searches", {
      userId,
      query: trimmed,
      parsed,
      status: "researching",
      stages: initialStages(),
      currency: CURRENCY,
      demoMode: false,
      createdAt: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      searchId,
      action: "search_created",
      detail: `${parsed.destination} ${parsed.checkIn}→${parsed.checkOut}`,
      createdAt: now,
    });

    // Run the deep search immediately. The scheduler keeps the HTTP path fast.
    await ctx.scheduler.runAfter(0, internal.research.runSearch, {
      searchId,
    });

    return searchId;
  },
});

/** Fetch one search, enforcing ownership (Convex equivalent of RLS). */
export const getSearch = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const search = await ctx.db.get(searchId);
    if (!canAccessRecord(search, userId)) return null;
    return search;
  },
});

/** List the signed-in user's searches, newest first. */
export const listSearches = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    return searches;
  },
});

/**
 * Results for a search, cheapest verified first, then observed.
 *
 * Ownership is enforced server-side. Booking URLs are included in the result
 * rows, and the UI shows a labelled sponsored card between results — that is
 * the whole monetisation model.
 */
export const getResults = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const search = await ctx.db.get(searchId);
    if (!canAccessRecord(search, userId)) return [];
    const results = await ctx.db
      .query("searchResults")
      .withIndex("by_search", (q) => q.eq("searchId", searchId))
      .collect();
    return results.sort((a, b) => {
      if (a.isCheapestVerified !== b.isCheapestVerified) return a.isCheapestVerified ? -1 : 1;
      const rank = (s: string) => (s === "verified" ? 0 : s === "observed" ? 1 : 2);
      if (rank(a.priceStatus) !== rank(b.priceStatus)) return rank(a.priceStatus) - rank(b.priceStatus);
      return (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity);
    });
  },
});

/**
 * Return the booking URL for one result.
 *
 * The URL is already included in `getResults`; the UI routes the click through
 * this mutation so every reveal is audit-logged server-side
 * (`booking_url_revealed`).
 */
export const revealBookingUrl = mutation({
  args: { resultId: v.id("searchResults") },
  handler: async (ctx, { resultId }) => {
    const userId = await requireUserId(ctx);
    const result = await ctx.db.get(resultId);
    if (!result || result.userId !== userId) {
      throw new ConvexError("That result could not be found.");
    }

    await ctx.db.insert("auditLogs", {
      userId,
      searchId: result.searchId,
      action: "booking_url_revealed",
      detail: result.providerName,
      createdAt: Date.now(),
    });

    return { bookingUrl: result.bookingUrl, providerName: result.providerName };
  },
});
