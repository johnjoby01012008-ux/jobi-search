import type { ResearchProvider } from "../types";
import { resolveGeminiConfig, GeminiSearchClient } from "../search/gemini";
import { resolveSearXNGConfig, SearXNGClient } from "../search/searxng";
import { CompositeProvider } from "./compositeProvider";
import { GeminiProvider } from "./geminiProvider";
import { mockResearchProvider } from "./mockProvider";
import { SearXNGProvider } from "./searxngProvider";

export { mockResearchProvider } from "./mockProvider";
export { SearXNGProvider } from "./searxngProvider";
export { detectSearXNGConfig } from "../search/searxng";
export { extractObservedPrice, extractPrice } from "../search/price";

/**
 * Choose the live sources for a run.
 *
 * - `SEARXNG_URL` → the self-hosted SearXNG instance (the primary source).
 * - `GEMINI_API_KEY` → Google Search grounding through Gemini (an optional
 *   extra source, merged with SearXNG when both are configured).
 * - Neither configured, or demo mode forced → the mock provider (clearly
 *   labelled DEMO in the UI).
 *
 * SearXNG needs no key at all. The Google source is strictly optional: if it
 * is misconfigured, over quota or unbilled, its batch comes back empty and the
 * run continues on the sources that did answer.
 */
export function createResearchProvider(
  env: Record<string, string | undefined> = {},
): { provider: ResearchProvider; demoMode: boolean } {
  if (env.JOBI_FORCE_DEMO === "1" || env.JOBI_FORCE_DEMO === "true") {
    return { provider: mockResearchProvider, demoMode: true };
  }

  const live: ResearchProvider[] = [];

  const searxngConfig = resolveSearXNGConfig(env);
  if (searxngConfig) {
    live.push(new SearXNGProvider(new SearXNGClient(searxngConfig)));
  }

  const geminiConfig = resolveGeminiConfig(env);
  if (geminiConfig) {
    live.push(new GeminiProvider(new GeminiSearchClient(geminiConfig)));
  }

  if (live.length === 1) return { provider: live[0], demoMode: false };
  if (live.length > 1) {
    return { provider: new CompositeProvider(live), demoMode: false };
  }
  return { provider: mockResearchProvider, demoMode: true };
}
