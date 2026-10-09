import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectSearXNGConfig,
  SearXNGClient,
  searchWeb,
  SearchMalformedResponseError,
  SearchUnavailableError,
  normalizeSearXNGResponse,
  normalizeBaseUrl,
  hotelNameFromTitle,
  locationFromText,
  resolveSearXNGConfig,
} from "../searxng";
import { extractPrice, extractRating } from "../price";

function jsonResponse(
  payload: unknown,
  init: { status?: number; raw?: boolean } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (init.raw) throw new Error("Unexpected token < in JSON");
      return payload;
    },
  } as unknown as Response;
}

type FetchCall = { url: string };

function makeFetch(payload: unknown, calls: FetchCall[], init?: { status?: number; raw?: boolean }) {
  return async (input: string): Promise<Response> => {
    calls.push({ url: input });
    return jsonResponse(payload, init);
  };
}

const SAMPLE_PAYLOAD = {
  results: [
    {
      title: "Taj Holiday Village Resort & Spa | Booking.com",
      url: "https://www.booking.com/hotel/in/taj-holiday-village.en-gb.html",
      content: "Luxury resort in Goa from ₹8,900 total for 3 nights. 8.4/10 guest score.",
      engine: "google",
    },
    {
      title: "Sea Breeze Inn — Agoda",
      url: "https://www.agoda.com/sea-breeze-inn/hotel/goa-in.html",
      content: "Rooms near Baga Beach. Free cancellation.",
      engine: "duckduckgo",
    },
  ],
};

afterEach(() => {
  // nothing to reset (no singleton)
});

describe("SearXNG configuration", () => {
  it("detects and normalises the base URL from the environment", () => {
    expect(detectSearXNGConfig({})).toBeNull();
    expect(detectSearXNGConfig({ SEARXNG_URL: "   " })).toBeNull();
    expect(detectSearXNGConfig({ SEARXNG_URL: "http://searxng:8080///" })).toEqual({
      baseUrl: "http://searxng:8080",
    });
  });

  it("strips trailing slashes safely", () => {
    expect(normalizeBaseUrl("http://localhost:8888/")).toBe("http://localhost:8888");
    expect(normalizeBaseUrl("http://localhost:8888")).toBe("http://localhost:8888");
  });

  it("resolves tunables from env and falls back to defaults", () => {
    const config = resolveSearXNGConfig({
      SEARXNG_URL: "http://searxng:8080",
      SEARCH_CACHE_TTL: "60",
      SEARCH_TIMEOUT: "2500",
      SEARXNG_MAX_RESULTS: "5",
      SEARXNG_ENGINES: "google, duckduckgo",
    });
    expect(config).not.toBeNull();
    expect(config).toMatchObject({
      baseUrl: "http://searxng:8080",
      cacheTtlSeconds: 60,
      timeoutMs: 2500,
      maxResults: 5,
      engines: ["google", "duckduckgo"],
    });

    const defaults = resolveSearXNGConfig({ SEARXNG_URL: "http://searxng:8080" });
    expect(defaults).toMatchObject({
      timeoutMs: 10_000,
      cacheTtlSeconds: 900,
      maxResults: 15,
    });
  });
});

describe("normalization", () => {
  it("maps a raw SearXNG item into the normalized shape", () => {
    const normalized = normalizeSearXNGResponse(SAMPLE_PAYLOAD.results[0]);
    expect(normalized).not.toBeNull();
    expect(normalized).toMatchObject({
      url: SAMPLE_PAYLOAD.results[0].url,
      source: "google",
      price: 8900,
      currency: "INR",
      rating: 4.2,
    });
    expect(normalized![0].hotelName).toBe("Taj Holiday Village Resort & Spa");
    expect(normalized![0].location).toBe("Goa");
  });

  it("drops items without a title or a parseable URL", () => {
    expect(normalizeSearXNGResponse({ title: "", url: "https://x.com/a" })).toEqual([]);
    expect(normalizeSearXNGResponse({ title: "A hotel", url: "not-a-url" })).toEqual([]);
  });

  it("derives a hotel name and location defensively", () => {
    expect(hotelNameFromTitle("Taj Holiday Village Resort & Spa — Booking.com")).toBe(
      "Taj Holiday Village Resort & Spa",
    );
    expect(hotelNameFromTitle("https://example.com/foo")).toBeNull();
    expect(hotelNameFromTitle("Goa")).toBeNull();
    expect(locationFromText("Luxury resort in Goa from ₹8,900")).toBe("Goa");
    expect(locationFromText("no location here")).toBeNull();
  });
});

