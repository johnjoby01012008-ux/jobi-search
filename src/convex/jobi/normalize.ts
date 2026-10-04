import type { HotelOffer, ParsedQuery, PriceStatus, RawSearchResult } from "./types";
import { providerForHostname, validateBookingUrl } from "./urlSafety";

/** Provider name we attribute a result to based on its source domain. */
function providerFromResult(result: RawSearchResult): string {
  if (result.providerName) return result.providerName;
  try {
    const hostname = new URL(result.url).hostname.toLowerCase();
    return providerForHostname(hostname) ?? result.source;
  } catch {
    return result.source;
  }
}

/**
 * Normalise one discovered search result into a HotelOffer.
 *
 * A snippet that merely mentions a price becomes an OBSERVED offer — it is
 * never promoted to VERIFIED, because we cannot prove it applies to the user's
 * exact dates/guests/room. Structured fields (only produced when a provider
 * genuinely read the offer) can be VERIFIED.
 */
export function normalizeResult(
  result: RawSearchResult,
  parsed: ParsedQuery,
  checkedAt: string,
): HotelOffer | null {
  if (!result.url || !result.title) return null;

  const hotelName = (result.hotelName ?? result.title).replace(/\s+[-|–].*$/, "").trim();
  if (!hotelName) return null;

  const bookingCandidate = result.bookingUrl ?? result.url;
  const booking = validateBookingUrl(bookingCandidate);
  // Without a validated booking link we still keep the offer but send the user
  // to the source page; it is never presented as a "verified" link.
  const bookingUrl = booking.ok ? booking.url! : result.url;

  const hasStructured =
    result.totalPrice !== undefined ||
    result.basePrice !== undefined ||
    result.priceStatus !== undefined;

  let priceStatus: PriceStatus;
  if (result.priceStatus) {
    priceStatus = result.priceStatus;
  } else if (hasStructured) {
    priceStatus = "verified";
  } else if (result.observedPrice !== undefined) {
    priceStatus = "observed";
  } else {
    priceStatus = "unknown";
  }

  const confidence =
    result.confidence ?? (priceStatus === "verified" ? "high" : result.observedPrice !== undefined ? "low" : "low");

  return {
    hotelName,
    hotelAddress: result.hotelAddress,
    destination: result.destination ?? parsed.destination,
    providerName: providerFromResult(result),
    bookingUrl,
    roomName: result.roomName,
    checkIn: parsed.checkIn,
    checkOut: parsed.checkOut,
    guests: parsed.guests,
    rooms: parsed.rooms,
    basePrice: result.basePrice,
    taxes: result.taxes,
    mandatoryFees: result.mandatoryFees,
    totalPrice: result.totalPrice ?? result.observedPrice,
    currency: result.currency ?? result.observedCurrency ?? "INR",
    mealPlan: result.mealPlan,
    cancellationPolicy: result.cancellationPolicy,
    sourceUrl: result.url,
    priceStatus,
    confidence,
    checkedAt,
    rating: result.rating,
    imageUrl: result.imageUrl,
    amenities: result.amenities,
    notes: result.notes,
  };
}

export function normalizeResults(
  results: RawSearchResult[],
  parsed: ParsedQuery,
  checkedAt: string,
): HotelOffer[] {
  const offers: HotelOffer[] = [];
  for (const result of results) {
    const offer = normalizeResult(result, parsed, checkedAt);
    if (offer) offers.push(offer);
  }
  return offers;
}

/** Collapse duplicate (hotel + provider + total) offers discovered via multiple queries. */
export function dedupeOffers(offers: HotelOffer[]): HotelOffer[] {
  const seen = new Set<string>();
  const out: HotelOffer[] = [];
  for (const offer of offers) {
    const key = [
      offer.hotelName.toLowerCase().replace(/\s+/g, " ").trim(),
      offer.providerName.toLowerCase(),
      offer.totalPrice ?? "na",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(offer);
  }
  return out;
}
