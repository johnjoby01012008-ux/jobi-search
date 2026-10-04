import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { parsedQueryValidator } from "./schema";
import { CURRENCY, initialStages, RATE_LIMITS, SEARCH_FEE_RUPEES } from "./jobi/config";
import { isValidParsedQuery } from "./jobi/parse";
import { canAccessRecord } from "./jobi/access";

async function requireUserId(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("You must be signed in.");
  return userId;
}

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

/** Results for a search, cheapest verified first, then observed. */
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
