import { extractPrice, extractRating } from "./price";

export interface SearXNGResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  price: number | null;
  currency: string | null;
  hotelName?: string;
  location?: string;
  rating?: number;
}

export interface SearXNGConfig {
  baseUrl: string;
  timeoutMs?: number;
  cacheTtlSeconds?: number;
  maxResults?: number;
  categories?: string;
  engines?: string[];
  /**
   * Shared server-side secret sent as `X-Jobi-Token` on every request.
   * Required by the deployed edge (Render single-service proxy); unset in
   * local development where SearXNG is reached directly. Never exposed to
   * the browser — only read from Convex env.
   */
  authToken?: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  logger?: (event: Record<string, unknown>) => void;
}

/** Defaults shared by `resolveSearXNGConfig` and the client. */
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_SECONDS = 900;
const DEFAULT_MAX_RESULTS = 15;

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Hostname of an http(s) URL, or null when the URL is unusable. */
function hostnameOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

function isUsableUrl(url: string): boolean {
  const hostname = hostnameOf(url);
  if (!hostname) return false;
  // Never follow results pointing back at the loopback interface.
  if (hostname === "localhost" || /^127\.|\[::1\]/.test(hostname)) return false;
  return true;
}

export class SearXNGClient {
  private readonly config: SearXNGConfig;
  private readonly cache = new Map<
    string,
    { results: SearXNGResult[]; expiresAt: number }
  >();
  private readonly inFlight = new Map<string, Promise<SearXNGResult[]>>();

  constructor(config: SearXNGConfig) {
    this.config = config;
  }

  async search(query: string): Promise<SearXNGResult[]> {
    const key = query.trim().toLowerCase();
    if (!key) return [];

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.config.logger?.({ event: "search_cache_hit", resultCount: cached.results.length });
      return cached.results;
    }

