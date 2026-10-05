import { nightsBetween } from "./parse";
import type { Comparison, ComparisonOffer, HotelOffer } from "./types";

/**
 * Deterministic price logic. The AI is never allowed to decide which offer is
 * the cheapest — that is this module's job, and it only ever promotes an offer
 * to "cheapest" when its pricing is VERIFIED.
 *
 * Comparison priority (per spec): final total → taxes → mandatory fees → room →
 * meal plan → cancellation policy. We use the final total as the sort key and
 * expose the rest for transparency.
 */

/** Final known total for an offer, or undefined when no price is known. */
export function offerTotal(offer: HotelOffer): number | undefined {
  if (typeof offer.totalPrice === "number" && Number.isFinite(offer.totalPrice)) {
    return Math.max(0, offer.totalPrice);
  }
  if (typeof offer.basePrice === "number" && Number.isFinite(offer.basePrice)) {
    const taxes = offer.taxes ?? 0;
    const fees = offer.mandatoryFees ?? 0;
    return Math.max(0, offer.basePrice + taxes + fees);
  }
  return undefined;
}

/** An offer only counts as verified when the price is directly supported. */
export function isVerifiedOffer(offer: HotelOffer): boolean {
  if (offer.priceStatus !== "verified") return false;
  if (offer.confidence === "low") return false;
  return offerTotal(offer) !== undefined;
}

function toComparison(offer: HotelOffer): ComparisonOffer | null {
  const total = offerTotal(offer);
  if (total === undefined) return null;
  return { offer, total, isVerified: isVerifiedOffer(offer), differences: [] };
}

/**
 * Describe how `other` differs from a reference offer. Two offers are only
 * truly comparable when the room, meal plan, cancellation policy, guests and
 * nights line up; anything that differs is surfaced explicitly so a "cheaper"
 * price is never mistaken for the same product.
 */
export function describeOfferDifferences(base: HotelOffer, other: HotelOffer): string[] {
  const differences: string[] = [];

  const room = (o: HotelOffer) => (o.roomName ?? "").trim().toLowerCase();
  if (room(base) && room(other) && room(base) !== room(other)) {
    differences.push(`Different room type (${other.roomName} vs ${base.roomName})`);
  }

  const meal = (o: HotelOffer) => (o.mealPlan ?? "room only").trim().toLowerCase();
  if (meal(base) !== meal(other)) {
    differences.push(
      `Meal plan differs (${other.mealPlan ?? "Room only"} vs ${base.mealPlan ?? "Room only"})`,
    );
  }

  const cancellation = (o: HotelOffer) => (o.cancellationPolicy ?? "not stated").trim().toLowerCase();
  if (cancellation(base) !== cancellation(other)) {
    differences.push(
      `Cancellation policy differs (${other.cancellationPolicy ?? "not stated"} vs ${base.cancellationPolicy ?? "not stated"})`,
    );
  }

  if ((base.guests ?? 0) !== (other.guests ?? 0)) {
    differences.push(`Different guest count (${other.guests} vs ${base.guests})`);
  }

  const baseNights = nightsBetween(base.checkIn, base.checkOut);
  const otherNights = nightsBetween(other.checkIn, other.checkOut);
  if (baseNights !== otherNights) {
    differences.push(`Different number of nights (${otherNights} vs ${baseNights})`);
  }

  if ((base.mandatoryFees ?? 0) !== (other.mandatoryFees ?? 0)) {
    differences.push("Mandatory fees differ");
  }

  if ((base.currency ?? "INR") !== (other.currency ?? "INR")) {
    differences.push(`Different currency (${other.currency} vs ${base.currency})`);
  }

  return differences;
}

/** Build the full comparison split into verified and observed buckets. */
export function buildComparison(offers: HotelOffer[]): Comparison {
  const converted = offers
    .map(toComparison)
    .filter((o): o is ComparisonOffer => o !== null);

  const verified = converted
    .filter((o) => o.isVerified)
    .sort((a, b) => a.total - b.total);

  const observed = converted
    .filter((o) => !o.isVerified)
    .sort((a, b) => a.total - b.total);

  const cheapestVerified = verified[0];
  const cheapestObserved = observed[0];

  // Annotate every offer with how it differs from the cheapest verified one.
  for (const entry of verified) {
    entry.differences =
      cheapestVerified && entry !== cheapestVerified
        ? describeOfferDifferences(cheapestVerified.offer, entry.offer)
        : [];
  }
  for (const entry of observed) {
    entry.differences = cheapestVerified
      ? describeOfferDifferences(cheapestVerified.offer, entry.offer)
      : [];
  }

  let averageVerified: number | undefined;
  let savingsVsAverage: number | undefined;
  if (cheapestVerified && verified.length > 1) {
    const others = verified.slice(1);
    averageVerified = Math.round(
      others.reduce((sum, o) => sum + o.total, 0) / others.length,
    );
    savingsVsAverage = Math.max(0, averageVerified - cheapestVerified.total);
  } else if (cheapestVerified) {
    averageVerified = cheapestVerified.total;
    savingsVsAverage = 0;
  }

  return {
    verified,
    observed,
    cheapestVerified,
    cheapestObserved,
    averageVerified,
    savingsVsAverage,
  };
}

/** True when the cheapest unverified price undercuts the cheapest verified one. */
export function hasTemptingUnverified(comparison: Comparison): boolean {
  if (!comparison.cheapestVerified || !comparison.cheapestObserved) return false;
  return comparison.cheapestObserved.total < comparison.cheapestVerified.total;
}

export function formatMoney(amount: number | undefined, currency = "INR"): string {
  if (amount === undefined || !Number.isFinite(amount)) return "—";
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${Math.round(amount).toLocaleString("en-IN")}`;
}
