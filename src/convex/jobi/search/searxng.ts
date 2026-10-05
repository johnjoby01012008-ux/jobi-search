/**
 * SearXNG search service.
 *
 * The single place in the codebase that knows how to talk to the self-hosted
 * SearXNG instance. Everything else calls `searchWeb(query)` (or injects a
 * `SearXNGClient` for tests).
 *
 * The base URL comes from the `SEARXNG_URL` environment variable and is NEVER
 * exposed to the frontend. SearXNG itself is reachable only over the internal
 * Docker network (e.g. http://searxng:8080).
 *
 * Design notes:
 * - `price` is `null` when no price is present. Prices are never invented, and
 *   a price observed in a snippet is always reported as OBSERVED, never as an
 *   actual booking price for the user's dates.
 * - A short-lived in-memory cache (configurable via SEARCH_CACHE_TTL) avoids
 *   repeating identical searches. Cache is per backend worker; see the README
 *   limitations for the production upgrade path (shared cache).
 * - Every failure is surfaced as a clean application-level error; raw Docker /
 *   network errors are never propagated to the user.
 */

import { extractPrice, extractRating } from "./price";

export interface SearXNGResult {
  title: string;
  url: string;
  source: string;
  snippet: string;
  price: number | null;
  currency: string | null;
  hotelName: string | null;
  location: string | null;
  rating: number | null;
}

export interface SearXNGConfig {
  baseUrl: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
  maxResults: number;
  language: string;
  engines?: string[];
  categories: string;
  safeSearch: 0 | 1 | 2;
}

/** Read SearXNG connection settings from the environment. Null when unset. */
export function detectSearXNGConfig(
  env: Record<string, string | undefined>,
): { baseUrl: string } | null {
  const raw = env.SEARXNG_URL?.trim();
  if (!raw) return null;
  return { baseUrl: normalizeBaseUrl(raw) };
}

/** Strip trailing slashes so we can safely append `/search`. */
export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Build the full resolved options from the environment + overrides. */
export function resolveSearXNGConfig(
  env: Record<string, string | undefined>,
  overrides: Partial<SearXNGConfig> = {},
): SearXNGConfig | null {
  const detected = detectSearXNGConfig(env);
  const baseUrl = overrides.baseUrl ?? detected?.baseUrl;
  if (!baseUrl) return null;
  const engines = (overrides.engines ?? env.SEARXNG_ENGINES?.split(","))
    ?.map((e) => e.trim())
    .filter(Boolean);
  return {
    baseUrl,
    timeoutMs: overrides.timeoutMs ?? readNumber(env.SEARCH_TIMEOUT, 10_000),
    cacheTtlSeconds:
      overrides.cacheTtlSeconds ?? readNumber(env.SEARCH_CACHE_TTL, 900),
    maxResults: overrides.maxResults ?? readNumber(env.SEARXNG_MAX_RESULTS, 15),
    language: overrides.language ?? env.SEARXNG_LANGUAGE ?? "en",
    categories: overrides.categories ?? env.SEARXNG_CATEGORIES ?? "general",
    safeSearch: overrides.safeSearch ?? 0,
    engines: engines && engines.length > 0 ? engines : undefined,
  };
}

