import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { searchCacheTtlSeconds } from "./jobi/config";

/**
 * Shared search cache.
 *
 * The `SearXNGClient` keeps a fast in-process cache, but that only helps a
 * single worker. This table-backed cache makes the de-duplication hold across
 * every Convex worker and deployment, so 20 users searching the same trip
 * trigger at most one upstream SearXNG query per TTL window.
 *
 * Entries are keyed by the NORMALISED query (see `cacheKeyForQuery`). Expired
 * entries are treated as misses and pruned opportunistically on write.
 */

/** Read a cached result set. Expired or missing entries return null. */
export const getEntry = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const entry = await ctx.db
      .query("searchCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) return null;
    return entry.results ?? null;
  },
});

/** Upsert a result set for `ttlSeconds` and prune expired rows. */
export const putEntry = internalMutation({
  args: {
    key: v.string(),
    query: v.string(),
    results: v.any(),
    ttlSeconds: v.optional(v.number()),
  },
  handler: async (ctx, { key, query, results, ttlSeconds }) => {
    const now = Date.now();
    const ttl = ttlSeconds && ttlSeconds > 0 ? ttlSeconds : searchCacheTtlSeconds();

    const existing = await ctx.db
      .query("searchCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { results, expiresAt: now + ttl * 1000 });
    } else {
      await ctx.db.insert("searchCache", {
        key,
        query,
        results,
        expiresAt: now + ttl * 1000,
        createdAt: now,
      });
    }

    // Opportunistic cleanup so the table does not grow without bound.
    const expired = await ctx.db
      .query("searchCache")
      .withIndex("by_expires", (q) => q.lte("expiresAt", now))
      .take(20);
    for (const row of expired) {
      if (row._id !== existing?._id) await ctx.db.delete(row._id);
    }
  },
});

/** Remove every cache row (admin / maintenance). */
export const clear = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("searchCache").collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});