import type { RawSearchResult, ResearchContext, ResearchProvider } from "../types";

/**
 * CompositeProvider — run every live source for a query and merge the results.
 *
 * Sources are queried in parallel and their results concatenated in provider
 * order (SearXNG first), de-duplicated on the normalised URL. One source
 * failing is not a failure: its batch is simply skipped. The run only surfaces
 * an error when *nothing* came back and at least one source actually threw, so
 * the engine's clean "search is temporarily unavailable" path still works.
 */
export class CompositeProvider implements ResearchProvider {
  readonly name: string;
  readonly live = true;

  private readonly providers: ResearchProvider[];

  constructor(providers: ResearchProvider[]) {
    this.providers = providers;
    this.name = providers.map((provider) => provider.name).join("+");
  }

  async search(
    query: string,
    ctx?: ResearchContext,
  ): Promise<RawSearchResult[]> {
    const settled = await Promise.allSettled(
      this.providers.map((provider) =>
        provider.search(query, ctx as ResearchContext),
      ),
    );

    const rows: RawSearchResult[] = [];
    const seen = new Set<string>();

    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      for (const row of outcome.value) {
        const key = row.url.replace(/\/+$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    }

    if (rows.length === 0) {
      const failure = settled.find((outcome) => outcome.status === "rejected");
      if (failure && failure.status === "rejected") throw failure.reason;
    }

    return rows;
  }
}
