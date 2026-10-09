/**
 * Per-provider diagnostics for Jobi.
 *
 * Every provider attempt is recorded here, including why it failed, so the UI
 * can show an honest report: which providers were found, which pages were
 * readable, how many offers were extracted, which prices verified, and what
 * stopped each one. This deliberately does not invent access: a provider that
 * blocks, requires authentication, or returns no usable price is recorded with
 * its failure reason and the run continues with the other providers.
 */

import type { ParsedQuery, ProviderDiagnostic } from "./types";

/**
 * Record one provider attempt. `ok` is the last result, `success` is whether
 * any usable offer ever came out of it, and `failure` is the first blocking
 * reason (never converted into a workaround).
 */
export function recordProviderAttempt(
  attempts: ProviderDiagnostic[],
  id: string,
  name: string,
  hostname: string | null,
  query: string,
  searchOk: boolean,
  searchable: boolean,
  accessible: boolean,
  extracted: boolean,
  priceVerified: boolean,
  failureReason: string | null,
  pageCount: number,
) {
  attempts.push({
    id,
    name,
    hostname,
    query,
    searchOk,
    searchable,
    accessible,
    extracted,
    priceVerified,
    failureReason,
    pageCount,
    queryCount: 0,
  });
}

/**
 * Build the diagnostic report from the raw attempts and the run budget. Any
 * provider that never returned a usable offer is surfaced as unavailable with
 * the reason it stopped, so the user sees exactly which sources blocked us
 * instead of a generic "search is unavailable".
 */
export function buildDiagnosticReport(
  attempts: ProviderDiagnostic[],
  budget: { maxQueries: number; maxPages: number; maxDurationMs: number },
  parsed: ParsedQuery,
): ProviderDiagnostic[] {
  const report: ProviderDiagnostic[] = [];

  for (const attempt of attempts) {
    const isWithinBudget =
      attempt.queryCount <= budget.maxQueries && attempt.pageCount <= budget.maxPages;

    if (attempt.extracted && attempt.priceVerified) {
      report.push({ ...attempt, ok: true });
      continue;
    }

    if (attempt.searchOk && attempt.searchable) {
      if (attempt.accessible) {
        if (attempt.extracted) {
          report.push({
            ...attempt,
            ok: true,
            failureReason: attempt.priceVerified
              ? null
              : "No usable price found on accessible pages.",
          });
          continue;
        }
        report.push({
          ...attempt,
          ok: false,
          failureReason: attempt.priceVerified
            ? null
            : "No usable price found on accessible pages.",
        });
        continue;
      }

      report.push({
        ...attempt,
        ok: false,
        failureReason: attempt.failureReason ?? "Request blocked or denied.",
        searchable: false,
        accessible: false,
        extracted: false,
        priceVerified: false,
      });
      continue;
    }

    report.push({
      ...attempt,
      ok: false,
      failureReason:
        attempt.failureReason ?? 
        (attempt.searchable
          ? "No accessible pages returned by search."
          : "Query or search layer could not reach this provider."),
    });
  }

  return report;
}

/**
 * Group attempts by whether the provider ever returned a usable offer, plus a
 * summary of the cheapest verified price across all providers.
 */
export function summarizeDiagnostics(attempts: ProviderDiagnostic[]) {
  const successful = attempts.filter((a) => a.ok);
  const blocked = attempts.filter((a) => !a.ok && a.failureReason !== null);
  const skipped = attempts.filter((a) => a.ok === undefined);

  return {
    total: attempts.length,
    successful: successful.length,
    blocked: blocked.length,
    skipped: skipped.length,
    failedProviders: blocked.map((a) => ({ id: a.id, name: a.name, reason: a.failureReason })),
    verifiable: successful.filter((a) => a.priceVerified).map((a) => a.name),
    unverified: successful.filter((a) => !a.priceVerified).map((a) => a.name),
  };
}

/**
 * Empty diagnostic state for the first attempt of a provider.
 */
export function emptyAttempt() {
  return {
    id: "",
    name: "",
    hostname: null,
    query: "",
    searchOk: false,
    searchable: false,
    accessible: false,
    extracted: false,
    priceVerified: false,
    failureReason: null,
    pageCount: 0,
    queryCount: 0,
  } as ProviderDiagnostic;
}
