import { RESEARCH_BUDGET } from "./config";
import { assignCanonicalNames } from "./matching";
import { dedupeOffers, normalizeResults } from "./normalize";
import { buildComparison } from "./pricing";
import { generateQueries } from "./queries";
import { validateBookingUrl } from "./urlSafety";
import type {
  Comparison,
  HotelOffer,
  ParsedQuery,
  RawSearchResult,
  ResearchProvider,
} from "./types";

export interface ResearchBudget {
  maxQueries: number;
  maxPages: number;
  maxDurationMs: number;
}

export interface EngineHooks {
  /** Called as each pipeline stage becomes active. */
  onStage?: (key: string) => void | Promise<void>;
}

export interface EngineResult {
  offers: HotelOffer[];
  comparison: Comparison;
  report: {
    sourcesChecked: string[];
    unavailable: string[];
    limitations: string[];
    checkedAt: string;
  };
  metrics: {
    sourcesFound: number;
    sourcesRead: number;
    offersFound: number;
    offersVerified: number;
    comparableOffers: number;
    cheapestVerified?: number;
    durationMs: number;
    queriesRun: number;
    truncated: boolean;
  };
}

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Run a full deep-search pass. Pure orchestration: it never decides the answer
 * itself — pricing/comparison come from the deterministic `pricing` module, and
 * every offer is normalised from untrusted provider output.
 */
export async function runResearch(params: {
  parsed: ParsedQuery;
  provider: ResearchProvider;
  hooks?: EngineHooks;
  budget?: ResearchBudget;
}): Promise<EngineResult> {
  const budget = params.budget ?? RESEARCH_BUDGET;
  const startedAt = Date.now();
  const checkedAt = nowISO();
  const unavailable: string[] = [];
  const limitations: string[] = [];
  let truncated = false;

  const queries = generateQueries(params.parsed, budget.maxQueries);

  await params.hooks?.onStage?.("discover");

  const rawResults: RawSearchResult[] = [];
  let queriesRun = 0;

  for (const query of queries) {
    if (Date.now() - startedAt > budget.maxDurationMs) {
      truncated = true;
      limitations.push("Research time limit reached — some queries were skipped.");
      break;
    }
    if (rawResults.length >= budget.maxPages) {
      truncated = true;
      limitations.push("Candidate page limit reached — remaining sources were skipped.");
      break;
    }
    try {
      const results = await params.provider.search(query, {
        queries,
        parsed: params.parsed,
        budget,
        startedAt,
      });
      queriesRun += 1;
      for (const result of results) {
        rawResults.push(result);
        if (rawResults.length >= budget.maxPages) break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      unavailable.push(`${query} (${message})`);
    }
  }

  await params.hooks?.onStage?.("check");

  const normalized = normalizeResults(rawResults, params.parsed, checkedAt).map((offer) => {
    // Booking links must pass the allowlist. Anything else is downgraded so it
    // can never be presented as a "verified" booking option.
    const validation = validateBookingUrl(offer.bookingUrl);
    if (!validation.ok) {
      return {
        ...offer,
        priceStatus: offer.priceStatus === "verified" ? "observed" : offer.priceStatus,
        confidence: "low",
        notes: offer.notes
          ? `${offer.notes} Booking link not on the verified provider allowlist.`
          : "Booking link not on the verified provider allowlist.",
      } satisfies HotelOffer;
    }
    return offer;
  });

  const deduped = dedupeOffers(normalized);
  const matched = assignCanonicalNames(deduped);

  await params.hooks?.onStage?.("compare");
  const comparison = buildComparison(matched);
  // Carry each offer's differences all the way through to persistence so the
  // UI can explain why a "cheaper" price is not the same product.
  for (const entry of [...comparison.verified, ...comparison.observed]) {
    entry.offer.comparisonDifferences = entry.differences;
  }

  await params.hooks?.onStage?.("verify");

  const sourcesChecked = new Set<string>();
  for (const offer of matched) sourcesChecked.add(offer.providerName);
  if (sourcesChecked.size === 0) {
    limitations.push(
      params.provider.live
        ? "No usable offers were found in the permitted sources."
        : "Mock research provider returned no offers.",
    );
  }
  if (!params.provider.live) {
    limitations.push("DEMO DATA: this search used the mock research provider, not live sources.");
  }
  if (queriesRun === 0 && unavailable.length > 0) {
    limitations.push("Search is temporarily unavailable. Please try again.");
  }
  limitations.push(
    "Jobi searched a limited number of permitted sources — this is not full internet coverage.",
  );

  const offersVerified = comparison.verified.length;
  const durationMs = Date.now() - startedAt;

  // Safe structured log: counts and timings only — never secrets or PII.
  console.log(
    `[research] provider=${params.provider.name} queries=${queriesRun} sources=${rawResults.length} offers=${matched.length} verified=${offersVerified} unavailable=${unavailable.length} durationMs=${durationMs}`,
  );

  return {
    offers: matched,
    comparison,
    report: {
      sourcesChecked: Array.from(sourcesChecked),
      unavailable,
      limitations,
      checkedAt,
    },
    metrics: {
      sourcesFound: new Set(rawResults.map((r) => r.source)).size,
      sourcesRead: rawResults.length,
      offersFound: matched.length,
      offersVerified,
      comparableOffers: comparison.verified.length + comparison.observed.length,
      cheapestVerified: comparison.cheapestVerified?.total,
      durationMs,
      queriesRun,
      truncated,
    },
  };
}
