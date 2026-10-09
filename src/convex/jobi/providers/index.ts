/**
 * Pluggable research-provider registry.
 *
 * Every provider satisfies `ResearchProvider` from `../types`. The engine only
 * knows about the interface; it does not know which providers exist.
 *
 * `createResearchProvider(env, parsed)` is the single place that decides which
 * provider (or combination) is active right now. Add a new provider here and
 * the research engine picks it up automatically.
 */

import type { ResearchProvider } from "../types";
import { SearXNGProvider } from "./searxngProvider";
import { mockResearchProvider } from "./mockProvider";
import { GeminiProvider } from "./geminiProvider";
import { CompositeProvider } from "./compositeProvider";
import {
  GeminiSearchClient,
  resolveGeminiConfig,
} from "../search/gemini";
import {
  resolveSearXNGConfig,
  SearXNGClient,
  type SearXNGConfig,
} from "../search/searxng";
import type { ParsedQuery } from "../types";
import { PROVIDER_ALLOWLIST } from "../urlSafety";

// Per-provider search/extract/verify strategy. Ordered by priority: the
// highest-value, no-paid-API, no-AI-dependency targets first.
export const REGISTRY: Array<{
  id: string;
  name: string;
  domain: string;
  /** Which SearXNG engines this provider scopes to, empty for all engines. */
  engines?: string[];
  /** Search-string prefix. Kept short so the SearXNG layer does not have to
   *  infer channel qualifiers from a bare generic query.
   */
  searchPrefix?: string;
  /** Extractor does not change today; kept for future per-site extractors. */
  extractFn?: (url: string, parsed: ParsedQuery) => string;
  /** Verify classifier. `sameProvider` keeps the current offer as-is;
   *  `block` downgrades the offer and records why.
   */
  verifyStrategy?: "sameProvider" | "block";
}> = [
  {
    id: "booking",
    name: "Booking.com",
    domain: "booking.com",
    engines: ["booking"],
    searchPrefix: "hotel booking",
    verifyStrategy: "sameProvider",
  },
  {
    id: "agoda",
    name: "Agoda",
    domain: "agoda.com",
    engines: ["agoda"],
    searchPrefix: "hotel agoda",
    verifyStrategy: "sameProvider",
  },
  {
    id: "makemytrip",
    name: "MakeMyTrip",
    domain: "makemytrip.com",
    engines: ["makemytrip"],
    searchPrefix: "hotel makemytrip",
    verifyStrategy: "sameProvider",
  },
  {
    id: "goibibo",
    name: "Goibibo",
    domain: "goibibo.com",
    engines: ["goibibo"],
    searchPrefix: "hotel goibibo",
    verifyStrategy: "sameProvider",
  },
  {
    id: "expedia",
    name: "Expedia",
    domain: "expedia.com",
    engines: ["expedia"],
    searchPrefix: "hotel expedia",
    verifyStrategy: "sameProvider",
  },
  {
    id: "hotels_com",
    name: "Hotels.com",
    domain: "hotels.com",
    engines: ["hotels"],
    searchPrefix: "hotel hotels.com",
    verifyStrategy: "sameProvider",
  },
  {
    id: "trip",
    name: "Trip.com",
    domain: "trip.com",
    engines: ["trip"],
    searchPrefix: "hotel trip.com",
    verifyStrategy: "sameProvider",
  },
  {
    id: "easemytrip",
    name: "EasyMyTrip",
    domain: "easemytrip.com",
    engines: ["easemytrip"],
    searchPrefix: "hotel easemytrip",
    verifyStrategy: "sameProvider",
  },
  {
    id: "cleartrip",
    name: "Cleartrip",
    domain: "cleartrip.com",
    engines: ["cleartrip"],
    searchPrefix: "hotel cleartrip",
    verifyStrategy: "sameProvider",
  },
  {
    id: "official",
    name: "Official hotel website",
    domain: "official",
    searchPrefix: "official website hotel booking",
    // Official sites expose the cleanest names, prices and policy text, so we
    // let the normaliser keep them as verified when structured data allows.
    verifyStrategy: "sameProvider",
  },
];

