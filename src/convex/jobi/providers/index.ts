/**
 * Pluggable research-provider registry.
 *
 * Every provider satisfies `ResearchProvider` from `../types`. The engine only
 * knows about the interface; it does not know which providers exist.
 *
 * `createResearchProvider(env)` is the single place that decides which provider
 * (or combination) is active right now. Add a new provider here and the
 * research engine picks it up automatically.
 *
 * Provider construction is done per-run so that per-request timeouts and
 * search context are explicit.
 */

import type { ResearchProvider } from "../types";
import { buildSearXNGProvider } from "./searxngProvider";
import { buildMockProvider } from "./mockProvider";
import { SearXNGClient } from "../search/searxng";

export const PROVIDER_NAME = "searxng";
export const PROVIDER_MAXIMUMS = {
  maxPages: 50,
};

/** Resolve the goal-seek SearXNG configuration that a client should use. */
export function resolveSearXNGConfig(env: Record<string, string | undefined>) {
  const url = env.SEARXNG_URL?.trim();
  if (!url) return null;
  return {
    searxngUrl: url,
    timeoutMs: Number(env.SEARCH_TIMEOUT_MS ?? "10000"),
    maxResults: Number(env.SEARCH_MAX_RESULTS ?? "15"),
  };
}

/** Detect whether a live SearXNG config is present (for the health/debug query). */
export function detectSearXNGConfig(env: Record<string, string | undefined>) {
  const cfg = resolveSearXNGConfig(env);
  if (!cfg) return null;
  // Do not return the URL — it is a server-side secret.
  return { configured: true };
}

/** Client used by the SearXNG provider (imported by secret-free health actions). */
export { SearXNGClient } from "../search/searxng";

/**
 * Build the research provider for the current environment.
 *
 * When `SEARXNG_URL` is set the provider calls the self-hosted instance.
 * When it is absent the pipeline falls back to the mock provider so the app
 * keeps running while still being honest that the data is demo data.
 */
export function createResearchProvider(
  env: Record<string, string | undefined>,
): {
  provider: ResearchProvider;
  demoMode: boolean;
} {
  const searxngCfg = resolveSearXNGConfig(env);

  const provider: ResearchProvider = searxngCfg
    ? buildSearXNGProvider(searxngCfg)
    : buildMockProvider(env);

  return {
    provider,
    demoMode: !searxngCfg,
  };
}