/** Clean, user-safe error for any SearXNG transport failure. */
export class SearchUnavailableError extends Error {
  constructor(message = "Search is temporarily unavailable. Please try again.") {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

/** Raised when SearXNG answers but the payload cannot be understood. */
export class SearchMalformedResponseError extends Error {
  constructor(message = "Search provider returned an unexpected response.") {
    super(message);
    this.name = "SearchMalformedResponseError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SearXNGOptions extends Partial<SearXNGConfig> {
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Structured logger. Secrets are never passed here. */
  logger?: (event: Record<string, unknown>) => void;
}

interface CacheEntry {
  expiresAt: number;
  results: SearXNGResult[];
}

function defaultLogger(event: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(`[searxng] ${JSON.stringify(event)}`);
}

/** Take the leading, most descriptive part of a result title. */
export function hotelNameFromTitle(title: string): string | null {
  const cleaned = title
    .replace(/\s*[|–—]\s*.*$/, "")
    .replace(/\s+-\s+(Booking\.com|Agoda|Expedia|Hotels\.com|Trip\.com|MakeMyTrip|Trivago).*$/i, "")
    .trim();
  if (!cleaned || cleaned.length < 3) return null;
  if (/^https?:\/\//i.test(cleaned)) return null;
  if (cleaned.split(/\s+/).length < 2) return null;
  return cleaned.slice(0, 160);
}

/** Best-effort "in <Place>" location from a snippet. Null when unsure. */
export function locationFromText(text: string): string | null {
  const match = /\b(?:in|near|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/.exec(text);
  return match ? match[1].trim() : null;
}

/** Map one raw SearXNG item into the normalized shape. */
export function normalizeSearXNGResult(item: {
  title?: string;
  url?: string;
  content?: string;
  snippet?: string;
  engine?: string;
}): SearXNGResult | null {
  const url = (item.url ?? "").trim();
  const title = (item.title ?? "").trim();
  if (!url || !title) return null;

  let source = "";
  try {
    source = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  const snippet = (item.content ?? item.snippet ?? "").trim().slice(0, 600);
  const price = extractPrice(`${title} ${snippet}`);
  const rating = extractRating(`${title} ${snippet}`);

  return {
    title: title.slice(0, 300),
    url,
    source,
    snippet,
    price: price ? price.amount : null,
    currency: price ? price.currency : null,
    hotelName: hotelNameFromTitle(title),
    location: locationFromText(snippet),
    rating: rating ?? null,
  };
}

/** Only https URLs on a real public host are worth trusting further. */
function isUsableUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes(".")) return false;
    if (hostname === "localhost" || hostname.endsWith(".local")) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export class SearXNGClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxResults: number;
  private readonly language: string;
  private readonly categories: string;
  private readonly safeSearch: number;
  private readonly engines?: string[];
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly logger: (event: Record<string, unknown>) => void;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<SearXNGResult[]>>();

  constructor(options: SearXNGOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.cacheTtlMs = (options.cacheTtlSeconds ?? 900) * 1000;
    this.maxResults = options.maxResults ?? 15;
    this.language = options.language ?? "en";
    this.categories = options.categories ?? "general";
    this.safeSearch = options.safeSearch ?? 0;
    this.engines = options.engines;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? defaultLogger;
  }

  private buildUrl(query: string): string {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      categories: this.categories,
      language: this.language,
      safesearch: String(this.safeSearch),
      pageno: "1",
    });
    if (this.engines && this.engines.length > 0) {
      params.set("engines", this.engines.join(","));
    }
    return `${this.baseUrl}/search?${params.toString()}`;
  }

  /**
   * Search SearXNG for `query`, returning normalized results. Never throws a
   * raw transport error — callers get `SearchUnavailableError` instead.
   */
  async search(query: string): Promise<SearXNGResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = trimmed.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      this.logger({ event: "cache_hit", queryLength: trimmed.length });
      return cached.results;
    }

    const pending = this.inflight.get(cacheKey);
    if (pending) return pending;

    const run = this.performSearch(trimmed).finally(() => {
      this.inflight.delete(cacheKey);
    });
    this.inflight.set(cacheKey, run);
    return run;
  }

  private async performSearch(query: string): Promise<SearXNGResult[]> {
    const startedAt = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(query), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "JobiSearch/1.0 (self-hosted backend)",
        },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || /aborted/i.test(error.message));
      this.logger({
        event: "search_error",
        reason: aborted ? "timeout" : "network",
        queryLength: query.length,
        durationMs: this.now() - startedAt,
      });
      throw new SearchUnavailableError();
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger({
        event: "search_error",
        reason: "status",
        status: response.status,
        queryLength: query.length,
        durationMs: this.now() - startedAt,
      });
      throw new SearchUnavailableError();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      this.logger({ event: "search_error", reason: "malformed_json" });
      throw new SearchMalformedResponseError();
    }

    const rawItems = (payload as { results?: unknown })?.results;
    if (!Array.isArray(rawItems)) {
      this.logger({ event: "search_error", reason: "malformed_shape" });
      throw new SearchMalformedResponseError();
    }

    const results: SearXNGResult[] = [];
    for (const item of rawItems) {
      const normalized = normalizeSearXNGResult(item as Record<string, string>);
      if (!normalized) continue;
      if (!isUsableUrl(normalized.url)) continue;
      results.push(normalized);
      if (results.length >= this.maxResults) break;
    }

    this.cache.set(query.toLowerCase(), {
      expiresAt: this.now() + this.cacheTtlMs,
      results,
    });

    this.logger({
      event: "search_ok",
      queryLength: query.length,
      resultCount: results.length,
      durationMs: this.now() - startedAt,
    });

    return results;
  }
}

let defaultClient: SearXNGClient | null = null;

/**
 * Reusable backend search service. Other code should call this instead of
 * touching SearXNG directly.
 */
export async function searchWeb(
  query: string,
  options: { env?: Record<string, string | undefined>; client?: SearXNGClient } = {},
): Promise<SearXNGResult[]> {
  const client = options.client ?? getDefaultClient(options.env ?? {});
  if (!client) {
    throw new SearchUnavailableError("Live web search is not configured.");
  }
  return client.search(query);
}

/** Return the shared client for the given env, creating it on first use. */
export function getDefaultClient(
  env: Record<string, string | undefined>,
): SearXNGClient | null {
  if (defaultClient) return defaultClient;
  const config = resolveSearXNGConfig(env);
  if (!config) return null;
  defaultClient = new SearXNGClient(config);
  return defaultClient;
}

/** Reset the memoized client (tests). */
export function resetDefaultClient(): void {
  defaultClient = null;
}
