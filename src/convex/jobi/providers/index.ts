import type { ResearchProvider } from "../types";
import { mockResearchProvider } from "./mockProvider";
import { detectWebSearchConfig, WebSearchProvider } from "./webSearchProvider";

export { mockResearchProvider, WebSearchProvider, detectWebSearchConfig };
export { extractObservedPrice } from "./webSearchProvider";

/**
 * Choose a research provider for a run.
 *
 * - Live provider when a permitted search API key is configured and demo mode
 *   is not forced.
 * - Otherwise the mock provider (clearly labelled DEMO in the UI).
 */
export function createResearchProvider(
  env: Record<string, string | undefined> = {},
): { provider: ResearchProvider; demoMode: boolean } {
  if (env.JOBI_FORCE_DEMO === "1" || env.JOBI_FORCE_DEMO === "true") {
    return { provider: mockResearchProvider, demoMode: true };
  }
  const config = detectWebSearchConfig(env);
  if (config) {
    return { provider: new WebSearchProvider(config), demoMode: false };
  }
  return { provider: mockResearchProvider, demoMode: true };
}
