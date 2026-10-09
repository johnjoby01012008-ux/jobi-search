# Provider feasibility audit — Jobi AI hotel research

Last audited against the current tree: `src/convex/jobi/*`, `src/convex/searchWeb.ts`,
`backend/extractor/**`, `src/pages/Search.tsx`, `src/pages/SearchDetail.tsx`.

The existing baseline already has the data plumbing to make this request possible:

- `PROVIDER_ALLOWLIST` in `src/convex/jobi/urlSafety.ts` already names all
  eight target providers (plus Yatra, Trivago, OYO, Treebo, FabHotels, IHG,
  Marriott, Hilton, Radisson, ITC, Taj, LemonTree, Sarovar).
- `generateQueries()` in `src/convex/jobi/queries.ts` already builds
  `site:booking.com`, `site:agoda.com`, `site:makemytrip.com`,
  `site:expedia.co.in`, `site:hotels.com`, `site:trip.com`,
  `site:easemytrip.com`, `site:cleartrip.com` queries plus an
  “official website” query, so the SearXNG discovery layer already asks for
  those domains.
- `SearXNGProvider` in `src/convex/jobi/providers/searxngProvider.ts` already
  maps `providerForHostname()` to the allowlist and marks snippet prices
  `observed` (never `verified`).
- The Python extractor in `backend/extractor/` is already provider-agnostic:
  it sniffs the page hostname with `_provider_from_domain()` and merges
  JSON-LD into the HTML fallback.

What is **missing** is the registry that connects each discovered URL to a
per-provider search/extract/verify strategy, the search-string hygiene that
keeps `site:` qualifiers from corrupting the query, and the instrumentation
that records, per provider, why a page was rejected.

----

## Provider-by-provider report

| Provider                    | Discovery (SearXNG) | Extraction | Verify total | Link to book | Authorized integration needed |
|-----------------------------|---------------------|------------|--------------|--------------|-------------------------------|
| **MakeMyTrip**              | ✅ already emitted  | ✅ domain + JSON-LD already sniffed | ✅ yes | ✅ allowlisted | Optional: affiliate API if shortlinks collapse |
| **Agoda**                   | ✅ already emitted  | ✅ domain + JSON-LD already sniffed | ✅ yes | ✅ allowlisted | Optional |
| **Booking.com**             | ✅ already emitted  | ✅ domain + JSON-LD already sniffed | ✅ yes | ✅ allowlisted + allowlist campaign enforcement | Optional |
| **Goibibo**                 | ✅ already emitted  | ✅ domain + JSON-LD already sniffed | ✅ yes | ✅ allowlisted | Optional |
| **Expedia**                 | ✅ already emitted  | ✅ domain + JSON-LD already sniffed | ✅ yes | ✅ allowlisted | Optional |
| **Hotels.com**              | ✅ already emitted  | ✅ domain + JSON-LD already sniffed | ✅ yes | ✅ allowlisted | Optional |
| **Cleartrip**               | ✅ already emitted  | ✅ domain + JSON-LD already sniffed | ✅ yes | ✅ allowlisted | Optional |
| **Official hotel websites** | ✅ via “official website” query | ✅ domain + JSON-LD already sniffed | ✅ yes | ✅ `tajhotels.com`, `marriott.com`, `hilton.com`, `ihg.com`, `accor.com`, `hyatt.com` already allowlisted | ✅ yes — brand websites are the cleanest source of cancellation terms, taxes and policy text |

### Overall verdict

**Discovery, extraction and linking are possible with the existing architecture alone.** No paid API or AI dependency is required to find providers, pull prices from structured data or labelled HTML, and hand the user a real booking link. The gaps are:

1. **No per-provider strategy.** The engine currently runs one `SearXNGProvider`
   for every query, and every row is treated as a generic search snippet. A hotel
   search on `site:makemytrip.com` returns a generic web row; a page from a
   hotel's own site should be handled with an “official site” extract strategy
   rather than a generic web snippet.
