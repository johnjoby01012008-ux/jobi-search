import { SEARCH_DEFAULTS } from "../config";
import type { RawSearchResult, ResearchContext, ResearchProvider } from "../types";

/**
 * Cross-worker caching provider.
 *
 * `SearXNGClient` already caches within a single process. This decorator adds a
 * cache that is shared by every backend worker/deployment, so 20 users running
 * the same query at the same time still result in one SearXNG request per TTL
 * window instead of 20.
 *
 * Failures are deliberately NOT cached: an unreachable SearXNG must surface
 * immediately on the next attempt rather than being pinned as an empty result.
 */

/** Storage the decorator reads from and writes to. */
export interface SharedSearchCache {
  get(key: string): Promise<RawSearchResult[] | null>;
  set(key: string, query: string, results: RawSearchResult[], ttlSeconds: number): Promise<void>;
}

/**
 * Canonical cache key for a query. Case and repeated whitespace are collapsed
 * so "Goa Hotels" and "  goa   hotels " share one entry.
 */
export function cacheKeyForQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export class CachedResearchProvider implements ResearchProvider {
  readonly name: string;
  readonly live: boolean;

  private readonly inner: ResearchProvider;
  private readonly cache: SharedSearchCache;
  private readonly ttlSeconds: number;

  constructor(
    inner: ResearchProvider,
    cache: SharedSearchCache,
    options: { ttlSeconds?: number } = {},
  ) {
    this.inner = inner;
    this.cache = cache;
    this.ttlSeconds = options.ttlSeconds ?? SEARCH_DEFAULTS.cacheTtlSeconds;
    this.name = inner.name;
    this.live = inner.live;
  }

  async search(query: string, ctx: ResearchContext): Promise<RawSearchResult[]> {
    const key = cacheKeyForQuery(query);
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const results = await this.inner.search(query, ctx);

    // Only cache real, non-empty discoveries; an empty result is usually a
    // transient upstream failure rather than "there is genuinely nothing".
    if (results.length > 0) {
      await this.cache.set(key, query, results, this.ttlSeconds);
    }
    return results;
  }
}

/** In-memory cache, used by tests and single-process fallbacks. */
export function createMemorySearchCache(): SharedSearchCache & { size(): number } {
  const store = new Map<string, { expiresAt: number; results: RawSearchResult[] }>();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.results;
    },
    async set(key, _query, results, ttlSeconds) {
      store.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, results });
    },
    size() {
      return store.size;
    },
  };
}