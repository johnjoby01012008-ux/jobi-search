import { describe, expect, it } from "vitest";
import {
  GeminiSearchClient,
  normalizeGroundingChunks,
  resolveGeminiConfig,
} from "../search/gemini";
import { CompositeProvider } from "../providers/compositeProvider";
import { GeminiProvider } from "../providers/geminiProvider";
import type { RawSearchResult, ResearchProvider } from "../types";

const KEY = "AQ.test-key-value";

function groundingResponse(...uris: Array<{ uri: string; title?: string; snippet?: string }>) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: uris.map((web) => ({ web })),
          },
        },
      ],
    }),
    { status: 200 },
  );
}

describe("resolveGeminiConfig", () => {
  it("is absent without a key", () => {
    expect(resolveGeminiConfig({})).toBeNull();
    expect(resolveGeminiConfig({ GEMINI_API_KEY: "   " })).toBeNull();
  });

  it("reads the key and defaults the model", () => {
    expect(resolveGeminiConfig({ GEMINI_API_KEY: ` ${KEY} ` })).toEqual({
      apiKey: KEY,
      model: "gemini-2.5-flash",
    });
  });

  it("honours an explicit model override", () => {
    expect(
      resolveGeminiConfig({ GEMINI_API_KEY: KEY, GEMINI_MODEL: "gemini-2.0-flash" }),
    ).toEqual({ apiKey: KEY, model: "gemini-2.0-flash" });
  });
});

describe("normalizeGroundingChunks", () => {
  it("maps grounded sources onto the shared result shape", () => {
    const [first] = normalizeGroundingChunks([
      {
        web: {
          uri: "https://www.booking.com/hotel/in/goa.html",
          title: "Sea Breeze Inn, Goa",
          snippet: "Rooms from ₹5,400 per night.",
        },
      },
    ]);

    expect(first).toMatchObject({
      title: "Sea Breeze Inn, Goa",
      url: "https://www.booking.com/hotel/in/goa.html",
      source: "booking.com",
      price: 5400,
      currency: "INR",
      rating: undefined,
    });
    expect(first.snippet).toContain("5,400");
  });

  it("keeps only the first occurrence of a URL and drops non-http links", () => {
    const rows = normalizeGroundingChunks([
      { web: { uri: "https://a.example/x", title: "A" } },
      { web: { uri: "https://a.example/x", title: "A again" } },
      { web: { uri: "javascript:alert(1)", title: "bad" } },
      { web: { uri: "not a url", title: "bad" } },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://a.example/x");
  });
});

describe("GeminiSearchClient", () => {
  const config = { apiKey: KEY, model: "gemini-2.5-flash" };

  it("sends the key in a header, never in the URL", async () => {
    let seenUrl = "";
    let seenKey: string | undefined;

    const client = new GeminiSearchClient(config, {
      fetchImpl: async (input, init) => {
        seenUrl = input;
        seenKey = (init?.headers as Record<string, string> | undefined)?.["x-goog-api-key"];
        return groundingResponse({ uri: "https://a.example/1", title: "A" });
      },
    });

    const rows = await client.search("hotels in Goa");

    expect(rows).toHaveLength(1);
    expect(seenUrl).toContain(":generateContent");
    expect(seenUrl).not.toContain(KEY);
    expect(seenKey).toBe(KEY);
  });

  it("returns an empty batch instead of throwing on a non-2xx response", async () => {
    const client = new GeminiSearchClient(config, {
      fetchImpl: async () => new Response("quota exceeded", { status: 429 }),
    });

    await expect(client.search("anything")).resolves.toEqual([]);
  });

  it("returns an empty batch instead of throwing on a network failure", async () => {
    const client = new GeminiSearchClient(config, {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });

    await expect(client.search("anything")).resolves.toEqual([]);
  });
});

describe("GeminiProvider", () => {
  const parsed: import("../types").ParsedQuery = { destination: "Goa", checkIn: "2026-12-12", checkOut: "2026-12-15", guests: 2, rooms: 1, budgetType: "total", preferences: [] };
  it("produces observed raw results for the pipeline", async () => {
    const parsed: import("../types").ParsedQuery = { destination: "Goa", checkIn: "2026-12-12", checkOut: "2026-12-15", guests: 2, rooms: 1, budgetType: "total", preferences: [] };
    const provider = new GeminiProvider(
      new GeminiSearchClient({ apiKey: KEY, model: "gemini-2.5-flash" }, {
        fetchImpl: async () =>
          groundingResponse({
            uri: "https://www.agoda.com/goa/hotel.html",
            title: "Agoda listing",
            snippet: "Great deal from ₹2,499 per night",
          }),
      }),
      parsed,
    );

    const ctx: import("../types").ResearchContext = { queries: [], parsed, budget: { maxQueries: 1, maxPages: 1, maxDurationMs: 1000 }, startedAt: Date.now() };
    const [row] = await provider.search("goa hotels", ctx);

    expect(row.priceStatus).toBe("observed");
    expect(row.providerName).toBe("Agoda");
    expect(row.observedPrice).toBe(2499);
    expect(row.snippet).toContain("2,499");
  });
});

describe("CompositeProvider", () => {
  const row = (url: string): RawSearchResult => ({
    title: url,
    url,
    snippet: "",
    source: "example.com",
    providerName: undefined,
    hotelName: undefined,
    priceStatus: "observed",
    confidence: "low",
    notes: "",
  });

  const provider = (
    name: string,
    run: () => Promise<RawSearchResult[]>,
  ): ResearchProvider => ({
    name,
    live: true,
    search: run,
  });

  it("merges sources in order and de-duplicates on URL", async () => {
    const composite = new CompositeProvider([
      provider("searxng", async () => [row("https://a.example/1"), row("https://b.example/2")]),
      provider("gemini", async () => [row("https://b.example/2"), row("https://c.example/3")]),
    ]);

    const merged = await composite.search("q");

    expect(composite.name).toBe("searxng+gemini");
    expect(merged.map((r) => r.url)).toEqual([
      "https://a.example/1",
      "https://b.example/2",
      "https://c.example/3",
    ]);
  });

  it("keeps the healthy source when the other one fails", async () => {
    const composite = new CompositeProvider([
      provider("searxng", async () => [row("https://a.example/1")]),
      provider("gemini", async () => {
        throw new Error("billing required");
      }),
    ]);

    await expect(composite.search("q")).resolves.toHaveLength(1);
  });

  it("surfaces the failure only when every source failed", async () => {
    const composite = new CompositeProvider([
      provider("searxng", async () => {
        throw new Error("unreachable");
      }),
      provider("gemini", async () => {
        throw new Error("quota");
      }),
    ]);

    await expect(composite.search("q")).rejects.toThrow();
  });
});
