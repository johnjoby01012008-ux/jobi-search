import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { parsedQueryValidator } from "./schema";
import { CURRENCY, initialStages, RATE_LIMITS, SEARCH_FEE_RUPEES } from "./jobi/config";
import { isValidParsedQuery } from "./jobi/parse";
import { canAccessRecord } from "./jobi/access";
import { canRevealBookingUrl, redactSearchResults } from "./jobi/urlLock";
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
 * Create a draft search (status "created"). No research runs until the ₹10
 * payment is verified, so this is cheap and free for the user.
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
      status: "created",
      stages: initialStages(),
      amountPaid: SEARCH_FEE_RUPEES,
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
 * IMPORTANT: booking URLs are stripped out before the rows leave the server.
 * The client must call `revealBookingUrl` — which re-checks the verified
 * payment — to obtain the actual link. Hiding the URL in the UI would not be
 * enough; it is never sent to an unpaid client in the first place.
 */
export const getResults = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const search = await ctx.db.get(searchId);
    if (!canAccessRecord(search, userId)) return [];
    const unlocked = await hasVerifiedPayment(ctx, searchId, userId);
    const results = await ctx.db
      .query("searchResults")
      .withIndex("by_search", (q) => q.eq("searchId", searchId))
      .collect();
    const sorted = results.sort((a, b) => {
      if (a.isCheapestVerified !== b.isCheapestVerified) return a.isCheapestVerified ? -1 : 1;
      const rank = (s: string) => (s === "verified" ? 0 : s === "observed" ? 1 : 2);
      if (rank(a.priceStatus) !== rank(b.priceStatus)) return rank(a.priceStatus) - rank(b.priceStatus);
      return (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity);
    });
    return redactSearchResults(sorted, unlocked);
  },
});

/** True only when a server-verified, paid payment exists for the search. */
async function hasVerifiedPayment(
  ctx: QueryCtx,
  searchId: Id<"searches">,
  userId: Id<"users">,
): Promise<boolean> {
  const search = await ctx.db.get(searchId);
  const payment = await ctx.db
    .query("searchPayments")
    .withIndex("by_search", (q) => q.eq("searchId", searchId))
    .first();
  return canRevealBookingUrl(payment, search, userId);
}

/**
 * Return the booking URL for one result — only if the ₹10 payment for its
 * search has been verified server-side. This is the ONLY path that ever emits a
 * booking URL to the client.
 */
export const revealBookingUrl = mutation({
  args: { resultId: v.id("searchResults") },
  handler: async (ctx, { resultId }) => {
    const userId = await requireUserId(ctx);
    const result = await ctx.db.get(resultId);
    if (!result || result.userId !== userId) {
      throw new ConvexError("That result could not be found.");
    }
    const search = await ctx.db.get(result.searchId);
    const payment = await ctx.db
      .query("searchPayments")
      .withIndex("by_search", (q) => q.eq("searchId", result.searchId))
      .first();

    if (!canRevealBookingUrl(payment, search, userId)) {
      throw new ConvexError(
        "Complete the ₹10 payment to reveal this booking link.",
      );
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
