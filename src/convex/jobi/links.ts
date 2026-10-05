/**
 * Display-only link builders, safe to import from both the Convex backend and
 * the React frontend (no Convex / React imports).
 */

export interface MapLinkInput {
  hotelName: string;
  locality?: string;
  destination?: string;
}

/**
 * A Google Maps search for a named property. Unlike a provider search URL this
 * always opens something useful for the specific property — its location,
 * address and reviews — even when no booking deep link is available.
 */
export function buildMapUrl({ hotelName, locality, destination }: MapLinkInput): string {
  const query = [hotelName, locality, destination]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export interface PropertySearchInput {
  hotelName: string;
  destination: string;
  locality?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  rooms?: number;
}

/**
 * A Booking.com search scoped to one exact property, with the user's dates and
 * party size pre-filled. This is a *search* deep link — it opens Booking.com's
 * results for the named property rather than a pre-resolved property page,
 * because a real property page id requires a hotel-inventory API.
 */
export function buildBookingSearchUrl({
  hotelName,
  destination,
  locality,
  checkIn,
  checkOut,
  guests = 2,
  rooms = 1,
}: PropertySearchInput): string {
  const ss = [hotelName, locality, destination]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const params = new URLSearchParams({ ss });
  if (checkIn) params.set("checkin", checkIn);
  if (checkOut) params.set("checkout", checkOut);
  params.set("group_adults", String(guests));
  params.set("no_rooms", String(rooms));
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}
