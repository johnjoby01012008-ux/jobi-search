import type { RawSearchResult, ResearchProvider } from "../types";
import type { SearXNGClient, SearXNGResult } from "../search/searxng";
import {
  PROVIDER_ALLOWLIST,
  providerForHostname,
  sanitizeUntrustedText,
} from "../urlSafety";
import type { ParsedQuery } from "../types";

/**
 * SearXNGProvider — the primary live research source.
 *
 * It feeds the *same* raw shape as the Gemini grounding source, so every live
 * source flows through the existing normalise > dedupe > compare > verify
 * pipeline. Text from the web stays untrusted DATA and is sanitised on the way
 * in; observed prices are never reported as verified.
 *
 * The provider id is derived from each result's host name so downstream code
 * can tell which booking platform a row came from even when the original
 * search string was generic.
 */
export function toRawSearchResult(
  result: SearXNGResult,
  parsed: ParsedQuery,
): RawSearchResult {
  const providerName = providerForHostname(result.source);

  // A price is only meaningful when a currency marker was present; `price` is
  // null otherwise, and prices are never invented from bare numbers.
  const hasPrice = result.price !== null && result.price !== undefined;

  return {
    title: sanitizeUntrustedText(result.title, 300),
    url: result.url,
    snippet: sanitizeUntrustedText(result.snippet, 600),
    source: result.source,
    observedPrice: hasPrice ? result.price : undefined,
    observedCurrency: hasPrice ? result.currency ?? "INR" : undefined,
    providerName,
    hotelName: result.hotelName,
    rating: result.rating,
    priceStatus: "observed",
    confidence: "low",
    notes: hasPrice
      ? "Price observed in a search snippet - not verified for your exact dates."
      : "No price found in the snippet - check the provider page for availability.",
    destination: parsed.destination,
    checkIn: parsed.checkIn,
    checkOut: parsed.checkOut,
    guests: parsed.guests,
    rooms: parsed.rooms,
  };
}

/** Known booking platforms and priced results come first. */
function relevance(row: RawSearchResult): number {
  let score = 0;
  if (row.observedPrice !== undefined) score += 2;
  if (row.providerName) score += 1;
  return score;
}

export class SearXNGProvider implements ResearchProvider {
  name = "searxng";
  live = true;

  private readonly client: SearXNGClient;
  private readonly parsed: ParsedQuery;

  constructor(client: SearXNGClient, parsed: ParsedQuery) {
    this.client = client;
    this.parsed = parsed;
  }

  async search(query: string): Promise<RawSearchResult[]> {
    const results = await this.client.search(query);
    const rows = results
      .map((result) => toRawSearchResult(result, this.parsed))
      // Every result still counts as a "source checked"; we only filter empty
      // titles so the normaliser never produces a nameless offer.
      .filter((row) => row.hotelName || row.title);
    return rows.sort((a, b) => relevance(b) - relevance(a));
  }
}
