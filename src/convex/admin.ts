import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { ROLES } from "./schema";

/** Whether the signed-in user is an admin (drives the admin nav link). */
export const isAdmin = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    const user = await ctx.db.get(userId);
    return user?.role === ROLES.ADMIN;
  },
});

/** Aggregate research-quality + business metrics. Admin only. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (user?.role !== ROLES.ADMIN) return null;

    const searches = await ctx.db.query("searches").order("desc").take(500);
    const bookings = await ctx.db.query("bookings").order("desc").take(500);
    const hotels = await ctx.db.query("hotels").take(500);

    const paid = searches.filter((s) => s.paidAt !== undefined);
    const completed = searches.filter((s) => s.status === "completed");
    const failed = searches.filter((s) => s.status === "failed");
    const partial = searches.filter((s) => s.status === "partial");
    const revenue = paid.reduce((sum, s) => sum + (s.amountPaid ?? 0), 0);

    const withMetrics = searches.filter((s) => s.metrics);
    const avg = (pick: (s: (typeof searches)[number]) => number) =>
      withMetrics.length === 0
        ? 0
        : Math.round(
            withMetrics.reduce((sum, s) => sum + pick(s), 0) / withMetrics.length,
          );

    const activeBookings = bookings.filter(
      (b) => b.status === "reserved" || b.status === "confirmed",
    ).length;
    const cancelledBookings = bookings.filter((b) => b.status === "cancelled").length;
    const bookedValue = bookings
      .filter((b) => b.status !== "cancelled")
      .reduce((sum, b) => sum + b.totalPrice, 0);

    return {
      totalProperties: hotels.length,
      totalBookings: bookings.length,
      activeBookings,
      cancelledBookings,
      bookedValue,
      totalSearches: searches.length,
      paidSearches: paid.length,
      completedSearches: completed.length,
      failedSearches: failed.length,
      partialSearches: partial.length,
      revenue,
      currency: "INR",
      avgDurationMs: avg((s) => s.metrics?.durationMs ?? 0),
      avgSources: avg((s) => s.metrics?.sourcesRead ?? 0),
      avgVerifiedOffers: avg((s) => s.metrics?.offersVerified ?? 0),
    };
  },
});

/** Recent searches with a light row shape for the admin table. */
export const listSearches = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (user?.role !== ROLES.ADMIN) return [];

    const searches = await ctx.db.query("searches").order("desc").take(100);
    return await Promise.all(
      searches.map(async (s) => {
        const owner = await ctx.db.get(s.userId);
        return {
          _id: s._id,
          user: owner?.email ?? owner?.name ?? "unknown",
          destination: s.parsed.destination,
          status: s.status,
          amountPaid: s.amountPaid,
          currency: s.currency,
          cheapestVerified: s.metrics?.cheapestVerified,
          sourcesChecked: s.metrics?.sourcesRead ?? 0,
          createdAt: s.createdAt,
          demoMode: s.demoMode,
        };
      }),
    );
  },
});
