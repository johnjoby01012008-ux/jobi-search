import { describe, expect, it } from "vitest";
import { canRevealBookingUrl, redactSearchResults } from "../urlLock";
import { buildComparison, describeOfferDifferences } from "../pricing";
import type { HotelOffer } from "../types";

const USER = "user-a";

function payment(overrides: Partial<{ userId: string; status: string; verifiedAt?: number }> = {}) {
  return {
    userId: USER,
    searchId: "search-1",
    status: "paid",
    verifiedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const search = { userId: USER };

describe("₹10 booking-URL lock", () => {
  it("stays locked until a payment is verified", () => {
    expect(canRevealBookingUrl(null, search, USER)).toBe(false);
    expect(canRevealBookingUrl(payment({ status: "pending" }), search, USER)).toBe(false);
    expect(canRevealBookingUrl(payment({ verifiedAt: 0 }), search, USER)).toBe(false);
    expect(canRevealBookingUrl(payment(), search, USER)).toBe(true);
  });

  it("refuses when the search or payment belongs to someone else", () => {
    expect(canRevealBookingUrl(payment(), { userId: "user-b" }, USER)).toBe(false);
    expect(canRevealBookingUrl(payment({ userId: "user-b" }), search, USER)).toBe(false);
    expect(canRevealBookingUrl(payment(), search, "user-b")).toBe(false);
    expect(canRevealBookingUrl(payment(), search, null)).toBe(false);
  });
});

describe("booking-URL protection", () => {
  const rows = [
    { _id: "r1", providerName: "Agoda", bookingUrl: "https://www.agoda.com/secret" },
    { _id: "r2", providerName: "Booking.com", bookingUrl: "https://www.booking.com/secret" },
  ];

  it("strips the booking URL from every row before it leaves the server", () => {
    const redacted = redactSearchResults(rows, false);
    for (const row of redacted) {
      expect(row).not.toHaveProperty("bookingUrl");
      expect(row.bookingUrlLocked).toBe(true);
    }
  });

  it("marks rows unlocked once payment is verified", () => {
    const redacted = redactSearchResults(rows, true);
    expect(redacted.every((row) => row.bookingUrlLocked === false)).toBe(true);
    // The URL is still never re-attached by redaction — it is fetched via reveal.
    expect(redacted[0]).not.toHaveProperty("bookingUrl");
  });
});

function offer(overrides: Partial<HotelOffer> = {}): HotelOffer {
  return {
    hotelName: "Taj Holiday Village",
    destination: "Goa",
    providerName: "Agoda",
    bookingUrl: "https://www.agoda.com/x",
    sourceUrl: "https://www.agoda.com/x",
    checkIn: "2026-12-12",
    checkOut: "2026-12-15",
    guests: 2,
    rooms: 1,
    currency: "INR",
    priceStatus: "verified",
    confidence: "high",
    checkedAt: "2026-10-04T00:00:00.000Z",
    totalPrice: 9000,
    roomName: "Deluxe King Room",
    mealPlan: "Breakfast included",
    cancellationPolicy: "Free cancellation until 24h before",
    ...overrides,
  };
}

describe("cheapest-result comparison", () => {
  it("flags how a cheaper offer differs from the reference product", () => {
    const base = offer({ roomName: "Deluxe King Room", guests: 2 });
    const other = offer({
      roomName: "Standard Room",
      mealPlan: "Room only",
      cancellationPolicy: "Non-refundable",
      guests: 4,
      checkOut: "2026-12-17",
    });
    const differences = describeOfferDifferences(base, other);
    expect(differences.some((d) => /room type/i.test(d))).toBe(true);
    expect(differences.some((d) => /meal plan/i.test(d))).toBe(true);
    expect(differences.some((d) => /cancellation/i.test(d))).toBe(true);
    expect(differences.some((d) => /guest count/i.test(d))).toBe(true);
    expect(differences.some((d) => /nights/i.test(d))).toBe(true);
  });

  it("returns no differences for an equivalent product", () => {
    expect(describeOfferDifferences(offer(), offer({ totalPrice: 9500 }))).toEqual([]);
  });

  it("picks the cheapest verified offer and annotates it as the reference", () => {
    const comparison = buildComparison([
      offer({ providerName: "Agoda", totalPrice: 9000 }),
      offer({ providerName: "Booking.com", totalPrice: 9500, roomName: "Standard Room" }),
      offer({
        providerName: "Trivago",
        totalPrice: 8000,
        priceStatus: "observed",
        confidence: "low",
        roomName: "Standard Room",
        guests: 4,
      }),
    ]);

    expect(comparison.cheapestVerified?.offer.providerName).toBe("Agoda");
    expect(comparison.cheapestVerified?.differences).toEqual([]);
    expect(comparison.cheapestObserved?.total).toBe(8000);
    // The observed offer is annotated with how it differs from the verified one.
    expect(comparison.observed[0].differences.length).toBeGreaterThan(0);
  });

  it("never promotes an observed price to the cheapest verified slot", () => {
    const comparison = buildComparison([
      offer({ providerName: "Trivago", totalPrice: 5000, priceStatus: "observed", confidence: "low" }),
    ]);
    expect(comparison.cheapestVerified).toBeUndefined();
    expect(comparison.cheapestObserved?.total).toBe(5000);
  });
});
