import type { Confidence, HotelOffer } from "./types";

/**
 * Canonical hotel matching.
 *
 * The same hotel shows up as "Taj Holiday Village Resort & Spa",
 * "Taj Holiday Village Goa" and "Taj Holiday Village Resort Goa". We normalise
 * names, compare token overlap, and only merge when confidence is high enough.
 * Low-confidence pairs are never combined (per spec).
 */

const NOISE_WORDS = new Set([
  "hotel",
  "hotels",
  "the",
  "resort",
  "resorts",
  "spa",
  "and",
  "by",
  "at",
  "in",
  "a",
  "an",
  "of",
  "goa",
  "india",
  "official",
  "site",
  "pvt",
  "ltd",
  "limited",
  "beach",
]);

export function normalizeHotelName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hotelTokens(name: string): string[] {
  return normalizeHotelName(name)
    .split(" ")
    .filter((t) => t.length > 1 && !NOISE_WORDS.has(t));
}

/** Jaccard similarity over meaningful tokens. */
export function tokenSimilarity(a: string, b: string): number {
  const setA = new Set(hotelTokens(a));
  const setB = new Set(hotelTokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Extract a brand hint from the leading token(s) — helps confirm matches. */
export function brandOf(name: string): string | undefined {
  const tokens = normalizeHotelName(name).split(" ").filter(Boolean);
  const brand = tokens.find((t) => !NOISE_WORDS.has(t));
  return brand;
}

export function sameDestination(a: string, b: string): boolean {
  const na = normalizeHotelName(a);
  const nb = normalizeHotelName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export interface MatchResult {
  matched: boolean;
  confidence: Confidence;
  signals: string[];
  similarity: number;
}

/** Compare two hotels across name + destination (and brand when available). */
export function matchHotels(
  a: Pick<HotelOffer, "hotelName" | "destination" | "hotelAddress">,
  b: Pick<HotelOffer, "hotelName" | "destination" | "hotelAddress">,
): MatchResult {
  const signals: string[] = [];
  const similarity = tokenSimilarity(a.hotelName, b.hotelName);
  if (similarity >= 0.5) signals.push("name");

  const dest = sameDestination(a.destination, b.destination);
  if (dest) signals.push("destination");

  const brandA = brandOf(a.hotelName);
  const brandB = brandOf(b.hotelName);
  const sameBrand = !!brandA && brandA === brandB;
  if (sameBrand) signals.push("brand");

  let addressSignal = false;
  if (a.hotelAddress && b.hotelAddress) {
    const addrSim = tokenSimilarity(a.hotelAddress, b.hotelAddress);
    if (addrSim >= 0.6) {
      addressSignal = true;
      signals.push("address");
    }
  }

  if (similarity >= 0.8 || (similarity >= 0.5 && (dest || sameBrand) && (dest || addressSignal || sameBrand))) {
    return { matched: true, confidence: "high", signals, similarity };
  }
  if (similarity >= 0.5 && (dest || sameBrand)) {
    return { matched: true, confidence: "medium", signals, similarity };
  }
  if (similarity >= 0.7) {
    return { matched: true, confidence: "medium", signals, similarity };
  }
  return { matched: false, confidence: "low", signals, similarity };
}

/**
 * Group offers into canonical hotels, returning a stable canonical name for each.
 * Offers that cannot be confidently merged stay as their own group.
 */
export function groupByCanonicalHotel(
  offers: HotelOffer[],
): Array<{ canonicalName: string; offers: HotelOffer[] }> {
  const groups: Array<{ canonicalName: string; offers: HotelOffer[] }> = [];

  for (const offer of offers) {
    let placed = false;
    for (const group of groups) {
      const representative = group.offers[0];
      const match = matchHotels(representative, offer);
      const sameDestinationHere = sameDestination(representative.destination, offer.destination);
      if (match.matched && sameDestinationHere && match.confidence !== "low") {
        group.offers.push(offer);
        // Prefer the most descriptive (longest) name as the canonical label.
        if (offer.hotelName.length > group.canonicalName.length) {
          group.canonicalName = offer.hotelName;
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({ canonicalName: offer.hotelName, offers: [offer] });
    }
  }

  return groups;
}

/** Annotate offers with their canonical hotel name and per-group match confidence. */
export function assignCanonicalNames(offers: HotelOffer[]): HotelOffer[] {
  const groups = groupByCanonicalHotel(offers);
  return groups.flatMap((group) => {
    const representative = group.offers[0];
    return group.offers.map((offer) => {
      const match = matchHotels(representative, offer);
      return {
        ...offer,
        canonicalHotelName: group.canonicalName,
        matchConfidence:
          group.offers.length === 1
            ? "high"
            : offer === representative
              ? "high"
              : match.confidence,
      } satisfies HotelOffer;
    });
  });
}
