import type { RawSearchResult, ResearchProvider } from "../types";
import { isPublicHttpsUrl, providerForHostname, sanitizeUntrustedText } from "../urlSafety";

/**
 * WebSearchProvider — uses a *permitted* search API (Exa, Brave Search or
 * Serper) to discover publicly available hotel/booking pages. It does not
 * scrape sites that prohibit automated access, does not bypass CAPTCHA / bot
 * protection, and only reads the snippets the search API already returns.
 *
 * The provider is intentionally conservative: text from the web is treated as
 * untrusted DATA and sanitised before use. Prices found in snippets are always
 * surfaced as OBSERVED — never VERIFIED.
 */

export type WebSearchKind = "exa" | "brave" | "serper";

interface WebSearchConfig {
  kind: WebSearchKind;
  apiKey: string;
}

/** Detect a configured search API from the environment. Returns null when absent. */
export function detectWebSearchConfig(
  env: Record<string, string | undefined>,
): WebSearchConfig | null {
  if (env.EXA_API_KEY) return { kind: "exa", apiKey: env.EXA_API_KEY };
  if (env.BRAVE_SEARCH_API_KEY) return { kind: "brave", apiKey: env.BRAVE_SEARCH_API_KEY };
  if (env.SERPER_API_KEY) return { kind: "serper", apiKey: env.SERPER_API_KEY };
  return null;
}

/** Pull the first INR-ish price out of untrusted text. */
export function extractObservedPrice(text: string): number | undefined {
  const matches = text.matchAll(/(?:₹|rs\.?\s?|inr\s?)([\d,]{3,})/gi);
  for (const m of matches) {
    const value = parseInt(m[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(value) && value >= 500 && value <= 10_000_000) return value;
  }
  return undefined;
}

interface NormalizedItem {
  title: string;
  url: string;
  snippet: string;
}

function requestFor(config: WebSearchConfig, query: string): { url: string; init: RequestInit } {
  switch (config.kind) {
    case "exa":
      return {
        url: "https://api.exa.ai/search",
        init: {
          method: "POST",
          headers: {
            "x-api-key": config.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query,
            numResults: 10,
            type: "auto",
            contents: { text: { maxCharacters: 800 } },
          }),
        } satisfies RequestInit,
      };
    case "brave":
      return {
        url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=in`,
        init: {
          method: "GET",
          headers: { Accept: "application/json", "X-Subscription-Token": config.apiKey },
        } satisfies RequestInit,
      };
    case "serper":
      return {
        url: "https://google.serper.dev/search",
        init: {
          method: "POST",
          headers: {
            "X-API-KEY": config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q: query, gl: "in", num: 10 }),
        } satisfies RequestInit,
      };
  }
}

function parseItems(kind: WebSearchKind, data: unknown): NormalizedItem[] {
  const payload = data as {
    results?: Array<{ title?: string; url?: string; text?: string }>;
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  if (kind === "exa") {
    return (payload.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.text ?? "",
    }));
  }
  if (kind === "brave") {
    return (payload.web?.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }));
  }
  return (payload.organic ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
  }));
}

export class WebSearchProvider implements ResearchProvider {
  name = "web-search";
  live = true;

  private readonly config: WebSearchConfig;

  constructor(config: WebSearchConfig) {
    this.config = config;
  }

  async search(query: string): Promise<RawSearchResult[]> {
    const { url, init } = requestFor(this.config, query);
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`${this.config.kind} search error ${response.status}`);
    }

    const data = await response.json();
    const out: RawSearchResult[] = [];

    for (const item of parseItems(this.config.kind, data)) {
      if (!isPublicHttpsUrl(item.url)) continue;
      let hostname = "";
      try {
        hostname = new URL(item.url).hostname.toLowerCase();
      } catch {
        continue;
      }
      const snippet = sanitizeUntrustedText(item.snippet, 600);
      out.push({
        title: sanitizeUntrustedText(item.title, 200) || item.url,
        url: item.url,
        snippet,
        source: hostname,
        providerName: providerForHostname(hostname),
        observedPrice: extractObservedPrice(`${item.title} ${snippet}`),
        priceStatus: "observed",
        confidence: "low",
        notes: "Price observed in a public search result — not verified for your exact dates.",
      });
    }

    return out;
  }
}
