/**
 * Pluggable research-provider registry.
 *
 * Every provider satisfies `ResearchProvider` from `../types`. The engine only
 * knows about the interface; it does not know which providers exist.
 *
 * `createResearchProvider(env)` is the single place that decides which provider
 * (or combination) is active right now. Add a new provider here and the
 * research engine picks it up automatically.
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

export { SearXNGProvider } from "./searxngProvider";
export { GeminiProvider } from "./geminiProvider";

/**
 * Which live sources are configured right now. Kept secret-free so a health
 * query can call it and still pass the result to the frontend.
 */
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
  // Do not return the URL — it is a server-side secret.
  return { configured: true };
}

/**
 * Build the research provider for the current environment.
 *
 * Live sources (SearXNG + optional Gemini grounding) are all composed into one
 * provider, de-duplicated by the CompositeProvider. When none is configured the
 * pipeline falls back to the mock provider so the app keeps running while still
 * being honest that the data is demo data.
 */
export function createResearchProvider(
  env: Record<string, string | undefined>,
): {
  provider: ResearchProvider;
  demoMode: boolean;
} {
  const config = resolveSearXNGConfig(env);
  const provider: ResearchProvider = config
    ? new SearXNGProvider(new SearXNGClient(config as SearXNGConfig))
    : mockResearchProvider;

  const gemini = resolveGeminiConfig(env);
  const geminiProvider = gemini ? new GeminiProvider(new GeminiSearchClient(gemini)) : null;

  const liveProviders = [provider, geminiProvider].filter(
    (p): p is ResearchProvider => p !== null && p.live,
  );

  if (liveProviders.length === 0) {
    return { provider: mockResearchProvider, demoMode: true };
  }

  const merged =
    liveProviders.length === 1 ? liveProviders[0] : new CompositeProvider(liveProviders);

  return { provider: merged, demoMode: false };
}
