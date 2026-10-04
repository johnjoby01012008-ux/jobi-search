import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Toggle a result as a favourite for the signed-in user. */
export const toggleFavorite = mutation({
  args: { resultId: v.id("searchResults") },
  handler: async (ctx, { resultId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("You must be signed in.");

    const result = await ctx.db.get(resultId);
    if (!result || result.userId !== userId) throw new ConvexError("Result not found.");

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_result", (q) => q.eq("userId", userId).eq("resultId", resultId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { favorited: false };
    }

    await ctx.db.insert("favorites", {
      userId,
      searchId: result.searchId,
      resultId,
      hotelName: result.canonicalHotelName || result.hotelName,
      providerName: result.providerName,
      totalPrice: result.totalPrice,
      currency: result.currency,
      createdAt: Date.now(),
    });
    return { favorited: true };
  },
});

/** The signed-in user's favourites. */
export const listFavorites = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
  },
});

/** Which of a set of results are favourited by the current user. */
export const favoriteIds = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [] as string[];
    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return favorites
      .filter((f) => f.searchId === searchId)
      .map((f) => f.resultId as string);
  },
});
