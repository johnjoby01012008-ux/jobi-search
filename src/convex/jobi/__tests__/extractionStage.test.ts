import { describe, expect, it, vi } from "vitest";
import { runExtractionStage } from "../extraction/extractStage";
import type { RawSearchResult } from "../types";

/**
 * Extraction-stage merge tests.
 *
 * The Python backend is not reachable from unit tests, so we mock its HTTP
 * contract exactly as documented in src/convex/jobi/extraction/fetch.ts and
 * verify that extracted hotels are merged into the results the way the
 * pipeline expects (normalize → dedupe → compare consume these entries).
 */

process.env.BACKEND_EXTRACTOR_URL = "https://extractor.test";
process.env.EXTRACTION_TIMEOUT_MS = "20000";

const SEARCH_RAW: RawSearchResult[] = [
  {
    title: "Sea Breeze Inn",
    url: "https://www.booking.com/hotel/sea-breeze-inn",
    snippet: "Sea Breeze Inn from ₹8,740",
    source: "www.booking.com",
    providerName: "Booking.com",
    hotelName: "Sea Breeze Inn",
    basePrice: 8000,
    totalPrice: 8740,
    currency: "INR",
    priceStatus: "observed",
    confidence: "low",
  },
];

function okBatchResponse() {
  return new Response(
    JSON.stringify({
      successful: [
        {
          success: true,
          hotel: {
            hotel_name: "Sea Breeze Inn",
            provider: "booking.com",
            room_name: "Deluxe King",
            check_in: "2026-12-12",
            check_out: "2026-12-15",
            guests: 2,
            rooms: 1,
            price: { amount: 8740, currency: "INR" },
            price_context: { raw: "₹8,740 total", price_type: "total", nearby_hints: [] },
            taxes: 740,
            total_price: 8740,
            breakfast_included: true,
            booking_url: "https://www.booking.com/hotel/sea-breeze-inn",
            source_url: "https://www.booking.com/hotel/sea-breeze-inn",
            price_verified: true,
            confidence: "high",
            rating: 4.4,
            amenities: ["Free WiFi"],
            extracted_at: "2026-10-09T00:00:00Z",
          },
          reason: null,
          jsonld_found: true,
          playwright_used: false,
          notes: {},
        },
      ],
      failed: [
        { url: "https://www.agoda.com/hotel/x", reason: "access_blocked" },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("extraction stage merge", () => {
  it("merges verified extracted offers into the results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okBatchResponse());
    const result = await runExtractionStage(
      SEARCH_RAW,
      { checkIn: "2026-12-12", checkOut: "2026-12-15", guests: 2, rooms: 1 },
      fetchImpl as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    );

    expect(result.extractionUsed).toBe(true);
    expect(result.extractedOffers).toHaveLength(1);

    const offer = result.extractedOffers[0];
    expect(offer.hotelName).toBe("Sea Breeze Inn");
    expect(offer.url).toBe("https://www.booking.com/hotel/sea-breeze-inn");
    expect(offer.totalPrice).toBe(8740);
    expect(offer.currency).toBe("INR");
    // Page-backed structured price ⇒ verified, unlike snippet-only offers.
    expect(offer.priceStatus).toBe("verified");
    expect(offer.confidence).toBe("high");

    expect(result.failedUrls).toEqual([
      { url: "https://www.agoda.com/hotel/x", reason: "access_blocked" },
    ]);
  });

  it("does not merge a failed URL as an offer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ successful: [], failed: [{ url: "https://x.test/a", reason: "timeout" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await runExtractionStage(
      SEARCH_RAW,
      { checkIn: "2026-12-12", checkOut: "2026-12-15", guests: 2, rooms: 1 },
      fetchImpl as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    );
    expect(result.extractedOffers).toHaveLength(0);
    expect(result.failedUrls).toEqual([{ url: "https://x.test/a", reason: "timeout" }]);
  });

  it("keeps the pipeline running when the backend is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const result = await runExtractionStage(
      SEARCH_RAW,
      { checkIn: "2026-12-12", checkOut: "2026-12-15", guests: 2, rooms: 1 },
      fetchImpl as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    );
    expect(result.extractionUsed).toBe(false);
    expect(result.extractedOffers).toHaveLength(0);
    // Every considered URL is reported as failed with the reason.
    expect(result.failedUrls.length).toBeGreaterThan(0);
    expect(result.failedUrls[0].reason).toContain("connect ECONNREFUSED");
  });

  it("skips extraction entirely when BACKEND_EXTRACTOR_URL is unset", async () => {
    const prev = process.env.BACKEND_EXTRACTOR_URL;
    delete process.env.BACKEND_EXTRACTOR_URL;
    try {
      const fetchImpl = vi.fn();
      const result = await runExtractionStage(
        SEARCH_RAW,
        { checkIn: "2026-12-12", checkOut: "2026-12-15", guests: 2, rooms: 1 },
        fetchImpl as unknown as (input: string, init?: RequestInit) => Promise<Response>,
      );
      expect(result).toEqual({ extractedOffers: [], failedUrls: [], extractionUsed: false });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      process.env.BACKEND_EXTRACTOR_URL = prev;
    }
  });
});
