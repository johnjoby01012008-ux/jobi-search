import type { ResearchProvider } from "../types";
import { resolveSearXNGConfig, SearXNGClient } from "../search/searxng";
import { mockResearchProvider } from "./mockProvider";
import { SearXNGProvider } from "./searxngProvider";

export { mockResearchProvider } from "./mockProvider";
export { SearXNGProvider } from "./searxngProvider";
export { detectSearXNGConfig } from "../search/searxng";
export { extractObservedPrice, extractPrice } from "../search/price";

/**
 * Choose a research provider for a run.
 *
 * - Live provider (SearXNG) when `SEARXNG_URL` is configured and demo mode is
 *   not forced.
 * - Otherwise the mock provider (clearly labelled DEMO in the UI).
 *
 * SearXNG is the ONLY live search layer. No paid search API and no
 * Brave/Tavily/Serper/Google key is required.
 */
export function createResearchProvider(
  env: Record<string, string | undefined> = {},
): { provider: ResearchProvider; demoMode: boolean } {
  if (env.JOBI_FORCE_DEMO === "1" || env.JOBI_FORCE_DEMO === "true") {
    return { provider: mockResearchProvider, demoMode: true };
  }
  const config = resolveSearXNGConfig(env);
  if (config) {
    return { provider: new SearXNGProvider(new SearXNGClient(config)), demoMode: false };
  }
  return { provider: mockResearchProvider, demoMode: true };
}
