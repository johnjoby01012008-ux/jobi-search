import { describe, expect, it } from "vitest";
import {
  CachedResearchProvider,
  cacheKeyForQuery,
  createMemorySearchCache,
} from "../providers/cachedProvider";
import type { RawSearchResult, ResearchContext, ResearchProvider } from "../types";

function makeResult(name: string): RawSearchResult {
  return {
    title: name,
    url: `https://www.agoda.com/${name.toLowerCase().replace(/\s+/g, "-")}`,
    snippet: `${name} from ₹4,200 total`,
    source: "agoda.com",
  };
}

const ctx = {} as ResearchContext;

class CountingProvider implements ResearchProvider {
  name = "searxng";
  live = true;
  calls = 0;
  fail = false;
  empty = false;

  async search(): Promise<RawSearchResult[]> {
    this.calls += 1;
    if (this.fail) throw new Error("Search is temporarily unavailable. Please try again.");
    return this.empty ? [] : [makeResult("Sea Breeze Inn")];
  }
}

describe("cacheKeyForQuery", () => {
  it("collapses case and whitespace so equivalent queries share an entry", () => {
    expect(cacheKeyForQuery("  Hotels   in   GOA ")).toBe("hotels in goa");
    expect(cacheKeyForQuery("Hotels in Goa")).toBe(cacheKeyForQuery("  hotels  in goa "));
  });
});

describe("CachedResearchProvider — shared cross-worker cache", () => {
  it("serves a repeated query from cache instead of hitting the provider again", async () => {
    const inner = new CountingProvider();
    const provider = new CachedResearchProvider(inner, createMemorySearchCache(), {
      ttlSeconds: 900,
    });

    await provider.search("hotels in Goa", ctx);
    await provider.search("hotels in Goa", ctx);
    expect(inner.calls).toBe(1);
  });

  it("treats differently-cased queries as the same entry", async () => {
    const inner = new CountingProvider();
    const provider = new CachedResearchProvider(inner, createMemorySearchCache());
    await provider.search("Hotels in Goa", ctx);
    await provider.search("  HOTELS   IN goa ", ctx);
    expect(inner.calls).toBe(1);
  });

  it("passes results through to a different worker sharing the cache", async () => {
    const cache = createMemorySearchCache();
    const first = new CachedResearchProvider(new CountingProvider(), cache);
    const second = new CachedResearchProvider(new CountingProvider(), cache);

    await first.search("hotels in Goa", ctx);
    const fromSecondWorker = await second.search("hotels in Goa", ctx);

    expect(fromSecondWorker).toHaveLength(1);
  });

  it("does not cache an empty result set", async () => {
    const inner = new CountingProvider();
    inner.empty = true;
    const provider = new CachedResearchProvider(inner, createMemorySearchCache());
    await provider.search("hotels in Goa", ctx);
    await provider.search("hotels in Goa", ctx);
    expect(inner.calls).toBe(2);
  });

  it("never caches a failure, so an outage surfaces immediately", async () => {
    const inner = new CountingProvider();
    inner.fail = true;
    const provider = new CachedResearchProvider(inner, createMemorySearchCache());

    await expect(provider.search("hotels in Goa", ctx)).rejects.toThrow(/temporarily unavailable/i);
    await expect(provider.search("hotels in Goa", ctx)).rejects.toThrow(/temporarily unavailable/i);
    expect(inner.calls).toBe(2);
  });

  it("preserves the inner provider identity", () => {
    const provider = new CachedResearchProvider(new CountingProvider(), createMemorySearchCache());
    expect(provider.name).toBe("searxng");
    expect(provider.live).toBe(true);
  });
});