// Domain → registry id. Official hotel domains map to the special `official`
// provider entry.
export function domainToProviderId(hostname: string): string | null {
  const lowered = hostname.toLowerCase();
  if (!lowered.includes(".") || lowered === "localhost") return null;

  for (const entry of REGISTRY) {
    if (entry.domain === "official") {
      for (const allowed of Object.values(PROVIDER_ALLOWLIST)) {
        for (const domain of allowed) {
          if (lowered === domain || lowered.endsWith(`.${domain}`)) {
            return entry.id;
          }
        }
      }
      continue;
    }
    if (entry.domain === "booking.com") {
      if (lowered === "booking.com" || lowered.endsWith(".booking.com")) return entry.id;
    } else if (entry.domain === lowered || lowered.endsWith(`.${entry.domain}`)) {
      return entry.id;
    }
  }
  return null;
}

/** One SearXNG query per priority provider. The `site:` qualifier stays in the
 *  query list so the search layer can scope results, but it never appears
 *  inside the search string that every engine receives.
 */
export function buildProviderQueries(
  parsed: ParsedQuery,
  limit: number,
  providerId: string,
): string[] {
  const { destination, locality, checkIn, checkOut, guests, rooms } = parsed;
  const ci = longDate(checkIn);
  const co = longDate(checkOut);
  const prefix = REGISTRY.find((p) => p.id === providerId)?.searchPrefix ?? "hotel";
  const suffix = prefix ? ` ${prefix}` : " hotel";

  const queries: string[] = [];

  queries.push(`${destination} ${suffix} ${ci} ${co} ${guests} guests`);
  queries.push(`${destination} hotels ${ci} ${co} ${guests} adults price per night`);
  if (locality) {
    queries.push(`${locality} ${destination} hotels ${ci} ${co} ${guests} adults`);
  }
  queries.push(`${destination} hotel booking ${ci} ${co} total price ${rooms} rooms`);

  if (providerId !== "official") {
    // `site:` belongs in the query list so SearXNG can scope the engine and
    // return only that provider's pages. It is never part of the search string
    // handed to every engine, where it would corrupt every result.
    queries.push(`site:${providerId === "booking" ? "booking.com" : providerId}.com ${destination} hotels ${ci}`);
  }

  if (providerId === "official") {
    queries.push(`${destination} hotel official website booking ${ci} ${co}`);
  }

  // Deduplicate while preserving order and respecting the cap.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const q of queries) {
    const normalized = q.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= limit) break;
  }
  return unique;
}

/** Format an ISO date like "December 12 2026" for search engines. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Resolve the live provider for a research run. Every configured live source
 * is wrapped through the registry so the engine can attempt each target in
 * parallel without a shared failure knocking out the whole run.
 */
export function createResearchProvider(
  env: Record<string, string | undefined>,
  parsed: ParsedQuery,
): {
  providers: ResearchProvider[];
  demoMode: boolean;
  providerCount: number;
} {
  const searxngConfig = resolveSearXNGConfig(env);
  const geminiConfig = resolveGeminiConfig(env);

  const providers: ResearchProvider[] = [];

  if (searxngConfig) {
    providers.push(
      new SearXNGProvider(new SearXNGClient(searxngConfig as SearXNGConfig), parsed),
    );
  }

  if (geminiConfig) {
    providers.push(new GeminiProvider(new GeminiSearchClient(geminiConfig)));
  }

  if (providers.length === 0) {
    return { providers: [mockResearchProvider], demoMode: true, providerCount: 1 };
  }

  if (providers.length === 1) {
    return { providers, demoMode: false, providerCount: 1 };
  }

  return {
    providers: [new CompositeProvider(providers)],
    demoMode: false,
    providerCount: providers.length,
  };
}

export { SearXNGProvider } from "./searxngProvider";
export { GeminiProvider } from "./geminiProvider";

export function detectLiveSources(env: Record<string, string | undefined>): string[] {
  const sources: string[] = [];
  if (env.JOBI_FORCE_DEMO === "1" || env.JOBI_FORCE_DEMO === "true") return sources;
  if (resolveSearXNGConfig(env)) sources.push("searxng");
  if (resolveGeminiConfig(env)) sources.push(GeminiProvider.name);
  return sources;
}

export function detectSearXNGConfig(env: Record<string, string | undefined>) {
  const config = resolveSearXNGConfig(env);
  if (!config) return null;
  return { configured: true };
}
