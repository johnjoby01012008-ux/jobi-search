/**
 * Jobi domain types shared by the Convex backend, the research providers and
 * the frontend. This module is intentionally free of any Convex / React
 * imports so it can be imported anywhere (and unit tested with vitest).
 */

export type PriceStatus = "verified" | "observed" | "estimated" | "unknown";
export type Confidence = "high" | "medium" | "low";
export type BudgetType = "total" | "per_night";

export interface ParsedQuery {
  destination: string;
  locality?: string;
  /** Desired radius around `locality`, in kilometres. */
  proximityKm?: number;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  guests: number;
  rooms: number;
  budget?: number;
  budgetType: BudgetType;
  preferences: string[];
}

/** A normalised hotel offer as described in the Jobi spec. */
export interface HotelOffer {
  hotelName: string;
  hotelAddress?: string;
  destination: string;

  providerName: string;
  bookingUrl: string;

  roomName?: string;

  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;

  basePrice?: number;
  taxes?: number;
  mandatoryFees?: number;
  totalPrice?: number;
  currency: string;

  mealPlan?: string;
  cancellationPolicy?: string;

  sourceUrl: string;

  priceStatus: PriceStatus;
  confidence: Confidence;
  checkedAt: string;

  rating?: number;
  imageUrl?: string;
  amenities?: string[];
  notes?: string;

  /** Canonical identity assigned during hotel matching. */
  canonicalHotelName?: string;
  matchConfidence?: Confidence;

  /**
   * Human-readable ways this offer differs from the cheapest verified offer
   * (room type, meal plan, cancellation, guests, nights, fees, currency).
   * Filled in by the comparison step so we never imply two different products
   * are equivalent.
   */
  comparisonDifferences?: string[];
}

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  /** Present when a provider can surface a structured price observed in a result. */
  observedPrice?: number;
  observedCurrency?: string;

  // ---- Optional structured fields -------------------------------------
  // Live web-search providers fill these by interpreting a page/snippet.
  // Simulated + future OTA API providers can fill them directly. When absent
  // the normaliser falls back to treating the result as an OBSERVED price.
  providerName?: string;
  hotelName?: string;
  hotelAddress?: string;
  destination?: string;
  roomName?: string;
  bookingUrl?: string;
  basePrice?: number;
  taxes?: number;
  mandatoryFees?: number;
  totalPrice?: number;
  currency?: string;
  mealPlan?: string;
  cancellationPolicy?: string;
  priceStatus?: PriceStatus;
  confidence?: Confidence;
  rating?: number;
  imageUrl?: string;
  amenities?: string[];
  notes?: string;
}

export interface ResearchContext {
  queries: string[];
  parsed: ParsedQuery;
  /** Hard caps so a paid request can never run away with cost. */
  budget: {
    maxQueries: number;
    maxPages: number;
    maxDurationMs: number;
  };
  startedAt: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  observedPrice?: number;
  observedCurrency?: string;
}

/** The pluggable interface every research provider must satisfy. */
export interface ResearchProvider {
  name: string;
  /** Whether this provider returns live web data (false for the mock). */
  live: boolean;
  search(query: string, ctx: ResearchContext): Promise<RawSearchResult[]>;
}

export interface ComparisonOffer {
  offer: HotelOffer;
  total: number;
  isVerified: boolean;
  /** How this offer differs from the cheapest verified offer (empty for it). */
  differences: string[];
}

export interface Comparison {
  verified: ComparisonOffer[];
  observed: ComparisonOffer[];
  /** Currency all numeric totals are ranked within; foreign-currency offers rank after it. */
  referenceCurrency: string;
  /** The cheapest offer with verified pricing — the only thing Jobi may call "cheapest". */
  cheapestVerified?: ComparisonOffer;
  /** Cheapest unverified price, surfaced transparently but never as "cheapest". */
  cheapestObserved?: ComparisonOffer;
  averageVerified?: number;
  /** Saving vs. the average of the other verified offers. */
  savingsVsAverage?: number;
}