    // Identical concurrent queries share one network request.
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.runSearch(query, key);
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async runSearch(query: string, key: string): Promise<SearXNGResult[]> {
    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const abortTimer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined;

    try {
      const url = new URL(this.config.baseUrl + "/search");
      url.searchParams.set("format", "json");
      url.searchParams.set("q", query);
      url.searchParams.set("language", "en");
      url.searchParams.set("category", this.config.categories ?? "general");
      if (this.config.engines?.length) {
        url.searchParams.set("engines", this.config.engines.join(","));
      }

      const response = await fetchImpl(url.toString(), {
        signal: controller.signal,
        ...(this.config.authToken
          ? { headers: { "X-Jobi-Token": this.config.authToken } }
          : {}),
      });
      if (!response.ok) {
        throw new SearchUnavailableError(`Search returned HTTP ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new SearchMalformedResponseError("SearXNG returned unparseable JSON");
      }

      const results = normalizeSearXNGResponse(body);
      const limited =
        this.config.maxResults && this.config.maxResults > 0
          ? results.slice(0, this.config.maxResults)
          : results;

      const ttl = (this.config.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
      this.cache.set(key, { results: limited, expiresAt: Date.now() + ttl });

      this.config.logger?.({
        event: "search_ok",
        durationMs: Date.now() - startedAt,
        resultCount: limited.length,
      });
      return limited;
    } catch (error) {
      if (error instanceof SearchMalformedResponseError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SearchUnavailableError("Search request timed out");
      }
      throw new SearchUnavailableError("Search request failed");
    } finally {
      if (abortTimer) clearTimeout(abortTimer);
    }
  }
}

/**
 * Normalize one SearXNG JSON response into `SearXNGResult`s.
 *
 * Snippet text is untrusted DATA: prices/ratings are only reported when an
 * explicit currency/rating marker is present (see `search/price`). The result
 * `source` is the search engine that produced the hit, falling back to the
 * URL hostname when the engine is unknown.
 */
export function normalizeSearXNGResponse(body: unknown): SearXNGResult[] {
  if (!body || typeof body !== "object") return [];
  const items = (body as { results?: unknown }).results;
  if (items !== undefined && !Array.isArray(items)) {
    throw new SearchMalformedResponseError("SearXNG response has a malformed results array");
  }
  if (!Array.isArray(items)) return [];

  const results: SearXNGResult[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const title = raw.title;
    const url = raw.url;
    if (typeof title !== "string" || !title) continue;
    if (typeof url !== "string" || !isUsableUrl(url)) continue;

    const snippet = typeof raw.content === "string" ? raw.content : "";
    const price = extractPrice(snippet);
    results.push({
      title,
      url,
      snippet,
      source:
        typeof raw.engine === "string" && raw.engine
          ? normalizeEngine(raw.engine)
          : hostnameOf(url) ?? "unknown",
      price: price?.amount ?? null,
      currency: price?.currency ?? null,
      hotelName: hotelNameFromTitle(title) ?? undefined,
      location: locationFromText(`${title} ${snippet}`) ?? undefined,
      rating: typeof raw.rating === "number" ? raw.rating : extractRating(snippet),
    });
  }
  return results;
}

function normalizeEngine(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export function resolveSearXNGConfig(
  env: Record<string, string | undefined> = {},
): SearXNGConfig | null {
  const raw = env.SEARXNG_URL?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const baseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, "");

  const config: SearXNGConfig = {
    baseUrl,
    timeoutMs: parsePositiveInt(env.SEARCH_TIMEOUT ?? env.SEARXNG_TIMEOUT) ?? DEFAULT_TIMEOUT_MS,
    cacheTtlSeconds:
      parsePositiveInt(env.SEARCH_CACHE_TTL ?? env.SEARXNG_CACHE_TTL) ??
      DEFAULT_CACHE_TTL_SECONDS,
    maxResults: parsePositiveInt(env.SEARXNG_MAX_RESULTS) ?? DEFAULT_MAX_RESULTS,
  };
  if (env.SEARXNG_ENGINES) {
    const engines = env.SEARXNG_ENGINES.split(",").map((e) => e.trim()).filter(Boolean);
    if (engines.length) config.engines = engines;
  }
  if (env.SEARXNG_CATEGORIES?.trim()) config.categories = env.SEARXNG_CATEGORIES.trim();
  if (env.JOBI_EDGE_TOKEN?.trim()) config.authToken = env.JOBI_EDGE_TOKEN.trim();
  return config;
}

export function detectSearXNGConfig(
  env: Record<string, string | undefined> = {},
): SearXNGConfig | null {
  return resolveSearXNGConfig(env);
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Best-effort hotel name from a page title, stripping any trailing site
 * marker ("… — Booking.com", "… | Agoda", "… - Goibibo").
 */
export function hotelNameFromTitle(title: string): string | null {
  const match = title.match(/^(.*?)\s*[—–|-]\s*([A-Za-z0-9][^|—–-]*)$/);
  if (!match) return null;
  const name = match[1].trim();
  return name || null;
}

export function locationFromText(text: string): string | null {
  const match = text.match(/in\s+([A-Z][a-z]+)/);
  if (!match) return null;
  return match[1];
}

export class SearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

export class SearchMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchMalformedResponseError";
  }
}

/**
 * Run one web search.
 *
 * When a caller supplies its own client it is used as-is; otherwise the
 * client is built from `env` (default `process.env`), and a missing
 * `SEARXNG_URL` yields a clean `SearchUnavailableError`.
 *
 * Results are re-sourced by their URL hostname so downstream code always
 * knows which booking platform a row came from, regardless of which
 * meta-search engine surfaced it.
 */
export async function searchWeb(
  query: string,
  options: { client?: SearXNGClient; env?: Record<string, string | undefined> } = {},
): Promise<SearXNGResult[]> {
  let client = options.client;
  if (!client) {
    const resolved = resolveSearXNGConfig(options.env ?? process.env);
    if (!resolved?.baseUrl) throw new SearchUnavailableError("SearXNG is not configured");
    client = new SearXNGClient({
      baseUrl: resolved.baseUrl,
      timeoutMs: resolved.timeoutMs,
      cacheTtlSeconds: resolved.cacheTtlSeconds,
      maxResults: resolved.maxResults,
      engines: resolved.engines,
      categories: resolved.categories,
      authToken: resolved.authToken,
    });
  }

  const results = await client.search(query);
  return results.map((result) => ({
    ...result,
    source: hostnameOf(result.url) ?? result.source,
  }));
}
