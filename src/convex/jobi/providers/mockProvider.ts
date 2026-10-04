import type { ParsedQuery, RawSearchResult, ResearchContext, ResearchProvider } from "../types";

/**
 * MockResearchProvider — clearly-labelled DEMO data.
 *
 * Used when no live search API key is configured (or when JOBI_FORCE_DEMO is
 * set). It produces a realistic spread of verified and unverified offers so the
 * entire payment → research → comparison → results flow can be exercised
 * end-to-end without hitting any third party.
 */

const PROVIDERS: Array<{ name: string; domain: string }> = [
  { name: "Agoda", domain: "agoda.com" },
  { name: "Booking.com", domain: "booking.com" },
  { name: "MakeMyTrip", domain: "makemytrip.com" },
  { name: "Goibibo", domain: "goibibo.com" },
  { name: "Cleartrip", domain: "cleartrip.com" },
];

const IMAGES = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945",
  "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9",
  "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4",
  "https://images.unsplash.com/photo-1582719508461-905c673771fd",
  "https://images.unsplash.com/photo-1445019980597-93fa8acb246c",
  "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa",
];

const NAME_PREFIXES = [
  "Azure",
  "Casa Verde",
  "The Palm",
  "Serene",
  "Marigold",
  "Coral Cove",
  "Lotus Bloom",
  "Sunstone",
  "Meridian",
];

const NAME_TYPES = [
  "Resort & Spa",
  "Beach Retreat",
  "Boutique Stay",
  "Suites",
  "Hotel",
  "Villas",
];

const BASE_AMENITIES = ["wifi", "parking", "restaurant"];