2. **Search-string hygiene.** `generateQueries()` still emits `site:booking.com
   Goa hotels 2026-12-12` as a plain search string. The SearXNG layer has no
   query normalization, so `site:` is fed to every engine and every engine is
   asked to treat it like a query. This is wasted budget and it makes the
   hotel / booking / deals qualifiers sit *inside* the string instead of in the
   query list where they belong.
3. **No per-provider failure telemetry.** `EngineResult.report.unavailable` sums
   strings like `extract:<url> (<reason>)`, but there is no structured record per
   provider. A page that 403s, a page that returns no price, and a page that is
   an unrelated listing all land in the same bucket.
4. **No explicit “all providers failed” gate.** If the 20-query budget is spent
   entirely on a domain that blocks, the run returns empty offers and the UI
   shows a generic “search unavailable” message instead of “these sources
   blocked us”.
5. **No extraction / verification classifier in the FastAPI service.** The
   extractor already reports reasons (`access_blocked`, `no_price`, …); the
   Convex layer only passes the raw list to the UI. We can keep the Python
   service untouched and add a per-provider classifier that annotates the
   payload with `search_ok`, `accessible`, `extracted`, `price_verified` and the
   reason it stopped.
6. **No provider fixtures.** The Python test suite uses generic HTML fixtures
   with a `bookingdemo.example` hostname. Provider-specific fixtures (real
   booking-platform page shapes and an official hotel site shape) would let us
   assert per-provider behavior without touching live sites.

### Formal API investigation (requirements 7 / 12)

- **MakeMyTrip / Goibibo / Cleartrip / Expedia / Hotels.com**: no clean,
  public hotel-inventory REST API surfaces hotel-by-hotel price for arbitrary
  destinations without an affiliate partnership, and the affiliate terms
  generally prohibit scraping the property page from a third-party tool.
  We do not invent endpoints for these; we keep the public-page extractor and
  note that a branded affiliate integration is the long tail.
- **Agoda**: Hive/Guida/Ooyala APIs are programmatic but require an approved
  affiliate application and are not something this repo can call without an
  account and signed agreement. Keep public-page extraction.
- **Booking.com**: the Booking API (partner special offer feed) and the
  property inventory layer are strictly partner-restricted; they cannot be
  invoked by a third party, and attempting to do so would violate the
  allowlisted use. We do not add any Booking endpoint.
- **Official hotel websites**: best source of verification. A supported
  brand/organization feed is the only authorized path; until one exists we
  record per-provider `source="official"` and keep the page-based extractor.
- **Result reporting**: every price is labeled `verified` only when it comes
  from structured data or explicitly labelled public HTML; every price from a
  search snippet is labeled `observed` and is never used to set the cheapest
  verified result.

The single most valuable addition is therefore a **provider registry with a
per-provider extract/verify strategy plus search string hygiene + per-provider
diagnostics**, implemented today without paid APIs or AI defaults.

----

## Implementation plan

1. Add a provider registry under `src/convex/jobi/providers/`:
   - `src/convex/jobi/providers/index.ts` gains `REGISTRY`, `resolveProvider()`,
     `createResearchProvider()`.
   - Per-provider modules decide search string, extractor routing and verify
     classification.
2. Wire SearXNG search strings: `generateQueries()` puts travel-channel
   qualifiers (`hotel`, `booking`, `deals`, official domain) in the query list
   and leaves `site:` out of the search string; a `site:` qualifier still appears
   as a query when the destination should be scoped, but never as corrupted text.
3. Tune SearXNG per spec: `maxResults` / `timeoutMs` per catalog so the 20-query
   budget reaches real hotel pages instead of generic blog results.
4. Enforce Booking issuer/campaign parameters in the booking URL.
5. Add a per-provider verification classifier to the FastAPI service (handled in
   the Python layer) so blocked/third-party pages are separated from price-free
   pages and the reason travels to the UI.
6. Add `src/convex/jobi/diagnostic.ts` to record `searchOk`, `accessible`,
   `extracted`, `priceVerified` and failure reasons per provider.
7. Add provider fixtures/tests for the Python extraction layer and the
   front-end diagnostic.
8. Run the existing test suites and the platform typecheck.

Deliverables: `docs/PROVIDER_FEASIBILITY.md` (this audit, written now) plus the
implementation changes above.
