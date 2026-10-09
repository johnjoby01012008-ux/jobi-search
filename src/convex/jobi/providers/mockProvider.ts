import { buildBookingSearchUrl } from "../links";
import type { ParsedQuery, RawSearchResult, ResearchContext, ResearchProvider } from "../types";

/**
 * MockResearchProvider - clearly-labelled DEMO data.
 *
 * Used when no live search API key is configured (or when JOBI_FORCE_DEMO is
 * set). It produces a realistic spread of verified and unverified offers so the
 * entire payment -> research -> comparison -> results flow can be exercised
 * end-to-end without hitting any third party.
 *
 * The catalog is seeded deterministically from the request so the same
 * destination/dates/party always produces the same set of offers.
 */

const PROVIDERS: Array<{ name: string; id: string; domain: string }> = [
  { name: "Booking.com", id: "booking", domain: "booking.com" },
  { name: "Agoda", id: "agoda", domain: "agoda.com" },
  { name: "MakeMyTrip", id: "makemytrip", domain: "makemytrip.com" },
  { name: "Goibibo", id: "goibibo", domain: "goibibo.com" },
  { name: "Expedia", id: "expedia", domain: "expedia.com" },
  { name: "Hotels.com", id: "hotels_com", domain: "hotels.com" },
  { name: "Trip.com", id: "trip", domain: "trip.com" },
  { name: "EasyMyTrip", id: "easemytrip", domain: "easemytrip.com" },
  { name: "Cleartrip", id: "cleartrip", domain: "cleartrip.com" },
];

