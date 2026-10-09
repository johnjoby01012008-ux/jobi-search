import { sanitizeUntrustedText } from "../urlSafety";
import { extractPrice } from "./price";
import type { SearXNGResult } from "./searxng";

/**
 * Gemini + Google Search grounding — an OPTIONAL second live source for the
 * research pipeline, used alongside (never instead of) the self-hosted SearXNG
 * instance.
 *
 * Google exposes search results here through Gemini's `googleSearch` tool: the
 * response carries `groundingChunks[].web` entries (uri / title / snippet),
 * which are the same raw material Jobi already gets from SearXNG. Those chunks
 * are normalised to `SearXNGResult`, so the existing normalise → dedupe →
 * compare → verify pipeline is unchanged.
 *
 * Configuration and safety notes:
 * - Requires `GEMINI_API_KEY`. Without it this client is never constructed and
 *   the pipeline runs on SearXNG exactly as before.
 * - The key travels only in the `x-goog-api-key` request header. It is never
 *   logged, never returned to the client and never written to the database.
 * - Grounding is metered by Google, so every failure (bad key, no billing,
 *   quota, timeout) degrades to an empty batch instead of failing the run.
 */

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Native Gemini endpoint — the only endpoint the newer `AQ.` keys accept. */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 15;

/** Label reported by the UI when this source is live. */
export const GEMINI_LABEL = "Google";

/** Read the Gemini credential from the deployment environment, if present. */
export function resolveGeminiConfig(
  env: Record<string, string | undefined> = {},
): GeminiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL };
}

interface GroundingSource {
  uri?: string;
  title?: string;
  snippet?: string;
}

interface GroundingChunk {
  web?: GroundingSource;
  /** Older response shape. */
  source?: GroundingSource;
}

interface GenerateContentResponse {
  candidates?: Array<{
    groundingMetadata?: { groundingChunks?: GroundingChunk[] };
  }>;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export class GeminiSearchClient {
  private readonly config: GeminiConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: GeminiConfig, options: { fetchImpl?: FetchLike } = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** Run one grounded query. Never throws: an empty batch means "no signal". */
  async search(query: string): Promise<SearXNGResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(
        `${ENDPOINT}/${this.config.model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.config.apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: query }] }],
            tools: [{ googleSearch: {} }],
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        // Status only: never the URL, headers or body (all may carry the key).
        console.log(
          `[gemini] ${JSON.stringify({ event: "search_error", status: response.status })}`,
        );
        return [];
      }

      const data = (await response.json()) as GenerateContentResponse;
      const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      return normalizeGroundingChunks(chunks);
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
      console.log(`[gemini] ${JSON.stringify({ event: "search_error", reason })}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Map grounded chunks onto the result shape the rest of the engine expects. */
export function normalizeGroundingChunks(
  chunks: GroundingChunk[],
): SearXNGResult[] {
  const results: SearXNGResult[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const web = chunk.web ?? chunk.source;
    const url = web?.uri?.trim();
    if (!url || seen.has(url)) continue;
    if (!/^https?:\/\//i.test(url)) continue;

    const source = hostnameOf(url);
    if (!source) continue;
    seen.add(url);

    const snippet = sanitizeUntrustedText(web?.snippet ?? "", 600);
    const title = sanitizeUntrustedText(web?.title ?? "", 200) || url;
    const price = extractPrice(snippet);

    results.push({
      title,
      url,
      source,
      snippet,
      price: price?.amount ?? null,
      currency: price?.currency ?? null,
      hotelName: undefined,
      location: undefined,
      rating: undefined,
    });
    break;

    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}