/** Deterministic 32-bit hash. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function bookingUrlFor(provider: { name: string; domain: string }, parsed: ParsedQuery): string {
  const { destination, checkIn, checkOut, guests } = parsed;
  const city = encodeURIComponent(destination);
  switch (provider.name) {
    case "Agoda":
      return `https://www.agoda.com/search?city=${city}&checkIn=${checkIn}&checkOut=${checkOut}&adults=${guests}`;
    case "Booking.com":
      return `https://www.booking.com/searchresults.html?ss=${city}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${guests}&no_rooms=${parsed.rooms}`;
    case "MakeMyTrip":
      return `https://www.makemytrip.com/hotels/hotel-listing/?checkin=${checkIn}&checkout=${checkOut}&city=${city}`;
    case "Goibibo":
      return `https://www.goibibo.com/hotels/hotels-in-${slugify(destination)}-${checkIn}/`;
    case "Cleartrip":
      return `https://www.cleartrip.com/hotels/results?city=${city}&checkIn=${checkIn}&checkOut=${checkOut}&adults=${guests}`;
    default:
      return `https://www.${provider.domain}/`;
  }
}

function buildCatalog(parsed: ParsedQuery): RawSearchResult[] {
  const seed = hashString(
    `${parsed.destination}|${parsed.checkIn}|${parsed.checkOut}|${parsed.guests}|${parsed.rooms}`,
  );
  const random = mulberry32(seed);
  const checkIn = new Date(`${parsed.checkIn}T00:00:00`);
  const checkOut = new Date(`${parsed.checkOut}T00:00:00`);
  const nights = Math.max(
    1,
    Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000),
  );

  // Anchor the price spread on the budget when given, otherwise on guests/nights.
  const budgetTotal =
    parsed.budget && parsed.budget > 0
      ? parsed.budgetType === "per_night"
        ? parsed.budget * nights
        : parsed.budget
      : 6000 * nights * Math.max(1, parsed.guests / 2);
  const anchor = Math.max(1500, budgetTotal);

  const hotelCount = 6;
  const results: RawSearchResult[] = [];

  for (let i = 0; i < hotelCount; i++) {
    const prefix = NAME_PREFIXES[Math.floor(random() * NAME_PREFIXES.length)];
    const type = NAME_TYPES[Math.floor(random() * NAME_TYPES.length)];
    const localityPart = parsed.locality && i % 2 === 0 ? `${parsed.locality} ` : "";
    const hotelName = `${prefix} ${localityPart}${parsed.destination} ${type}`.replace(/\s+/g, " ");
    // Sorted ascending so index 0 tends to be the cheapest hotel.
    const hotelFactor = 0.87 + (i / hotelCount) * 0.35;

    const providerCount = 2 + Math.floor(random() * 3);
    const shuffled = [...PROVIDERS].sort(() => random() - 0.5).slice(0, providerCount);

    for (const provider of shuffled) {
      const variance = 0.97 + random() * 0.1;
      const total = Math.round(anchor * hotelFactor * variance);
      const taxes = Math.round(total * 0.12);
      const mandatoryFees = total > 5000 ? Math.round(300 + random() * 400) : 0;
      const basePrice = total - taxes - mandatoryFees;

      // Most offers are genuinely verified; a minority are observed snippets.
      const observed = random() < 0.25;
      const priceStatus = observed ? "observed" : "verified";

      const amenities = new Set(BASE_AMENITIES);
      for (const pref of parsed.preferences) {
        if (["pool", "near beach", "sea view", "breakfast included", "spa", "gym"].includes(pref)) {
          amenities.add(pref);
        }
      }

      results.push({
        title: `${hotelName} — ${provider.name}`,
        url: bookingUrlFor(provider, parsed),
        bookingUrl: bookingUrlFor(provider, parsed),
        snippet: observed
          ? `${provider.name} lists ${hotelName} from ₹${total.toLocaleString("en-IN")}. Price shown may not reflect your exact dates.`
          : `${provider.name} shows ${hotelName} at ₹${total.toLocaleString("en-IN")} total for ${nights} nights, ${parsed.guests} guests (taxes included).`,
        source: provider.domain,
        providerName: provider.name,
        hotelName,
        hotelAddress: `${hotelName}, ${parsed.locality ?? parsed.destination}, ${parsed.destination}`,
        destination: parsed.destination,
        roomName: `${random() < 0.5 ? "Deluxe" : "Premium"} ${random() < 0.5 ? "Twin" : "King"} Room`,
        basePrice,
        taxes,
        mandatoryFees,
        totalPrice: total,
        currency: "INR",
        mealPlan: random() < 0.4 ? "Breakfast included" : "Room only",
        cancellationPolicy: random() < 0.5 ? "Free cancellation until 24h before" : "Non-refundable",
        priceStatus,
        confidence: observed ? "low" : "high",
        rating: Math.round((3.9 + random() * 1.0) * 10) / 10,
        imageUrl: `${IMAGES[i % IMAGES.length]}?auto=format&fit=crop&w=1200&q=70`,
        amenities: Array.from(amenities),
        notes: observed ? "Price observed in a search snippet — not verified for your exact dates." : undefined,
      });
    }
  }

  // Guarantee a tempting but UNVERIFIED cheaper offer to exercise the trust logic.
  const cheapest = [...results].sort((a, b) => (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity))[0];
  if (cheapest) {
    const unverifiedTotal = Math.round((cheapest.totalPrice ?? anchor) * 0.94);
    results.push({
      title: `${cheapest.hotelName} — Trivago`,
      url: "https://www.trivago.co.in/",
      bookingUrl: "https://www.trivago.co.in/",
      snippet: `A comparison listing suggests ${cheapest.hotelName} may be available from ₹${unverifiedTotal.toLocaleString("en-IN")}.`,
      source: "trivago.co.in",
      providerName: "Trivago",
      hotelName: cheapest.hotelName!,
      destination: parsed.destination,
      observedPrice: unverifiedTotal,
      currency: "INR",
      priceStatus: "observed",
      confidence: "low",
      notes: "Comparison aggregator price — could not be verified for your exact dates.",
    });
  }

  return results;
}

/** Per-run cache so the catalog is only generated once per research context. */
const emitted = new WeakMap<ResearchContext, boolean>();

export class MockResearchProvider implements ResearchProvider {
  name = "mock";
  live = false;

  async search(_query: string, ctx: ResearchContext): Promise<RawSearchResult[]> {
    if (emitted.get(ctx)) return [];
    emitted.set(ctx, true);
    return buildCatalog(ctx.parsed);
  }
}

export const mockResearchProvider = new MockResearchProvider();