const OFFICIAL_DOMAINS = [
  "tajhotels.com",
  "marriott.com",
  "hilton.com",
  "ihg.com",
  "accor.com",
  "hyatt.com",
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

function bookingUrlFor(
  provider: { name: string; id: string; domain: string },
  parsed: ParsedQuery,
  hotelName: string,
): string {
  const { destination, checkIn, checkOut, guests, rooms } = parsed;
  const city = encodeURIComponent(destination);
  const property = encodeURIComponent(hotelName + " " + destination);
  switch (provider.id) {
    case "agoda":
      return "https://www.agoda.com/search?textToSearch=" + property + "&checkIn=" + checkIn + "&checkOut=" + checkOut + "&adults=" + guests + "&rooms=" + rooms;
    case "booking":
      return buildBookingSearchUrl({
        hotelName,
        destination,
        checkIn,
        checkOut,
        guests,
        rooms,
      });
    case "makemytrip":
      return "https://www.makemytrip.com/hotels/hotel-listing/?searchText=" + property + "&checkin=" + checkIn + "&checkout=" + checkOut;
    case "goibibo":
      return "https://www.goibibo.com/hotels/hotels-in-" + slugify(destination) + "-" + checkIn + "/";
    case "expedia":
      return "https://www.expedia.com/hotels/hotels-results.htm?destination=" + city + "&checkin=" + checkIn + "&checkout=" + checkOut + "&group_adults=" + guests + "&no_rooms=" + rooms;
    case "hotels_com":
      return "https://www.hotels.com/results?destination=" + city + "&checkin=" + checkIn + "&checkout=" + checkOut + "&group_adults=" + guests + "&no_rooms=" + rooms;
    case "trip":
      return "https://www.trip.com/hotels/" + destination + "/?checkin=" + checkIn + "&checkout=" + checkOut + "&group_adults=" + guests + "&no_rooms=" + rooms;
    case "easemytrip":
      return "https://www.easemytrip.com/hotels/hotels-in-" + slugify(destination) + "-" + checkIn + "/";
    case "cleartrip":
      return "https://www.cleartrip.com/hotels/results?city=" + city + "&checkIn=" + checkIn + "&checkOut=" + checkOut + "&adults=" + guests;
    default:
      return "https://www." + provider.domain + "/";
  }
}

function officialBookingUrl(parsed: ParsedQuery, hotelName: string): string {
  const { destination, checkIn, checkOut, guests, rooms } = parsed;
  const city = encodeURIComponent(destination);
  const property = encodeURIComponent(hotelName + " " + destination);
  const official = OFFICIAL_DOMAINS[hashString(hotelName + destination) % OFFICIAL_DOMAINS.length];
  return "https://www." + official.replace(".com", "") + ".com/search?query=" + property + "&checkin=" + checkIn + "&checkout=" + checkOut + "&adults=" + guests + "&rooms=" + rooms;
}

function buildCatalog(parsed: ParsedQuery): RawSearchResult[] {
  const seed = hashString(
    parsed.destination + "|" + parsed.checkIn + "|" + parsed.checkOut + "|" + parsed.guests + "|" + parsed.rooms,
  );
  const random = mulberry32(seed);
  const checkIn = new Date(parsed.checkIn + "T00:00:00");
  const checkOut = new Date(parsed.checkOut + "T00:00:00");
  const nights = Math.max(
    1,
    Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000),
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
    const localityPart = parsed.locality && i % 2 === 0 ? parsed.locality + " " : "";
    const hotelName = prefix + " " + localityPart + parsed.destination + " " + type;
    // Sorted ascending so index 0 tends to be the cheapest hotel.
    const hotelFactor = 0.87 + (i / hotelCount) * 0.35;

    const providerCount = 2 + Math.floor(random() * 3);
    const shuffled = PROVIDERS.slice().sort(() => random() - 0.5).slice(0, providerCount);

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
        title: hotelName + " - " + provider.name,
        url: bookingUrlFor(provider, parsed, hotelName),
        bookingUrl: bookingUrlFor(provider, parsed, hotelName),
        snippet: observed
          ? provider.name + " lists " + hotelName + " from " + total.toLocaleString("en-IN") + ". Price shown may not reflect your exact dates."
          : provider.name + " shows " + hotelName + " at " + total.toLocaleString("en-IN") + " total for " + nights + " nights, " + parsed.guests + " guests (taxes included).",
        source: provider.domain,
        providerName: provider.name,
        hotelName,
        hotelAddress: hotelName + ", " + (parsed.locality || parsed.destination) + ", " + parsed.destination,
        destination: parsed.destination,
        roomName: (random() < 0.5 ? "Deluxe" : "Premium") + " " + (random() < 0.5 ? "Twin" : "King") + " Room",
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
        imageUrl: IMAGES[i % IMAGES.length] + "?auto=format&fit=crop&w=1200&q=70",
        amenities: Array.from(amenities),
        notes: observed ? "Price observed in a search snippet - not verified for your exact dates." : undefined,
      });
    }
  }

  // Guarantee a tempting but UNVERIFIED cheaper offer to exercise the trust logic.
  const cheapest = results.slice().sort((a, b) => (a.totalPrice || Infinity) - (b.totalPrice || Infinity))[0];
  if (cheapest) {
    const unverifiedTotal = Math.round((cheapest.totalPrice || anchor) * 0.94);
    results.push({
      title: cheapest.hotelName + " - Trivago",
      url: "https://www.trivago.co.in/",
      bookingUrl: "https://www.trivago.co.in/",
      snippet: "A comparison listing suggests " + cheapest.hotelName + " may be available from " + unverifiedTotal.toLocaleString("en-IN") + ".",
      source: "trivago.co.in",
      providerName: "Trivago",
      hotelName: cheapest.hotelName,
      destination: parsed.destination,
      observedPrice: unverifiedTotal,
      currency: "INR",
      priceStatus: "observed",
      confidence: "low",
      notes: "Comparison aggregator price - could not be verified for your exact dates.",
    });
  }

  // Official providers get branded, dated booking URLs so the registry can
  // demonstrate the official-site provider id without making a live call.
  const officialName = NAME_PREFIXES[Math.floor(random() * NAME_PREFIXES.length)] + " " + parsed.destination + " " + NAME_TYPES[Math.floor(random() * NAME_TYPES.length)];
  results.push({
    title: officialName + " - Official hotel website",
    url: officialBookingUrl(parsed, officialName),
    bookingUrl: officialBookingUrl(parsed, officialName),
    snippet: "Official " + officialName + " lists the property at " + Math.round((anchor * 0.92) * (0.97 + random() * 0.06)).toLocaleString("en-IN") + " total for " + nights + " nights, " + parsed.guests + " guests (taxes included).",
    source: OFFICIAL_DOMAINS[hashString(officialName) % OFFICIAL_DOMAINS.length],
    providerName: "Official hotel website",
    hotelName: officialName,
    hotelAddress: officialName + ", " + (parsed.locality || parsed.destination) + ", " + parsed.destination,
    destination: parsed.destination,
    roomName: "Premium King Room",
    basePrice: Math.round((anchor * 0.92) * (0.97 + random() * 0.06)) - Math.round((anchor * 0.92) * (0.97 + random() * 0.06)) * 0.12,
    taxes: Math.round((anchor * 0.92) * (0.97 + random() * 0.06)) * 0.12,
    mandatoryFees: 0,
    totalPrice: Math.round((anchor * 0.92) * (0.97 + random() * 0.06)),
    currency: "INR",
    mealPlan: random() < 0.4 ? "Breakfast included" : "Room only",
    cancellationPolicy: "Free cancellation until 48h before",
    priceStatus: "verified",
    confidence: "high",
    rating: Math.round((4.2 + random() * 0.6) * 10) / 10,
    imageUrl: IMAGES[(hotelCount - 1 + 5) % IMAGES.length],
    amenities: Array.from(new Set([...BASE_AMENITIES, "freeCancellation", "breakfastIncluded"])),
    notes: undefined,
  });

  return results;
}

/** Per-run cache so the catalog is only generated once per research context. */
const emitted = new WeakMap();

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
