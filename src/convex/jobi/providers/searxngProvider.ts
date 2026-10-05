import type { RawSearchResult, ResearchProvider } from "../types";
import { providerForHostname, sanitizeUntrustedText } from "../urlSafety";
import { SearXNGClient, type SearXNGResult } from "../search/searxng";

/**
 * SearXNGProvider — the live search provider.
 *
 * It discovers publicly available hotel/booking pages through the self-hosted
 * SearXNG instance. It never scrapes booking sites directly, never bypasses
 * CAPTCHA / login / bot protection, and only reads the snippets SearXNG already
 * returns. Any source that cannot be reached is simply skipped.
 *
 * Text from the web is treated as untrusted DATA and sanitised. Prices found in
 * snippets are always surfaced as OBSERVED — never VERIFIED.
 */

/** Booking platforms we prefer to surface first when they appear. */
const BOOKING_SOURCES = new Set([
  "Booking.com",
  "Agoda",
  "MakeMyTrip",
  "Goibibo",
  "Cleartrip",
  "Yatra",
  "Expedia",
  "Hotels",
  "Trivago",
  "OYO",
  "Treebo",
  "FabHotels",
  "Official hotel site",
]);

/** Rank a result so known booking providers come first. */
function sourceRank(provider: string | undefined): number {
  if (provider && BOOKING_SOURCES.has(provider)) return 0;
  return 1;
}

/** Convert one normalized SearXNG result into a RawSearchResult. */
export function toRawSearchResult(result: SearXNGResult): RawSearchResult {
  const snippet = sanitizeUntrustedText(result.snippet, 600);
  const providerName = providerForHostname(result.source);
  const hasPrice = result.price !== null;

  return {
    title: sanitizeUntrustedText(result.title, 200) || result.url,
    url: result.url,
    snippet,
    source: result.source,
    providerName,
    hotelName: result.hotelName ?? undefined,
    observedPrice: hasPrice ? result.price ?? undefined : undefined,
    observedCurrency: result.currency ?? undefined,
    rating: result.rating ?? undefined,
    priceStatus: "observed",
    confidence: hasPrice ? "low" : "low",
    notes: hasPrice
      ? "Price observed in a public search result — not verified for your exact dates."
      : "Source discovered via search. No price was published in the result.",
  };
}

export class SearXNGProvider implements ResearchProvider {
  name = "searxng";
  live = true;

  private readonly client: SearXNGClient;

  constructor(client: SearXNGClient) {
    this.client = client;
  }

  async search(query: string): Promise<RawSearchResult[]> {
    const results = await this.client.search(query);
    return results
      .map((result) => ({ result, raw: toRawSearchResult(result) }))
      .sort((a, b) => {
        const rank = sourceRank(a.raw.providerName) - sourceRank(b.raw.providerName);
        if (rank !== 0) return rank;
        // Prefer results that actually surfaced a price.
        const priceRank =
          (a.raw.observedPrice === undefined ? 1 : 0) -
          (b.raw.observedPrice === undefined ? 1 : 0);
        return priceRank;
      })
      .map((entry) => entry.raw);
  }
}
