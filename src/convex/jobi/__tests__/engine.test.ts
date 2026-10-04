import { describe, expect, it } from "vitest";
import { runResearch } from "../engine";
import { parseTripQuery } from "../parse";
import { mockResearchProvider } from "../providers/mockProvider";
import { extractObservedPrice } from "../providers/webSearchProvider";
import { validateBookingUrl } from "../urlSafety";

const parsed = parseTripQuery(
  "Goa for 3 nights, 2 people, near Baga Beach, with a pool, under ₹10,000 total",
  { now: new Date("2026-09-01T00:00:00") },
);

describe("runResearch — normalise, match, compare", () => {
  it("produces a verified cheapest offer and never promotes the unverified one", async () => {
    const stages: string[] = [];
    const result = await runResearch({
      parsed,
      provider: mockResearchProvider,
      hooks: { onStage: (key) => void stages.push(key) },
    });

    expect(stages).toEqual(["discover", "check", "compare", "verify"]);
    expect(result.offers.length).toBeGreaterThan(0);
    expect(result.metrics.offersFound).toBeGreaterThan(0);

    const cheapest = result.comparison.cheapestVerified;
    expect(cheapest).toBeDefined();
    expect(cheapest!.offer.priceStatus).toBe("verified");

    const cheapestObserved = result.comparison.cheapestObserved;
    expect(cheapestObserved).toBeDefined();
    expect(cheapestObserved!.total).toBeLessThan(cheapest!.total);

    // Every verified offer must link to an allowlisted provider over HTTPS.
    for (const entry of result.comparison.verified) {
      expect(validateBookingUrl(entry.offer.bookingUrl).ok).toBe(true);
    }

    // Demo mode is disclosed in the transparency report.
    expect(result.report.limitations.some((line) => line.includes("DEMO"))).toBe(true);
    expect(result.report.limitations.some((line) => line.includes("not full internet coverage"))).toBe(
      true,
    );
  });

  it("normalises offers to the requested dates and guests", async () => {
    const result = await runResearch({ parsed, provider: mockResearchProvider });
    const offer = result.offers[0];
    expect(offer.checkIn).toBe(parsed.checkIn);
    expect(offer.checkOut).toBe(parsed.checkOut);
    expect(offer.guests).toBe(parsed.guests);
    expect(offer.rooms).toBe(parsed.rooms);
  });

  it("stays within the configured research budget", async () => {
    const result = await runResearch({
      parsed,
      provider: mockResearchProvider,
      budget: { maxQueries: 3, maxPages: 20, maxDurationMs: 5000 },
    });
    expect(result.metrics.queriesRun).toBeLessThanOrEqual(3);
  });
});

describe("extractObservedPrice", () => {
  it("reads INR prices out of untrusted snippet text", () => {
    expect(extractObservedPrice("Great deal from ₹2,499 per night")).toBe(2499);
    expect(extractObservedPrice("Rs. 8900 total")).toBe(8900);
    expect(extractObservedPrice("no price here")).toBeUndefined();
  });
});
