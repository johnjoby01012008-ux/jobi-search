import { describe, expect, it } from "vitest";
import { SearXNGProvider, toRawSearchResult } from "../../providers/searxngProvider";
import { SearXNGClient, type SearXNGResult } from "../searxng";

function makeClient(results: Partial<SearXNGResult>[]): SearXNGClient {
  return new SearXNGClient({
    baseUrl: "http://localhost:8080",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ results: results.map((result) => ({
          title: result.title ?? "Hotel",
          url: result.url ?? "https://www.booking.com/x",
          source: result.source ?? "www.booking.com",
          snippet: result.snippet ?? "",
          price: result.price ?? undefined,
          currency: result.currency ?? undefined,
          hotelName: result.hotelName ?? null,
          location: result.location ?? null,
          rating: result.rating ?? null,
        })) }),
        { status: 200 },
      ),
    logger: () => {},
  });
}

describe("SearXNGProvider", () => {
  const parsed: import("../../types").ParsedQuery = { destination: "Goa", checkIn: "2026-12-12", checkOut: "2026-12-15", guests: 2, rooms: 1, budgetType: "total", preferences: [] };
  it("is a live provider", () => {
    const provider = new SearXNGProvider(makeClient([]), parsed);
    expect(provider.name).toBe("searxng");
    expect(provider.live).toBe(true);
  });

  it("prefers known booking platforms and priced results", async () => {
    const client = makeClient([
      {
        title: "Random blog about Goa hotels",
        url: "https://blog.example.com/goa",
        source: "blog.example.com",
      },
      {
        title: "Sea Breeze Inn — Agoda",
        url: "https://www.agoda.com/sea-breeze",
        source: "www.agoda.com",
        price: 5400,
        currency: "INR",
      },
      {
        title: "Taj — Booking.com",
        url: "https://www.booking.com/taj",
        source: "www.booking.com",
      },
    ]);

    const results = await new SearXNGProvider(client, parsed).search("goa hotels");
    expect(results[0].providerName).toBe("Agoda");
    expect(results[1].providerName).toBe("Booking.com");
    expect(results[2].providerName).toBeUndefined();
  });

  it("marks snippet prices as OBSERVED, never verified", () => {
    const raw = toRawSearchResult({
      title: "Sea Breeze Inn — Agoda",
      url: "https://www.agoda.com/sea-breeze",
      source: "www.agoda.com",
      snippet: "Rooms from ₹5,400 per night.",
      price: 5400,
      currency: "INR",
      hotelName: "Sea Breeze Inn",
      location: "Goa",
      rating: 4,
    }, parsed);

    expect(raw.priceStatus).toBe("observed");
    expect(raw.confidence).toBe("low");
    expect(raw.observedPrice).toBe(5400);
    expect(raw.notes).toMatch(/not verified/i);
  });

  it("handles a booking website that returned no price", () => {
    const raw = toRawSearchResult({
      title: "Taj — Booking.com",
      url: "https://www.booking.com/taj",
      source: "www.booking.com",
      snippet: "Check availability for your dates.",
      price: null,
      currency: null,
      hotelName: "Taj",
      location: null,
      rating: null,
    }, parsed);
    expect(raw.observedPrice).toBeUndefined();
    expect(raw.priceStatus).toBe("observed");
    expect(raw.notes).toMatch(/no price/i);
  });
});
