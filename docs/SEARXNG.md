# Self-hosted SearXNG search layer

Jobi Search uses a **self-hosted [SearXNG](https://docs.searxng.org/) instance** as its primary live search layer. There is **no Brave / Tavily / Serper key** and **no paid search API** required. Setting `GEMINI_API_KEY` is optional: it adds Google Search grounding as a second source merged with the SearXNG results, and the pipeline runs exactly as before when it is absent.

When `BACKEND_EXTRACTOR_URL` is configured, the pipeline additionally fetches and extracts hotel data from discovered pages using a Python FastAPI service (`backend/extractor/`). JSON-LD is the primary extraction path; BeautifulSoup + lxml is the HTML fallback; Playwright is an optional last resort for JS-rendered pages. Extracted prices are **verified** when they come from structured data with price context; otherwise they stay **observed**.

```
Frontend (Vite/React)
        │  (Convex queries/mutations only — never SearXNG)
        ▼
Jobi backend (Convex)
        │  SEARXNG_URL  (internal address, server-side only)
        ▼
SearXNG Docker service  ──►  public search engines
```

The SearXNG URL lives **only** on the backend in the `SEARXNG_URL` environment variable. It is never returned by a query, never bundled into the frontend, and the container is not published to the public internet.

---

## 1. Files

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | The `searxng` service, internal network and healthcheck. |
| `searxng/settings.yml` | SearXNG config — JSON output enabled, public limiter off. |
| `searxng/limiter.toml` | Bot-detection config (limiter disabled; kept explicit). |
| `Dockerfile` | Repo-root SearXNG image for Git-based container hosts (root build context). |
| `searxng/Dockerfile` | The same image for hosts whose build context is `searxng/` (Fly.io). |
| `northflank.json` | Always-on deploy template for Northflank's free Sandbox plan. |
| `searxng/fly.toml` | Fly.io app config (one warm machine, no scale-to-zero). |
| `env.example` | Copy to `.env`; documents `SEARXNG_URL`, `SEARCH_*`, `BACKEND_EXTRACTOR_URL`. |
| `src/convex/jobi/search/searxng.ts` | The SearXNG transport (`searchWeb`). |
| `src/convex/jobi/search/gemini.ts` | Optional Gemini Google-Search grounding client. |
| `src/convex/jobi/providers/compositeProvider.ts` | Merges every configured live source, de-duplicated. |
| `src/convex/jobi/search/price.ts` | Price/rating extraction from untrusted text. |
| `src/convex/jobi/providers/searxngProvider.ts` | Turns search results into offers. |
| `src/convex/jobi/providers/cachedProvider.ts` | Cross-worker cache decorator around the live provider. |
| `src/convex/searchCache.ts` | Table-backed shared cache (`searchCache` table). |
| `src/convex/searchWeb.ts` | Internal, secret-free health/debug actions. |
| `backend/extractor/` | Python FastAPI extraction service (JSON-LD + HTML + optional Playwright). |
| `backend/extractor/main.py` | FastAPI app: /extract, /extract-batch, /health, /validate-url. |
| `backend/extractor/schemas.py` | Pydantic request/response schemas. |
| `backend/extractor/security.py` | SSRF-safe HTTP fetcher with redirect validation. |
| `backend/extractor/jsonld.py` | JSON-LD extraction from <script type="application/ld+json">. |
| `backend/extractor/html_parser.py` | BeautifulSoup + lxml HTML fallback extraction. |
| `backend/extractor/extractor.py` | Extraction pipeline: JSON-LD → HTML → validate → normalize. |
| `backend/extractor/normalizer.py` | Offer normalization and comparison helpers. |
| `backend/extractor/playwright_fetcher.py` | Optional Playwright fallback for JS-rendered pages. |
| `src/convex/jobi/extraction/` | Convex internalAction + types that call the Python backend. |

---

## 2. Start / stop SearXNG (local development)

```bash
# Start (detached)
docker compose up -d

# Follow logs
docker compose logs -f searxng

# Stop
docker compose down

# Stop and wipe cached instance state
docker compose down -v
```

The container is reachable from your host at `http://localhost:8888` **only on loopback** (`127.0.0.1:8888 → 8080`). That publish is for local debugging; it is removed entirely on a VPS.

### Point the backend at it

The Convex backend runs outside Docker in this environment, so set the loopback address in your `.env`:

```bash
cp env.example .env
# SEARXNG_URL=http://localhost:8888
```

When the backend runs **inside** the same Docker network as SearXNG (VPS), use the service name instead:

```bash
SEARXNG_URL=http://searxng:8080
```

> Platform note: the hosting platform protects the dot-prefixed `.env.example` path from edits, so the template ships as `env.example`. `.env` is gitignored.

---

## 3. Check health

```bash
# Container-level healthcheck (defined in docker-compose.yml)
curl -s http://localhost:8888/healthz

# Backend-level check — reports configuration + result count, never the URL
bunx convex run searchWeb:searxngHealth
# -> {"ok":true,"configured":true,"resultCount":12,"latencyMs":840}
```

## 4. Test the JSON API

JSON output **must** be enabled (`searxng/settings.yml` → `search.formats` includes `json`), otherwise `/search?format=json` returns `403`.

```bash
curl -s 'http://localhost:8888/search?q=hotels+in+Goa&format=json' | head -c 500
```

Or exercise the exact backend path with a raw query:

```bash
bunx convex run searchWeb:debugSearch '{"query":"hotels in Goa December 12 2026 December 15 2026 2 guests"}'

# Purge the shared search cache
bunx convex run searchCache:clear
```

`debugSearch` returns only `{ ok, count, latencyMs, results[] }` — no environment, no internal URL, no secrets.

---

## 5. How the hotel-search pipeline works

1. The user describes a trip; `parseTripQuery` turns it into `{ destination, checkIn, checkOut, guests, rooms, budget, preferences }`.
2. `generateQueries` builds targeted queries, e.g. `hotels in Goa December 12 2026 December 15 2026 2 guests`, plus booking-source queries (`site:booking.com …`, `site:agoda.com …`, `site:makemytrip.com …`, and an official-website query). Not every site will be available — the engine simply continues with whatever comes back.
3. `SearXNGProvider` calls `searchWeb(query)` for each query. `searchWeb` builds `GET {SEARXNG_URL}/search?q=…&format=json`, with a timeout, then normalizes every result to:

   ```json
   { "title": "…", "url": "…", "source": "www.agoda.com",
     "snippet": "…", "price": 5400, "currency": "INR",
     "hotelName": "Sea Breeze Inn", "location": "Goa", "rating": 4.2 }
   ```

   `price` is `null` when no currency marker is present — prices are never invented. Snippet prices are always **observed**, never **verified**.
4. **Extraction stage** (when `BACKEND_EXTRACTOR_URL` is configured): the pipeline sends discovered page URLs to the Python extraction service, which fetches each page (SSRF-safe), extracts JSON-LD / HTML data, validates prices with context, and returns structured `ExtractedHotel` objects. These are converted back into `RawSearchResult` entries and merged into the results before normalization. When the extraction backend is not configured, this stage is skipped and the pipeline continues with search-result snippets only.
5. `normalizeResults` → `dedupeOffers` → `assignCanonicalNames` group the same hotel found across sources.
6. `buildComparison` sorts by final total (base + taxes + mandatory fees) and marks the cheapest **verified** offer. Any offer that differs in room type, meal plan, cancellation, guests, nights, fees or currency is annotated with those differences so a cheaper price is never passed off as the same product.
7. Results are persisted server-side; booking URLs stay on the server.

If **every** query fails, the run fails with the clean message `Search is temporarily unavailable. Please try again.` — never a Docker or network error.

---

## 6. Booking links, and how the product is paid for

```
search ─► results ─► labelled sponsored card ─► provider booking page
```

- `searches.getResults` returns each offer **with** its `bookingUrl` to the signed-in owner, so every offer is actionable as soon as its results are ready.
- `searches.revealBookingUrl` re-reads a single result for the signed-in owner and writes an `auditLogs` row (`booking_url_revealed`), so every outbound click is traceable server-side.
- Jobi Search takes no payment from the traveller. The UI is funded entirely by the clearly labelled sponsored cards shown while research runs and between results.

---

## 7. Security

- SearXNG is only reachable by the backend over `SEARXNG_URL`; the URL is never exposed to the browser and is redacted from all logs.
- User queries are validated and length-capped (`3–500` chars) before a search is stored.
- Rate limiting: max 30 searches/user/hour and a 15s minimum gap between runs.
- Identical queries are cached (default `SEARCH_CACHE_TTL=900`s) and concurrent identical requests are de-duplicated, so 20 users searching the same trip do not trigger 20 upstream searches. Caching happens at two levels: an in-process map inside `SearXNGClient`, plus a **shared `searchCache` Convex table** (`CachedResearchProvider`) so de-duplication holds across every worker and deployment, not just a single process. Empty and failed results are never cached, so an outage surfaces immediately instead of being pinned.
- Only `https:` URLs on real public hosts are kept; `javascript:`, `data:`, IP-literal and localhost links are dropped, and booking links must pass the provider allowlist in `src/convex/jobi/urlSafety.ts`.
- No scraping bypass: Jobi only reads the snippets SearXNG returns. If a source is blocked it is simply marked unavailable and the run continues.

---

## 7b. Hotel extraction backend

When `BACKEND_EXTRACTOR_URL` is set, the research pipeline fetches discovered pages and extracts structured hotel data before normalization. This is what turns search-result snippets (always OBSERVED) into page-backed offers that can be VERIFIED.

### Architecture

```
Convex internalAction
  │  BACKEND_EXTRACTOR_URL (server-side only, never exposed to browser)
  ▼
Python FastAPI service (backend/extractor/main.py)
  │  1. SSRF-safe fetch (http/https only, no private IPs, redirect-validated)
  │  2. JSON-LD extraction (primary) — <script type="application/ld+json">
  │  3. BeautifulSoup + lxml HTML fallback
  │  4. Optional Playwright for JS-rendered pages (never bypasses bot protection)
  │  5. Price validation + context classification (total / per-night / starting-from)
  ▼
Convex engine merges extracted offers into the normalize → dedupe → compare → verify pipeline
```

### Security

- **SSRF protection**: only `http://` and `https://` URLs on public hosts are fetched. `localhost`, `127.0.0.1`, `0.0.0.0`, private IPs, `.local` domains, and cloud metadata endpoints (`/metadata/`, `/latest/meta-data`, `/computeMetadata`) are blocked. Every redirect target is validated the same way.
- **Size limits**: responses are capped at ~5 MB; pages larger than that are truncated.
- **Timeout**: per-request fetch timeout is configurable via `EXTRACTION_TIMEOUT_MS` (default 20s).
- **Rate limiting**: simple per-IP fixed-window rate limit (60 req/min) on the FastAPI side.
- **No scraping bypass**: Playwright is never used to bypass CAPTCHA, authentication, paywalls, or anti-bot systems. If a page blocks automated access, it returns `access_blocked` and the pipeline continues with other sources.
- **No AI APIs**: the extractor uses no Ollama, OpenAI, Gemini, Claude, Groq, Perplexity, Tavily, Brave, or paid scraping/extraction APIs. Everything runs on SearXNG + Python + FastAPI + HTTPX + BeautifulSoup + lxml + optional Playwright.

### Running locally

```bash
cd backend
export EXTRACT_DISABLE_PLAYWRIGHT=1   # disable Playwright if you don't need JS pages
./run.sh                               # starts on http://localhost:8010
```

Or with Docker:

```bash
cd backend
docker compose up -d                  # starts extractor on 127.0.0.1:8010
curl -s http://localhost:8010/health   # {"ok":true,...}
```

Then set `BACKEND_EXTRACTOR_URL=http://localhost:8010` in the `.env` and the Convex backend will start sending pages to it.

### Testing a single URL

```bash
curl -s -X POST http://localhost:8010/extract \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/hotel","timeout_seconds":15}' | python -m json.tool
```

### Extracting a full batch (what the Convex backend does)

```bash
curl -s -X POST http://localhost:8010/extract-batch \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://example.com/hotel1", "https://example.com/hotel2"],
    "check_in": "2026-12-12",
    "check_out": "2026-12-15",
    "guests": 2,
    "rooms": 1,
    "timeout_seconds": 15
  }' | python -m json.tool
```

### Python dependencies

```bash
pip install -r backend/requirements.txt
# Optional (only for JS-rendered pages):
# pip install playwright && playwright install chromium
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_EXTRACTOR_URL` | (unset) | Base URL of the extraction service. When unset, extraction is skipped. |
| `EXTRACTION_TIMEOUT_MS` | `20000` | Per-batch extraction timeout in ms. |
| `EXTRACTION_MAX_URLS_PER_BATCH` | `30` | Max URLs sent to extractor per search. |

---

## 8. Logging

Structured, secret-free logs:

- `[searxng] {"event":"search_ok","queryLength":…,"resultCount":…,"durationMs":…}`
- `[searxng] {"event":"cache_hit",…}`
- `[searxng] {"event":"search_error","reason":"timeout|network|status|malformed_json|malformed_shape",…}`
- `[research] provider=searxng queries=… sources=… offers=… verified=… unavailable=… durationMs=…`
- `[extraction_stage_ok] {"urlsConsidered":…, "extractedOffers":…, "failedUrls":…, "extractionUsed":true}`
- `[extraction_run] {"searchId":…, "urlsConsidered":…, "successfulOffers":…, "failedUrls":…, "durationMs":…, "jsonldFound":…, "playwrightUsed":…}`

Never logged: auth tokens, private user data, the SearXNG URL, or the extraction backend URL.

---

## 9. Deploying SearXNG to a public host

The Convex Cloud backend runs outside this repo, so it needs a **stable, public HTTPS** address for SearXNG. Any host that can build a Dockerfile from this repository works: the tuned `searxng/settings.yml` (JSON output enabled, public limiter off) is baked into the image by `Dockerfile` / `searxng/Dockerfile`, so `/search?format=json` works without extra configuration.

```
Internet ──► HTTPS ──► Jobi backend (Convex) ──► SearXNG ──► engines
```

Whichever host you pick, finish with:

```bash
bunx convex env set SEARXNG_URL https://<your-instance-host>
bunx convex run searchWeb:searxngHealth   # -> {"ok":true,"configured":true,...}
```

### Option A — Northflank (recommended: free, always-on, no sleeping)

Northflank's free **Developer Sandbox** plan is explicitly *"Always-on compute — no sleeping"* (2 free services). That matters here: a scale-to-zero host adds a 30–60s cold start that blows past the backend's 10s `SEARCH_TIMEOUT` and shows up as "search unavailable". Northflank does require a payment method on file to create resources, even on the free plan — the sandbox itself is not charged.

**Template import (fastest):** in Northflank go to **Templates → Create → Import**, paste [`northflank.json`](../northflank.json), then **Run**. It creates the project and a combined service that builds the root `Dockerfile` from `github.com/johnjoby01012008-ux/jobi-search` (branch `main`) and exposes port `8080` over public HTTPS.

**Manual equivalent:**

1. **Create project** → region *Asia South Delhi* (`asia-south-delhi`).
2. **Create → Combined service** → link the GitHub repo, branch `main`.
3. Build type **Dockerfile**, Dockerfile path `/Dockerfile` (repo root).
4. Add port **8080**, protocol **HTTP**, mark it **public**.
5. Plan **nf-compute-20** (0.2 vCPU / 512 MB) — SearXNG needs ~512 MB.
6. **Create service**, then copy the generated `https://…` domain.

The service is continuous: one instance stays running, so there is no cold start between user searches.

### Option B — Fly.io

`searxng/fly.toml` is ready to go (one warm machine, `auto_stop_machines = false`, `min_machines_running = 1`):

```bash
cd searxng
fly apps create jobi-searxng          # the name must be globally unique
fly secrets set SEARXNG_SECRET="$(openssl rand -hex 32)"
fly deploy
curl https://jobi-searxng.fly.dev/healthz
```

### Option C — Your own VPS (docker-compose)

1. On the VPS, remove the `ports:` block from the `searxng` service in `docker-compose.yml` so nothing publishes it publicly.
2. Run the backend in a container on the **same** `jobi-search` network, or reach SearXNG over a private tunnel/VPC. Set `SEARXNG_URL=http://searxng:8080`.
3. Put a strong `SEARXNG_SECRET_KEY` in the environment (`searxng/settings.yml` ships a dev placeholder — change it).
4. Keep `server.limiter: false` since only your backend calls the instance; re-enable it only if you also add your backend to `searxng/limiter.toml` → `botdetection.ip_lists.pass_ip`.
5. Keep the volume mount `./searxng:/etc/searxng:rw` so config persists.

No application rewrite is needed — only `SEARXNG_URL` changes.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `/search?format=json` → `403` | JSON not enabled. Ensure `search.formats` includes `json` in `searxng/settings.yml`. |
| Backend health reports `configured:false` | `SEARXNG_URL` is not set for the backend. Set it and re-run `bunx convex dev --once`. |
| Backend health reports `ok:false, reason:"unreachable"` | Container down or wrong address. `docker compose ps`, then `curl http://localhost:8888/healthz`. |
| `reason:"malformed_response"` | SearXNG answered but not JSON — re-check `search.formats`. |
| UI says "Demo data" | `SEARXNG_URL` unset or `JOBI_FORCE_DEMO=1`. The mock provider is being used. |
| Search fails with "temporarily unavailable" | All queries failed: check `docker compose logs searxng` and the backend logs. |
| Timeouts | Raise `SEARCH_TIMEOUT` (ms) and/or `outgoing.request_timeout` in `searxng/settings.yml`. |
| Extracted offers all "observed" | The extractor found prices but could not verify them from structured data. Check that target pages ship JSON-LD; otherwise prices stay observed. |
| Extraction stage not running | `BACKEND_EXTRACTOR_URL` is not set, or the extractor service is down. Check `docker compose logs extractor` or `curl http://localhost:8010/health`. |

---

## 11. Tests

```bash
bun run test        # vitest — includes the SearXNG transport + provider suites
bun run lint
bunx convex dev --once && bunx tsc -b --noEmit
```

The suites cover connection, `searchWeb()`, timeout, malformed responses, hotel normalization, price extraction, duplicate results, cross-worker caching, cheapest-result selection, unavailable booking sources, and booking-link handling.

`src/convex/jobi/__tests__/infra.test.ts` additionally guards the Docker setup itself: JSON output enabled, no public port publish, healthcheck present, no hardcoded SearXNG address anywhere in `src/`, and the search client kept out of the frontend bundle. Because CI/sandboxes often lack Docker, the transport tests use an injected fake `fetchImpl` and clock rather than a live container.
