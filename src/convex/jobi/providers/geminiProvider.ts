import type { RawSearchResult, ResearchProvider } from "../types";
import { GeminiSearchClient } from "../search/gemini";
import { toRawSearchResult } from "./searxngProvider";

/**
 * GeminiProvider — the Google Search grounding source.
 *
 * It feeds the *same* raw shape as SearXNG, so grounded web sources flow
 * through the existing normalise → dedupe → compare → verify pipeline and cost
 * nothing extra in complexity. Text from the web stays untrusted DATA and is
 * sanitised by `toRawSearchResult`; observed prices are never reported as
 * verified.
 */
export class GeminiProvider implements ResearchProvider {
  name = "gemini";
  live = true;

  private readonly client: GeminiSearchClient;

  constructor(client: GeminiSearchClient) {
    this.client = client;
  }

  async search(query: string): Promise<RawSearchResult[]> {
    const results = await this.client.search(query);
    return results.map((result) => toRawSearchResult(result));
  }
}
