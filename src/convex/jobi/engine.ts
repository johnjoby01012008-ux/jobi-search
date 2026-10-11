import { RESEARCH_BUDGET } from "./config";
import { assignCanonicalNames } from "./matching";
import { dedupeOffers, normalizeResults } from "./normalize";
import { buildComparison } from "./pricing";
import { generateQueries } from "./queries";
import { providerForHostname, validateBookingUrl } from "./urlSafety";
import { runExtractionStage } from "./extraction/extractStage";
import type { ProviderDiagnostic } from "./types";
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
    /** Structured per-provider attempt records (see ./diagnostic). */
    providerDiagnostics: ProviderDiagnostic[];
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

  /**
   * Per-provider attempt records. Aggregated per provider name (booking
   * platform or "Official hotel site") at the end of the run so the report can
   * state, per provider, whether search worked, pages were accessible, prices
   * were extracted and whether any price was verified.
   */
  const providerAttempts = new Map<
    string,
    ProviderDiagnostic & { offersFound: number }
  >();

  function noteAttempt(
    hostname: string | null,
    patch: {
      searchOk?: boolean;
      accessible?: boolean;
      extracted?: boolean;
      priceVerified?: boolean;
      failureReason?: string | null;
      offersFound?: number;
    },
  ) {
    const name = hostname ? (providerForHostname(hostname) ?? "Official hotel site") : "Unknown source";
    const attempt = providerAttempts.get(name) ?? {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      hostname,
      query: "",
      searchOk: false,
      searchable: false,
      accessible: false,
      extracted: false,
      priceVerified: false,
      failureReason: null,
      pageCount: 0,
      queryCount: 0,
      offersFound: 0,
    };
    if (patch.searchOk) attempt.searchOk = true;
    if (patch.accessible) attempt.accessible = true;
    if (patch.extracted) attempt.extracted = true;
    if (patch.priceVerified) attempt.priceVerified = true;
    if (patch.offersFound) attempt.offersFound += patch.offersFound;
    // First blocking reason sticks; later successes clear it.
    if (patch.failureReason && attempt.failureReason === null) attempt.failureReason = patch.failureReason;
    else if (!patch.failureReason && attempt.failureReason && (patch.extracted || patch.priceVerified)) {
      attempt.failureReason = null;
    }
    providerAttempts.set(name, attempt);
  }

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
        // The search layer reached the engine — record which booking
        // platforms surfaced pages in this query.
        noteAttempt(hostOf(result.url), { searchOk: true });
        if (rawResults.length >= budget.maxPages) break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      unavailable.push(`${query} (${message})`);
    }
  }

  // Extraction stage: fetch and extract hotel data from discovered pages.
  // Only runs when BACKEND_EXTRACTOR_URL is configured. Extracted offers
  // flow into the same normalize → dedupe → compare pipeline as search results.
  await params.hooks?.onStage?.("extract");

  const extraction = await runExtractionStage(
    rawResults,
    {
      checkIn: params.parsed.checkIn,
      checkOut: params.parsed.checkOut,
      guests: params.parsed.guests,
      rooms: params.parsed.rooms,
    },
  );

  // Merge extracted offers into rawResults (dedupe by URL so we don't
  // double-count a page that both search and extraction found).
  const seenUrls = new Set(rawResults.map((r) => r.url));
  for (const offer of extraction.extractedOffers) {
    if (seenUrls.has(offer.url)) continue;
    seenUrls.add(offer.url);
    rawResults.push(offer);
  }

  // Log extraction failures as unavailable sources.
  for (const failure of extraction.failedUrls) {
    unavailable.push(`extract:${failure.url} (${failure.reason})`);
    // A blocked fetch is an accessibility failure; a parse/no-price failure
    // means the page was reachable but no usable hotel price came out.
    const blocked = /^(blocked_url|blocked_ip|timeout|dns_failed|connect_failed|network_error|ssl_error|too_many_redirects|access_blocked)$/.test(failure.reason);
    noteAttempt(hostOf(failure.url), {
      searchOk: blocked ? true : false,
      accessible: blocked ? false : true,
      failureReason: failure.reason,
    });
  }

  // Successful extractions: record per provider, including whether the price
  // was verified (structured/JSON-LD data) or merely observed.
  for (const offer of extraction.extractedOffers) {
    noteAttempt(hostOf(offer.url), {
      searchOk: true,
      accessible: true,
      extracted: true,
      priceVerified: offer.priceStatus === "verified",
      offersFound: 1,
    });
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

  /** Hostname of a URL, or null when unparseable. */
  function hostOf(url: string | undefined): string | null {
    if (!url) return null;
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  // Aggregate per-provider attempts: a provider is "searchable" when any
  // engine query surfaced one of its pages, and the record carries the final
  // verified/extracted state. Only providers whose offers survived
  // normalization + dedupe are marked ok.
  const verifiedProviders = new Set(matched.filter((o) => o.priceStatus === "verified").map((o) => o.providerName));
  const comparableProviders = new Set(matched.map((o) => o.providerName));
  const providerDiagnostics: ProviderDiagnostic[] = Array.from(providerAttempts.values()).map(
    (attempt) => {
      // `offersFound` stays engine-internal: the published diagnostic carries
      // `pageCount`/`queryCount` only, matching the ProviderDiagnostic shape.
      const { offersFound: _offersFound, ...rest } = attempt;
      const ok = comparableProviders.has(attempt.name);
      return {
        ...rest,
        searchable: attempt.searchOk,
        queryCount: queriesRun,
        ok,
        failureReason:
          attempt.failureReason ??
          (ok ? null : verifiedProviders.size > 0 ? "No comparable offer survived normalization." : "No usable price found.")
      };
    },
  );
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
  // Secret-free per-provider summary: state flags and counts only.
  for (const d of providerDiagnostics) {
    console.log(
      `[provider-report] ${d.name} searchOk=${d.searchOk} accessible=${d.accessible} extracted=${d.extracted} priceVerified=${d.priceVerified} pageCount=${d.pageCount} reason=${d.failureReason ?? "ok"}`,
    );
  }

  return {
    offers: matched,
    comparison,
    report: {
      sourcesChecked: Array.from(sourcesChecked),
      unavailable,
      limitations,
      checkedAt,
      providerDiagnostics,
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
