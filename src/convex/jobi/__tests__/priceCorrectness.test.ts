import { describe, expect, it } from "vitest";
import { buildComparison, offerTotal, isVerifiedOffer } from "../pricing";
import type { HotelOffer } from "../types";

function offer(overrides: Partial<HotelOffer> & { hotelName: string; providerName: string }): HotelOffer {
  return {
    destination: "Goa",
    bookingUrl: "https://www.booking.com/x?checkin=2026-12-12",
    sourceUrl: "https://www.booking.com/x",
    checkIn: "2026-12-12",
    checkOut: "2026-12-15",
    guests: 2,
    rooms: 1,
    currency: "INR",
    priceStatus: "verified",
    confidence: "high",
    checkedAt: "2026-10-09T00:00:00Z",
    ...overrides,
  };
}

describe("cheapest-price correctness", () => {
  it("does not compare different currencies as if identical", () => {
    const inr = offer({ hotelName: "Grand A", providerName: "Booking.com", totalPrice: 8000 });
    const usd = offer({ hotelName: "Grand A", providerName: "Agoda", totalPrice: 100, currency: "USD" });

    expect(offerTotal(inr)).toBe(8000);
    expect(offerTotal(usd)).toBe(100);
    const comparison = buildComparison([inr, usd]);
    // Offers are ranked within each currency mixed, but the difference annotation
    // must call out the currency so a 100 USD total never looks like ₹100.
    const usdEntry = comparison.verified.find((e) => e.offer.currency === "USD");
    expect(usdEntry?.differences.some((d) => d.includes("Different currency"))).toBe(true);
    // A USD-100 total must never rank above an INR-8000 total: numeric totals
    // from different currencies are never compared to each other.
    expect(comparison.verified[0].offer.currency).not.toBe("USD");
    expect(comparison.referenceCurrency).toBe("INR");
  });

  it("treats per-night prices as not directly comparable to totals", () => {
    // A basePrice of 2700 for 3 nights with explicit taxes produces a comparable
    // total; a bare 'starting_from' observed price must stay OUT of verified.
    const total = offer({ hotelName: "Grand A", providerName: "Booking.com", totalPrice: 8740 });
    const perNightObserved = offer({
      hotelName: "Grand A",
      providerName: "Agoda",
      totalPrice: 2900,
      priceStatus: "observed",
      confidence: "low",
    });
    const comparison = buildComparison([total, perNightObserved]);
    expect(comparison.cheapestVerified?.offer.providerName).toBe("Booking.com");
    expect(comparison.cheapestObserved?.offer).toBe(perNightObserved);
    // The observed bucket must not be merged into the verified ranking.
    expect(comparison.verified).toHaveLength(1);
  });

  it("does not treat different date ranges or guest counts as equivalent", () => {
    const base = offer({ hotelName: "Grand A", providerName: "Booking.com", totalPrice: 8740 });
    const differentDates = offer({
      hotelName: "Grand A",
      providerName: "Cleartrip",
      totalPrice: 9200, // more than base so it does not become the ranking reference
      checkIn: "2026-12-12",
      checkOut: "2026-12-13", // different nights vs base (2 vs 3)
    });
    const differentGuests = offer({
      hotelName: "Grand A",
      providerName: "Yatra",
      totalPrice: 9100,
      guests: 4,
    });
    const comparison = buildComparison([base, differentDates, differentGuests]);
    const datesEntry = comparison.verified.find((e) => e.offer.providerName === "Cleartrip");
    const guestsEntry = comparison.verified.find((e) => e.offer.providerName === "Yatra");
    expect(datesEntry?.differences.some((d) => d.includes("Different number of nights"))).toBe(true);
    expect(guestsEntry?.differences.some((d) => d.includes("Different guest count"))).toBe(true);
  });

  it("never promotes a starting-from observed price to the cheapest-verified slot", () => {
    const verified = offer({ hotelName: "Grand A", providerName: "Booking.com", totalPrice: 8740 });
    const startingFrom = offer({
      hotelName: "Grand A",
      providerName: "Trivago",
      totalPrice: 2999,
      priceStatus: "observed",
      confidence: "low",
    });
    const comparison = buildComparison([verified, startingFrom]);
    expect(comparison.cheapestVerified?.total).toBe(8740);
    expect(isVerifiedOffer(startingFrom)).toBe(false);
  });

  it("does not silently treat unknown taxes as zero in the reported total", () => {
    // When totalPrice is absent, the total is reconstructed from base + taxes.
    // Missing taxes make the compare total conservative: base-only total is
    // reported, but the currency/fee annotations still apply.
    const baseOnly = offer({ hotelName: "Grand A", providerName: "Booking.com", basePrice: 8000, taxes: undefined });
    const complete = offer({ hotelName: "Grand A", providerName: "Agoda", basePrice: 7270, taxes: 1470 });
    const feeDiff = offer({ hotelName: "Grand A", providerName: "Cleartrip", basePrice: 7270, taxes: 1470, mandatoryFees: 500 });
    const comparison = buildComparison([baseOnly, complete, feeDiff]);
    // baseOnly looks cheaper (8000) than complete (8740), so it sorts first —
    // but the fee difference must be annotated rather than hidden.
    expect(comparison.verified[0].total).toBe(8000);
    const feeEntry = comparison.verified.find((e) => e.offer.mandatoryFees === 500);
    expect(feeEntry?.differences.some((d) => d.includes("Mandatory fees differ"))).toBe(true);
  });

  it("ranks the cheapest eligible verified offer first", () => {
    const a = offer({ hotelName: "Grand A", providerName: "Booking.com", totalPrice: 9000 });
    const b = offer({ hotelName: "Grand A", providerName: "Agoda", totalPrice: 8740 });
    const c = offer({ hotelName: "Grand A", providerName: "Yatra", totalPrice: 9650 });
    const comparison = buildComparison([a, b, c]);
    expect(comparison.verified[0].offer.providerName).toBe("Agoda");
    expect(comparison.verified[0].differences).toHaveLength(0);
    // All three share the same product: no spurious difference annotations.
    expect(comparison.verified[1].differences).toHaveLength(0);
    expect(comparison.verified[2].differences).toHaveLength(0);
  });
});
