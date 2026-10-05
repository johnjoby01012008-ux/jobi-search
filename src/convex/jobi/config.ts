/** Central configuration for the Jobi research engine and pricing. */

/** ₹10 flat one-time deep-search fee. */
export const SEARCH_FEE_PAISE = 1000;
export const SEARCH_FEE_RUPEES = 10;
export const CURRENCY = "INR";

export const RESEARCH_BUDGET = {
  /** Maximum distinct search queries per paid request. */
  maxQueries: 20,
  /** Maximum candidate pages fetched / considered per paid request. */
  maxPages: 50,
  /** Maximum wall-clock duration of a single research run. */
  maxDurationMs: 120_000,
} as const;

/** Defaults for the self-hosted SearXNG search layer (overridable by env). */
export const SEARCH_DEFAULTS = {
  /** Seconds an identical query is served from cache. */
  cacheTtlSeconds: 900,
  /** Per-request timeout in milliseconds. */
  timeoutMs: 10_000,
  /** Maximum results kept from a single query. */
  maxResults: 15,
} as const;

/** Clean, user-facing message shown when the search layer is unreachable. */
export const SEARCH_UNAVAILABLE_MESSAGE =
  "Search is temporarily unavailable. Please try again.";

/** Shared cache TTL in seconds, read from `SEARCH_CACHE_TTL`. */
export function searchCacheTtlSeconds(
  env: Record<string, string | undefined> = {},
): number {
  const parsed = Number.parseInt(env.SEARCH_CACHE_TTL ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : SEARCH_DEFAULTS.cacheTtlSeconds;
}

/** Simple guard against request floods per user. */
export const RATE_LIMITS = {
  /** Minimum ms between two research runs from the same user. */
  minMsBetweenSearches: 15_000,
  /** Maximum searches a user may create per rolling hour. */
  maxSearchesPerHour: 30,
} as const;

export const STAGE_LABELS = [
  { key: "understand", label: "Understanding your request" },
  { key: "discover", label: "Finding hotels" },
  { key: "check", label: "Checking booking sources" },
  { key: "compare", label: "Comparing prices" },
  { key: "verify", label: "Verifying cheapest offer" },
] as const;

export function initialStages() {
  return STAGE_LABELS.map((s, i) => ({
    key: s.key,
    label: s.label,
    status: (i === 0 ? "active" : "pending") as "active" | "pending",
  }));
}

export const PRICE_DISCLAIMER =
  "Prices and availability can change. Jobi's result reflects information available at the time of the search. Confirm the final total on the provider's booking page before paying.";
