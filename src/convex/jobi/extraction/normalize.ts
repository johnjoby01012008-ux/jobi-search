/**
 * Convert extraction-service results into the HotelOffer shapes the rest of the
 * Jobi pipeline already understands.
 *
 * Extraction produces one offer per successfully parsed page. We keep the
 * extraction's own confidence and price_verified flags intact, and we attribute
 * each offer to the provider the extractor found on the page.
 */

import type { ExtractionResult } from "./types";
import type { HotelOffer } from "../types";

interface ExtractionOfferFields {
  hotel_name: string;
  provider: string;
  room_name: string | null;
  check_in: string;
  check_out: string;
  guests: number;
  rooms: number;
  price: { amount: number; currency: string };
  price_context: { raw: string; price_type: string; nearby_hints: string[] };
  taxes: number | null;
  total_price: number | null;
  breakfast_included: boolean | null;
  free_cancellation: boolean | null;
  cancellation_text: string | null;
  availability: string | null;
  booking_url: string;
  source_url: string;
  price_verified: boolean;
  confidence: "high" | "medium" | "low";
  rating: number | null;
  address: string | null;
  amenities: string[];
  description: string | null;
  extracted_at: string;
}

function toOffer(extracted: ExtractionOfferFields, checkedAt: string): HotelOffer | null {
  if (!extracted.hotel_name || !extracted.provider) return null;
  if (!extracted.price || extracted.price.amount <= 0) return null;

  const total = extracted.total_price ?? extracted.price.amount;

  return {
    hotelName: extracted.hotel_name,
    providerName: extracted.provider,
    roomName: extracted.room_name ?? undefined,
    checkIn: extracted.check_in,
    checkOut: extracted.check_out,
    guests: extracted.guests,
    rooms: extracted.rooms,
    basePrice: extracted.price.amount,
    taxes: extracted.taxes ?? undefined,
    mandatoryFees: undefined,
    totalPrice: total,
    currency: extracted.price.currency,
    mealPlan: extracted.breakfast_included ? "Breakfast included" : undefined,
    cancellationPolicy: extracted.cancellation_text ?? undefined,
    sourceUrl: extracted.source_url,
    bookingUrl: extracted.booking_url,
    priceStatus: extracted.price_verified ? "verified" : "observed",
    confidence: extracted.confidence,
    checkedAt,
    rating: extracted.rating ?? undefined,
    hotelAddress: extracted.address ?? undefined,
    amenities: extracted.amenities.length ? extracted.amenities : undefined,
    destination: extracted.hotel_name,
    notes: extractNotes(extracted),
  };
}

function extractNotes(extracted: ExtractionOfferFields): string | undefined {
  const parts: string[] = [];
  if (extracted.price_context?.price_type === "starting_from") {
    parts.push("Price marked as starting-from on the source page — may not reflect your exact dates.");
  }
  if (extracted.price_verified && extracted.price_context?.price_type !== "total") {
    parts.push("Price verified from structured data but not explicitly labelled total.");
  }
  if (!extracted.price_verified) {
    parts.push("Price extracted from the page, not from structured data — treated as observed.");
  }
  if (extracted.amenities.length > 0) {
    parts.push(`Amenities detected: ${extracted.amenities.slice(0, 4).join(", ")}`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

export function extractOffers(
  results: ExtractionResult[],
  checkedAt: string,
): HotelOffer[] {
  const offers: HotelOffer[] = [];
  for (const result of results) {
    if (!result.success || !result.hotel) continue;
    const offer = toOffer(result.hotel, checkedAt);
    if (offer) offers.push(offer);
  }
  return offers;
}

export function extractFailedEntries(
  results: ExtractionResult[],
  checkedAt: string,
): Array<{ url: string; reason: string }> {
  return results
    .filter((r) => !r.success)
    .map((r) => ({ url: r.hotel?.source_url ?? "unknown", reason: r.reason ?? "unknown" }));
}
