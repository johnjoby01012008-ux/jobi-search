/**
 * Extraction backend contract types.
 *
 * These mirror the schemas in backend/extractor/schemas.py so the Convex
 * internalAction that calls the extractor keeps the HTTP contract typed and
 * checked. If you change one side, change the other.
 */

export interface PriceAmount {
  amount: number;
  currency: string;
}

export interface PriceAmount {
  amount: number;
  currency: string;
}

export interface PriceContext {
  raw: string;
  price_type: "total" | "starting_from" | "per_night" | "nightly" | "unknown";
  nearby_hints: string[];
}

export interface ExtractedHotel {
  hotel_name: string;
  provider: string;
  room_name: string | null;
  check_in: string;
  check_out: string;
  guests: number;
  rooms: number;
  price: PriceAmount;
  price_context: PriceContext;
  taxes: number | null;
  total_price: number | null;
  breakfast_included: boolean | null;
  free_cancellation: boolean | null;
  cancellation_text: string | null;
  availability: "available" | "limited" | "unavailable" | "unknown" | null;
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

export interface ExtractionResult {
  success: boolean;
  hotel: ExtractedHotel | null;
  reason: "fetch_failed" | "access_blocked" | "parse_failed" | "invalid_price" | "no_hotel_data" | "no_price" | "unsupported_page" | "blocked_url" | "dns_failed" | "connect_failed" | "timeout" | "network_error" | "ssl_error" | "too_many_redirects" | "playwright_unavailable" | "playwright_error" | "playwright_no_response" | "playwright_empty_page" | "redirect_malformed" | "redirect_missing_location" | "block_redirect" | "redirect_block_ip" | "blocked_ip" | null;
  observed_prices: PriceAmount[];
  jsonld_found: boolean;
  playwright_used: boolean;
  notes: Record<string, unknown>;
}

export interface ExtractBatchRequest {
  urls: string[];
  check_in: string;
  check_out: string;
  guests: number;
  rooms: number;
  timeout_seconds: number;
}

export interface ExtractBatchResult {
  successful: ExtractionResult[];
  failed: Array<{
    url: string;
    reason: string;
    status_code?: number;
    jsonld_found?: boolean;
  }>;
  elapsed_seconds: number;
}

export interface ValidateUrlRequest {
  url: string;
}

export interface ValidateUrlResult {
  ok: boolean;
  url: string;
  reason: string | null;
}

/** The backend base URL, read from BACKEND_EXTRACTOR_URL env var. */
export interface ExtractionBackendConfig {
  baseUrl: string;
  timeoutMs: number;
  maxUrlsPerBatch: number;
  enabled: boolean;
}

/**
 * SSRF-safe URL validator result, mirroring backend/extractor/validators.py.
 * Used by the backend-side URLSafety layer before any page is sent to the
 * extraction service.
 */
export interface SafeUrlCheck {
  /** True when the URL is safe to fetch (public https/http, not private/metadata). */
  ok: boolean;
  /** The original URL string, normalized where possible. */
  url: string;
  /** Reason when the URL was rejected (blocked_url, blocked_ip, dns_failed, etc.). */
  reason: string | null;
  /** The final public hostname, if the URL is safe. */
  hostname: string | null;
}

/**
 * License / policy metadata extracted from a provider page alongside the price.
 * Kept separate from the offer so the UI can display it without altering pricing
 * comparison logic.
 */
export interface PagePolicy {
  /** Human-readable cancellation text, if any was detected. */
  cancellationText: string | null;
  /** True when free cancellation was explicitly detected on the page. */
  freeCancellation: boolean | null;
  /** Availability signal detected on the page. */
  availability: "available" | "limited" | "unavailable" | "unknown" | null;
  /** Meal plan / breakfast signal detected on the page. */
  mealPlan: string | null;
}
