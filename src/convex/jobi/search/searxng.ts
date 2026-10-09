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
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  logger?: (event: Record<string, unknown>) => void;
}

export class SearXNGClient {
  private readonly config: SearXNGConfig;

  constructor(config: SearXNGConfig) {
    this.config = config;
  }

  async search(query: string): Promise<SearXNGResult[]> {
    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = this.config.timeoutMs ?? 10_000;
    if (timeout > 0) {
      setTimeout(() => controller.abort(), timeout);
    }
    try {
      const url = new URL(this.config.baseUrl + "/search");
      url.searchParams.set("format", "json");
      url.searchParams.set("q", query);
      url.searchParams.set("language", "en");
      url.searchParams.set("category", this.config.categories ?? "general");
      if (this.config.engines) {
        url.searchParams.set("engines", this.config.engines.join(","));
      }
      const response = await fetchImpl(url.toString(), {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SearchUnavailableError(`Search returned HTTP ${response.status}`);
      }
      const body = await response.json();
      return normalizeSearXNGResponse(body);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SearchUnavailableError("Search request timed out");
      }
      if (error instanceof SearchMalformedResponseError) throw error;
      throw new SearchUnavailableError("Search request failed");
    } finally {
      const durationMs = Date.now() - startedAt;
      this.config.logger?.({ event: "search_ok", durationMs });
    }
  }
}

export function normalizeSearXNGResponse(body: unknown): SearXNGResult[] {
  const results: SearXNGResult[] = [];
  if (!body || typeof body !== "object") return results;
  const items = (body as { results?: unknown[] }).results;
  if (!Array.isArray(items)) return results;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const title = raw.title;
    const url = raw.url;
    if (typeof title !== "string" || !title) continue;
    if (typeof url !== "string" || !/^https?:$/.test(url)) continue;
    if (!/^https?:$/.test(url)) continue;
    results.push({
      title,
      url,
      snippet: typeof raw.content === "string" ? raw.content : "",
      source: raw.engine ? normalizeEngine(raw.engine) : "unknown",
      price: typeof raw.price === "number" ? raw.price : null,
      currency: typeof raw.currency === "string" ? raw.currency : null,
      hotelName: typeof raw.hotelName === "string" ? raw.hotelName : undefined,
      location: typeof raw.location === "string" ? raw.location : undefined,
      rating: typeof raw.rating === "number" ? raw.rating : undefined,
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
  let baseUrl = raw.replace(/\/+$/, "");
  if (!/^https?:$/.test(baseUrl)) return null;
  const config: SearXNGConfig = { baseUrl };
  if (env.SEARXNG_MAX_RESULTS) config.maxResults = Number.parseInt(env.SEARXNG_MAX_RESULTS, 10);
  if (env.SEARXNG_TIMEOUT) config.timeoutMs = Number.parseInt(env.SEARXNG_TIMEOUT, 10);
  if (env.SEARXNG_CACHE_TTL) config.cacheTtlSeconds = Number.parseInt(env.SEARXNG_CACHE_TTL, 10);
  if (env.SEARXNG_ENGINES) config.engines = env.SEARXNG_ENGINES.split(",").map((e) => e.trim()).filter(Boolean);
  if (env.SEARXNG_CATEGORIES) config.categories = env.SEARXNG_CATEGORIES;
  return Object.keys(config).length > 1 ? config : null;
}

export function detectSearXNGConfig(
  env: Record<string, string | undefined> = {},
): SearXNGConfig | null {
  return resolveSearXNGConfig(env);
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function hotelNameFromTitle(title: string): string | null {
  const match = title.match(/^(.*?)\s*[—-]\s*([A-Za-z0-9][A-Za-z0-9 &'.-]*)$/);
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

export function searchWeb(
  query: string,
  options: { client?: SearXNGClient; env?: Record<string, string | undefined> } = {},
): Promise<SearXNGResult[]> {
  const { client, env } = options;
  const config = client ?? new SearXNGClient({
    baseUrl: resolveSearXNGConfig(env)?.baseUrl ?? "",
    timeoutMs: resolveSearXNGConfig(env)?.timeoutMs ?? 10_000,
    fetchImpl: resolveSearXNGConfig(env)?.fetchImpl,
    logger: resolveSearXNGConfig(env)?.logger,
  });
  if (!config.baseUrl) throw new SearchUnavailableError("SearXNG is not configured");
  return config.search(query);
}
