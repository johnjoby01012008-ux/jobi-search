import type {
  ParsedQuery,
  RawSearchResult,
  ResearchContext,
  ResearchProvider,
} from "../types";
import { SearXNGClient } from "../search/searxng";
import { sanitizeUntrustedText } from "../urlSafety";
import { PROVIDER_MAXIMUMS, PROVIDER_NAME } from "./index";

interface ProviderConfig {
  searxngUrl: string;
  timeoutMs: number;
  maxResults: number;
}

export { buildSearXNGProvider } from "./index";

function providerNameForSource(source: string, rawResult?: { hotelName?: string }) {
  const base = source.replace(/^www\./, "").split(".")[0];
  if (rawResult?.hotelName) {
    return {
      providerName: sanitizeUntrustedText(base) || source,
      hotelName: sanitizeUntrustedText(rawResult.hotelName) || sanitizeUntrustedText(rawResult.hotelName ?? ""),
    };
  }
  return { providerName: sanitizeUntrustedText(base) || source, hotelName: sanitizeUntrustedText(rawResult?.hotelName ?? "") };
}

/** Turn a single SearXNG result into a `RawSearchResult`. */
function toRawSearchResult(
  result: SearXNGClient.SearXNGResultType,
  parsed: ParsedQuery,
  extracted?: {
    hotelName?: string;
    providerName?: string;
    rawHtml?: string;
    price?: number;
    currency?: string;
    rating?: number;
  },
): RawSearchResult {
  const { providerName, hotelName: extractedHotelName } = providerNameForSource(result.source, extracted);

  const snippet = sanitizeUntrustedText(
    extracted?.rawHtml
      ? stripHtml(extracted.rawHtml).slice(0, 600)
      : result.snippet ?? "",
  );

  const observedPrice = extracted?.price ?? result.price;
  const observedCurrency = extracted?.currency ?? result.currency ?? "INR";

  return {
    title: sanitizeUntrustedText(result.title),
    url: result.url,
    snippet,
    source: result.source,
    observedPrice,
    observedCurrency,
    providerName,
    hotelName: extracted?.hotelName ?? extractedHotelName,
    rating: extracted?.rating ?? result.rating,
    notes: extracted?.rawHtml ? "Page fetched and parsed." : "From search result snippet.",
  };
}

/** Strip tags from a small HTML snippet for a human-readable fallback. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isBookPageUrl(url: string): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return (
    /\/(?:hotel|resort|property|rooms?|room|book|check[- ]?in|stay|inn|reserv)/.test(u) ||
    /[?&](room|roomid|hotel|property|check.?in|check.?out|guests|rooms)=/.test(u) ||
    /booking\.com/.test(u) ||
    /agoda\.com/.test(u) ||
    /expedia\.com/.test(u) ||
    /hotels\.com/.test(u) ||
    /trip\.com/.test(u) ||
    /makemytrip\.com/.test(u)
  );
}

function rawClient(cfg: ProviderConfig) {
  return new SearXNGClient(cfg.searxngUrl, {
    timeoutMs: cfg.timeoutMs,
    maxResults: cfg.maxResults,
  });
}

/**
 * A research provider that queries a self-hosted SearXNG instance and reads
 * whatever structured data SearXNG can surface (or that we can read from the
 * snippet/HTML the extractor returns).
 *
 * All prices/observed fields coming out of this provider are OBSERVED unless the
 * extractor explicitly returns verified structured data.
 */
export function buildSearXNGProvider(config: ProviderConfig): ResearchProvider {
  const client = rawClient(config);

  return {
    name: PROVIDER_NAME,
    live: true,

    async search(query: string, ctx: ResearchContext) {
      const results = await client.search(query, {
        budget: ctx.budget,
        startedAt: ctx.startedAt,
      });

      const normalized: RawSearchResult[] = [];
      for (const r of results) {
        if (!isBookPageUrl(r.url)) continue;

        const extracted = ctx.__extractedByUrl?.[r.url] ?? undefined;

        const raw = toRawSearchResult(r, ctx.parsed, extracted);
        normalized.push(raw);

        if (normalized.length >= PROVIDER_MAXIMUMS.maxPages) break;
      }

      return normalized;
    },
  };
}
