# Self-hosted SearXNG search layer

Jobi Search uses a **self-hosted [SearXNG](https://docs.searxng.org/) instance**
as its only live search layer. There is **no Brave / Tavily / Serper / Google
API key** and **no paid search API** involved.

```
Frontend (Vite/React)
        │  (Convex queries/mutations only — never SearXNG)
        ▼
Jobi backend (Convex)
        │  SEARXNG_URL  (internal address, server-side only)
        ▼
SearXNG Docker service  ──►  public search engines
```

The SearXNG URL lives **only** on the backend in the `SEARXNG_URL` environment
variable. It is never returned by a query, never bundled into the frontend, and
the container is not published to the public internet.

---

## 1. Files

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | The `searxng` service, internal network and healthcheck. |
| `searxng/settings.yml` | SearXNG config — JSON output enabled, public limiter off. |
| `searxng/limiter.toml` | Bot-detection config (limiter disabled; kept explicit). |
| `env.example` | Copy to `.env`; documents `SEARXNG_URL`, `SEARCH_*`, `PAYMENT_MODE`. |
| `src/convex/jobi/search/searxng.ts` | The only module that talks to SearXNG (`searchWeb`). |
| `src/convex/jobi/search/price.ts` | Price/rating extraction from untrusted text. |
| `src/convex/jobi/providers/searxngProvider.ts` | Turns search results into offers. |
| `src/convex/jobi/providers/cachedProvider.ts` | Cross-worker cache decorator around the live provider. |
| `src/convex/searchCache.ts` | Table-backed shared cache (`searchCache` table). |
| `src/convex/searchWeb.ts` | Internal, secret-free health/debug actions. |

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

The container is reachable from your host at `http://localhost:8888` **only on
loopback** (`127.0.0.1:8888 → 8080`). That publish is for local debugging; it is
removed entirely on a VPS.

### Point the backend at it

The Convex backend runs outside Docker in this environment, so set the loopback
address in your `.env`:

```bash
cp env.example .env
# SEARXNG_URL=http://localhost:8888
```

When the backend runs **inside** the same Docker network as SearXNG (VPS), use
the service name instead:

```bash
SEARXNG_URL=http://searxng:8080
```

> Platform note: the hosting platform protects the dot-prefixed `.env.example`
> path from edits, so the template ships as `env.example`. `.env` is gitignored.

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

JSON output **must** be enabled (`searxng/settings.yml` → `search.formats`
includes `json`), otherwise `/search?format=json` returns `403`.

```bash
curl -s 'http://localhost:8888/search?q=hotels+in+Goa&format=json' | head -c 500
```

Or exercise the exact backend path with a raw query:

```bash
bunx convex run searchWeb:debugSearch '{"query":"hotels in Goa December 12 2026 December 15 2026 2 guests"}'

# Purge the shared search cache
bunx convex run searchCache:clear
```

`debugSearch` returns only `{ ok, count, latencyMs, results[] }` — no
environment, no internal URL, no secrets.

---

## 5. How the hotel-search pipeline works

1. The user describes a trip; `parseTripQuery` turns it into
   `{ destination, checkIn, checkOut, guests, rooms, budget, preferences }`.
2. `generateQueries` builds targeted queries, e.g.
   `hotels in Goa December 12 2026 December 15 2026 2 guests`, plus
   booking-source queries (`site:booking.com …`, `site:agoda.com …`,
   `site:makemytrip.com …`, and an official-website query). Not every site will
   be available — the engine simply continues with whatever comes back.
3. `SearXNGProvider` calls `searchWeb(query)` for each query. `searchWeb` builds
   `GET {SEARXNG_URL}/search?q=…&format=json`, with a timeout, then normalizes
   every result to:

   ```json
   { "title": "…", "url": "…", "source": "www.agoda.com",
     "snippet": "…", "price": 5400, "currency": "INR",
     "hotelName": "Sea Breeze Inn", "location": "Goa", "rating": 4.2 }
   ```

   `price` is `null` when no currency marker is present — prices are never
   invented. Snippet prices are always **observed**, never **verified**.
4. `normalizeResults` → `dedupeOffers` → `assignCanonicalNames` group the same
   hotel found across sources.
5. `buildComparison` sorts by final total (base + taxes + mandatory fees) and
   marks the cheapest **verified** offer. Any offer that differs in room type,
   meal plan, cancellation, guests, nights, fees or currency is annotated with
   those differences so a cheaper price is never passed off as the same product.
6. Results are persisted server-side; booking URLs stay on the server.

If **every** query fails, the run fails with the clean message
`Search is temporarily unavailable. Please try again.` — never a Docker or
network error.

---

## 6. The ₹10 booking-URL lock

```
search ─► results shown (no URL) ─► ₹10 verified ─► revealBookingUrl ─► URL
```

- `searches.getResults` **strips `bookingUrl` before the rows leave the server**
  (`redactSearchResults`) and sets `bookingUrlLocked: true`. This is not CSS
  hiding — the URL is never sent to an unpaid client.
- `searches.revealBookingUrl` re-loads the search and its payment, and returns
  the URL only when `canRevealBookingUrl` passes: the search is owned by the
  user, a payment exists for the same user, `status === "paid"`, and
  `verifiedAt > 0`. Otherwise it throws
  `Complete the ₹10 payment to reveal this booking link.`
- Every reveal is written to `auditLogs` (`booking_url_revealed`).
- In development `PAYMENT_MODE=mock` uses the built-in demo verifier (shown as
  DEMO in the UI). Swapping in Razorpay later means implementing the same
  `verifyPayment` contract; the lock logic does not change.

---

## 7. Security

- SearXNG is only reachable by the backend over `SEARXNG_URL`; the URL is never
  exposed to the browser and is redacted from all logs.
- User queries are validated and length-capped (`3–500` chars) before a search
  is stored.
- Rate limiting: max 30 searches/user/hour and a 15s minimum gap between runs.
- Identical queries are cached (default `SEARCH_CACHE_TTL=900`s) and concurrent
  identical requests are de-duplicated, so 20 users searching the same trip do
  not trigger 20 upstream searches. Caching happens at two levels:
  an in-process map inside `SearXNGClient`, plus a **shared `searchCache`
  Convex table** (`CachedResearchProvider`) so de-duplication holds across every
  worker and deployment, not just a single process. Empty and failed results are
  never cached, so an outage surfaces immediately instead of being pinned.
- Only `https:` URLs on real public hosts are kept; `javascript:`, `data:`,
  IP-literal and localhost links are dropped, and booking links must pass the
  provider allowlist in `src/convex/jobi/urlSafety.ts`.
- No scraping bypass: Jobi only reads the snippets SearXNG returns. If a source
  is blocked it is simply marked unavailable and the run continues.

---

## 8. Logging

Structured, secret-free logs:

- `[searxng] {"event":"search_ok","queryLength":…,"resultCount":…,"durationMs":…}`
- `[searxng] {"event":"cache_hit",…}`
- `[searxng] {"event":"search_error","reason":"timeout|network|status|malformed_json|malformed_shape",…}`
- `[research] provider=searxng queries=… sources=… offers=… verified=… unavailable=… durationMs=…`

Never logged: payment secrets, auth tokens, private user data, or the SearXNG URL.

---

## 9. Production / VPS deployment

```
Internet ──► HTTPS ──► Jobi backend ──► searxng (private Docker network) ──► engines
```

1. On the VPS, remove the `ports:` block from the `searxng` service in
   `docker-compose.yml` so nothing publishes it publicly.
2. Run the backend in a container on the **same** `jobi-search` network, or
   reach SearXNG over a private tunnel/VPC. Set
   `SEARXNG_URL=http://searxng:8080`.
3. Put a strong `SEARXNG_SECRET_KEY` in the environment
   (`searxng/settings.yml` ships a dev placeholder — change it).
4. Keep `server.limiter: false` since only your backend calls the instance;
   re-enable it only if you also add your backend to
   `searxng/limiter.toml` → `botdetection.ip_lists.pass_ip`.
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

---

## 11. Tests

```bash
bun run test        # vitest — includes the SearXNG + booking-lock suites
bun run lint
bunx convex dev --once && bunx tsc -b --noEmit
```

The suites cover connection, `searchWeb()`, timeout, malformed responses, hotel
normalization, price extraction, duplicate results, cross-worker caching,
cheapest-result selection, unavailable booking sources, payment not completed /
completed, and booking-URL protection.

`src/convex/jobi/__tests__/infra.test.ts` additionally guards the Docker setup
itself: JSON output enabled, no public port publish, healthcheck present, no
hardcoded SearXNG address anywhere in `src/`, and the search client kept out of
the frontend bundle. Because CI/sandboxes often lack Docker, the transport tests
use an injected fake `fetchImpl` and clock rather than a live container.