describe("price extraction", () => {
  it("only reports a price when a currency marker is present", () => {
    expect(extractPrice("Great deal from ₹2,499 per night")).toEqual({ amount: 2499, currency: "INR" });
    expect(extractPrice("Rs. 8900 total")).toEqual({ amount: 8900, currency: "INR" });
    expect(extractPrice("$120 total")).toEqual({ amount: 120, currency: "USD" });
  });

  it("never invents a price from a bare number", () => {
    expect(extractPrice("2 guests, 3 nights")).toBeNull();
    expect(extractPrice("")).toBeNull();
    expect(extractPrice(null)).toBeNull();
  });

  it("reads ratings without fabricating them", () => {
    expect(extractRating("8.4/10 guest score")).toBeCloseTo(4.2, 1);
    expect(extractRating("4 star hotel")).toBe(4);
    expect(extractRating("no rating")).toBeUndefined();
  });
});

describe("searchWeb", () => {
  it("builds a JSON request and returns normalized results", async () => {
    const calls: FetchCall[] = [];
    const client = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      fetchImpl: makeFetch(SAMPLE_PAYLOAD, calls),
      logger: () => {},
    });

    const results = await searchWeb("hotels in Goa", { client });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("http://searxng:8080/search?");
    expect(calls[0].url).toContain("format=json");
    expect(calls[0].url).toContain("q=hotels+in+Goa");
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe("www.booking.com");
  });

  it("throws a clean error when search is not configured", async () => {
    await expect(searchWeb("goa hotels", { env: {} })).rejects.toBeInstanceOf(
      SearchUnavailableError,
    );
  });
});

describe("error handling", () => {
  it("maps a request timeout to a clean unavailable error", async () => {
    const fetchImpl = async () =>
      new Promise<Response>((_resolve, reject) => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      });

    const client = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      timeoutMs: 10,
      fetchImpl,
      logger: () => {},
    });

    await expect(client.search("goa hotels")).rejects.toBeInstanceOf(SearchUnavailableError);
  });

  it("maps a non-OK status to a clean unavailable error", async () => {
    const calls: FetchCall[] = [];
    const client = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      fetchImpl: makeFetch({ results: [] }, calls, { status: 503 }),
      logger: () => {},
    });
    await expect(client.search("goa hotels")).rejects.toBeInstanceOf(SearchUnavailableError);
  });

  it("maps malformed JSON and malformed shape to a malformed error", async () => {
    const badJson = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      fetchImpl: makeFetch(null, [], { raw: true }),
      logger: () => {},
    });
    await expect(badJson.search("goa hotels")).rejects.toBeInstanceOf(
      SearchMalformedResponseError,
    );

    const badShape = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      fetchImpl: makeFetch({ results: "nope" }, []),
      logger: () => {},
    });
    await expect(badShape.search("goa hotels")).rejects.toBeInstanceOf(
      SearchMalformedResponseError,
    );
  });

  it("skips unusable (non-https / localhost) results instead of failing", async () => {
    const payload = {
      results: [
        { title: "Book now", url: "http://www.booking.com/x" },
        { title: "Local", url: "https://localhost/x" },
        { title: "Good hotel — Agoda", url: "https://www.agoda.com/good" },
      ],
    };
    const client = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      fetchImpl: makeFetch(payload, []),
      logger: () => {},
    });
    const results = await client.search("goa");
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("www.agoda.com");
  });
});

describe("caching and duplicate suppression", () => {
  it("serves a repeated query from cache without a second request", async () => {
    const calls: FetchCall[] = [];
    const logger = vi.fn();
    const client = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      fetchImpl: makeFetch(SAMPLE_PAYLOAD, calls),
      logger,
    });

    await client.search("Goa hotels 12-15 December 2 guests");
    await client.search("goa hotels 12-15 december 2 guests");
    expect(calls).toHaveLength(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({ event: "search_ok" }),
    );
  });

  it("dedupes identical in-flight searches", async () => {
    const calls: FetchCall[] = [];
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchImpl = (input: string): Promise<Response> => {
      calls.push({ url: input });
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    };
    const client = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      fetchImpl,
      logger: () => {},
    });

    const first = client.search("goa hotels");
    const second = client.search("goa hotels");
    resolveFetch?.(jsonResponse(SAMPLE_PAYLOAD));
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it("logs counts and timings without leaking secrets", async () => {
    const events: Array<Record<string, unknown>> = [];
    const client = new SearXNGClient({
      baseUrl: "http://searxng:8080",
      fetchImpl: makeFetch(SAMPLE_PAYLOAD, []),
      logger: (event) => events.push(event),
    });
    await client.search("hotels in Goa");
    const ok = events.find((event) => event.event === "search_ok");
    expect(ok).toBeDefined();
    expect(ok).toMatchObject({ resultCount: 2 });
    expect(JSON.stringify(events)).not.toContain("searxng:8080");
  });
});
