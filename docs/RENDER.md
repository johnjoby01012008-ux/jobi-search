# Deploying Jobi on Render — free tier, ₹0, no card

Verified against the **official Render docs** (docs.render.com/docs/free,
/docs/compute-plans, /docs/docker, /docs/blueprint-spec, /docs/health-checks,
/docs/web-services — checked October 2026). Every number below is quoted from
those pages; where Render does not document something, it says so.

**Cost of this plan: ₹0.** Render's first-deploy docs: *"No payment is
required."* No card, no trial, no billing setup
([source](https://render.com/docs/your-first-deploy)).

---

## 1. Architecture: one service, two processes

```
Internet ──HTTPS──► Render Free Web Service (jobi-edge)
                      └─ port $PORT (default 10000) — uvicorn / FastAPI, the ONLY public surface
                           ├─ GET  /render-health    composite liveness (no token; Render probes)
                           ├─ GET  /search           token-gated proxy ─► 127.0.0.1:8080 SearXNG (granian)
                           ├─ POST /extract          token-gated (SSRF checks intact)
                           ├─ POST /extract-batch    token-gated (SSRF checks intact)
                           ├─ POST /validate-url     token-gated (SSRF checks intact)
                           └─ (anything else)        404
                        SearXNG binds 127.0.0.1:8080 only (GRANIAN_HOST) — never publicly reachable
```

**Why single-service, not two** (the two-service option was evaluated first):

- Render Free gives **750 instance-hours per workspace per calendar month,
  shared** across Free web services. Two services running continuously would
  need 2 × 744 = **1488 h — impossible**; the pool would empty around day 15
  and *suspend all Free services in the workspace until next month*
  ([source](https://render.com/docs/free)). One service needs at most
  **744 h (31-day month) ≤ 750 h** even if it never slept — the only
  architecture whose worst case fits.
- The free plan has **no Valkey/Redis**, and SearXNG's built-in limiter
  *requires* Valkey ([source](https://docs.searxng.org/admin/searx.limiter.html)).
  A separately public SearXNG JSON endpoint would therefore be completely
  unauthenticated — an open search proxy burning our instance hours and
  inviting engine bans. Single-service fixes this: SearXNG binds loopback and
  the only public `/search` path is token-gated in FastAPI.
- One wake cycle starts both processes together (no second cold start), and
  service-to-service traffic is plain loopback — no private networking needed
  (Free services cannot *receive* private-network traffic anyway).

Technical soundness checks: SSRF protections unchanged (all URL validation
lives in `backend/extractor` and runs before any fetch); extraction endpoints
are unreachable without the shared token (`secrets.compare_digest`, fail-closed
entrypoint); Convex integration unchanged apart from one extra request header.

### Instance-hour math (task 5)

| Scenario | Hours/month | Fits 750 h pool? |
|---|---|---|
| Single service, never sleeps (worst case, 31-day month) | 744 | ✅ (6 h margin) |
| Single service, sleeps after 15 min idle (typical) | e.g. 30 wakes/day × 0.25 h + active time ≈ **100–200 h** | ✅ |
| Two services, never sleeps | 1488 | ❌ empties ~day 15, suspends workspace |
| Two services, both sleep-based, 30 wakes/day each | 2 × 30 × 0.25 = 15 h idle + active | ✅ but two cold starts per search + open SearXNG risk |

- **Sleep**: a Free service spins down after **15 minutes without inbound
  HTTP**; sleeping consumes **0 hours**; wake takes **~1 minute**
  ([source](https://render.com/docs/free)). Whether Render's own health-check
  polling counts as "inbound traffic" is **not documented** — the worst case
  (never sleeps) is covered above, so 24/7 operation fits either way. We do
  **not promise 24/7 availability**: Render may restart Free instances at any
  time and the service is explicitly "not intended for production".
- **Cold start handling**: Convex pings `/render-health` on both configured
  origins (in parallel, up to 75 s) before each research run
  (`wakeEdgeServices` in `src/convex/research.ts`), absorbing the wake latency
  once per idle period instead of failing the first queries.
- **Memory**: 512 MB / 0.1 vCPU per instance. The official SearXNG docs state
  **no official minimum**; community reports range 150–600 MB depending on
  worker count (2021 maintainer advice: 2 vCPU / 2 GB for comfortable
  production). SearXNG (granian, single worker) + uvicorn + lxml extraction
  is expected to fit, but **this is the largest uncertainty** — if the
  container is OOM-killed, Render restarts it (failed health checks for 60 s →
  automatic restart, [source](https://render.com/docs/health-checks)) and the
  next search pays one wake. Watch the Metrics tab for memory after deploying.
- **Builds**: Docker builds supported; 500 Starter build-minutes/month
  (Hobby workspace); 16 GB build disk; builds run **without** a card until the
  minutes run out (then new builds pause, running deploys keep running).
- **Bandwidth**: 5 GB outbound/month on Hobby. Extraction page fetches
  dominate: a 30-URL batch can pull ~10–30 MB. ~170–330 heavy searches per
  month fit; without a card, exceeding the cap **suspends the service for the
  rest of the month**. Mitigation: set `EXTRACTION_MAX_URLS_PER_BATCH=15`.

---

## 2. Exact dashboard deployment steps

### Option A — Blueprint (recommended)

1. Push this repository to GitHub (`johnjoby01012008-ux/jobi-search`).
2. Go to **dashboard.render.com → New → Blueprint**; connect the repo.
3. Render reads [`render.yaml`](../render.yaml): one Free Docker web service
   `jobi-edge`, Dockerfile `render.Dockerfile`, health path `/render-health`.
4. When prompted for **`JOBI_EDGE_TOKEN`**, generate and paste
   `openssl rand -hex 32` (letters/digits/_/- only — the entrypoint enforces
   this charset and refuses to start otherwise).
5. Click **Apply**. Wait for the build (first build installs Python wheels —
   a few minutes).

### Option B — manual service

1. **dashboard.render.com → New → Web Service**.
2. Connect the GitHub repository.
3. Settings:
   - **Runtime**: Docker
   - **Dockerfile Path**: `render.Dockerfile` (build context = repo root)
   - **Instance Type**: Free (512 MB RAM, 0.1 vCPU, sleeps after 15 min)
   - **Port**: leave default (`$PORT` = 10000; the entrypoint binds it)
4. **Environment → Add Environment Variable**:
   - `JOBI_EDGE_TOKEN` = `openssl rand -hex 32` (mark as *Secret* if offered)
5. **Health Check Path**: `/render-health`
6. Create the service; copy the `https://….onrender.com` URL.

> **Standalone note (backend/Dockerfile):** the extractor can also run alone
> with `backend/Dockerfile`, but its image binds port 8010 while Render
> forwards `$PORT` — in that case you must set a service env var
> `PORT=8010` so they match, plus `JOBI_EDGE_TOKEN`. The single-service
> `render.Dockerfile` (above) handles this itself and is the recommended path.
> Keep `backend/Dockerfile` for local/Docker use (`./run.sh` or
> `docker compose up`), where nothing needs changing.

### Post-deploy: wire Convex (server-side only, never client code)

```bash
bunx convex env set SEARXNG_URL        https://<your-service>.onrender.com
bunx convex env set BACKEND_EXTRACTOR_URL https://<your-service>.onrender.com   # SAME base URL
bunx convex env set JOBI_EDGE_TOKEN    <same value as in Render>
# recommended for the free tier:
bunx convex env set EXTRACTION_MAX_URLS_PER_BATCH 15
bunx convex env set SEARCH_TIMEOUT 15000          # ms; first query after a cold start
bunx convex env set EXTRACTION_TIMEOUT_MS 45000    # whole batch; per-URL clamped to ≤60 s
bunx convex run searchWeb:searxngHealth            # -> {"ok":true,"configured":true,...}
```

Full Convex env list (all server-side):

| Variable | Value | Purpose |
|---|---|---|
| `SEARXNG_URL` | `https://<svc>.onrender.com` | Search layer base URL (routed to `/search` by the edge) |
| `BACKEND_EXTRACTOR_URL` | `https://<svc>.onrender.com` | Extractor base URL (same service) |
| `JOBI_EDGE_TOKEN` | `openssl rand -hex 32` | Shared secret → `X-Jobi-Token` header on every edge call |
| `SEARCH_TIMEOUT` | `15000` (ms) | Per-search-query timeout |
| `SEARCH_CACHE_TTL` | `900` (s) | Cross-worker result cache TTL |
| `EXTRACTION_TIMEOUT_MS` | `45000` | Whole-batch abort; per-URL seconds clamped 5–60 |
| `EXTRACTION_MAX_URLS_PER_BATCH` | `15` | Bandwidth guard (≤30 backend hard limit) |

No variable is ever read by frontend code (`VITE_`-prefixed or otherwise); the
token lives only in Render's env store and Convex's server-side env.

---

## 3. Checks you must run after deployment

Run these yourself; only after they pass should anyone call the system live.

1. `curl -s https://<svc>.onrender.com/render-health` → `{"ok":true,"searxng_reachable":true}`
2. `curl -i 'https://<svc>.onrender.com/search?format=json&q=test'` → **403** (no token)
3. `curl -i -H 'X-Jobi-Token: $TOKEN' 'https://<svc>.onrender.com/search?format=json&q=goa+hotels'` → **200 JSON** with real `results`
4. `curl -i -X POST https://<svc>.onrender.com/extract -H 'Content-Type: application/json' -H 'X-Jobi-Token: $TOKEN' -d '{"url":"https://example.com/hotel","timeout_seconds":5}'` → **200** (403 without the header)
5. `curl -i -X POST https://<svc>.onrender.com/extract-batch …` with a real hotel URL + dates → `successful`/`failed` arrays with per-URL reasons; one blocked URL must appear in `failed`
6. `curl -i -X POST https://<svc>.onrender.com/validate-url -H … -d '{"url":"https://127.0.0.1/x"}'` → token-gated, `ok:false` (SSRF still enforced)
7. `curl -i https://<svc>.onrender.com/docs` → **404** (Swagger not exposed); `https://<svc>.onrender.com/` → **404** (SearXNG UI not exposed)
8. `bunx convex run searchWeb:searxngHealth` → `{"ok":true,"configured":true,…}`
9. Run a real search in the app; verify: offers returned, `verified` only for JSON-LD-extracted prices, `observed` for snippets, results visible in the frontend, and inspect the `[provider-report]` lines for per-provider state.
10. Cold-start test: wait 20 minutes idle, search again — expect ~60 s first-hit latency absorbed by the wake, then success.
11. Render **Metrics**: memory steady below 512 MB; instance hours accumulating within budget; bandwidth tracked.
12. Render **Logs**: no OOM/restart loop; `search_ok` events appear.

---

## 4. Known free-tier limitations (honest list)

- **No 24/7 guarantee**: sleep after 15 min idle, ~1 min cold start, Render may restart Free instances at any time; hours pool 750/month per workspace (worst-case 744 h fits, but with only 6 h margin in a 31-day month).
- **512 MB / 0.1 vCPU** shared by SearXNG + extractor; OOM restarts possible under heavy pages — watch metrics.
- **5 GB outbound/month**; exceeding it without a card suspends the service until next month. Keep `EXTRACTION_MAX_URLS_PER_BATCH` low.
- **500 build-minutes/month**; exceeding pauses *new builds* (running service unaffected).
- **One instance max**, no autoscaling, ephemeral disk (no persistent state; Playwright/Chromium is not installed in this image — JS-only pages fail honestly with `no_price`/`parse_failed` reasons, never fabricated).
- **Engine reachability from datacenter IPs** is unverified: Google may rate-limit SearXNG queries from Render's IP. If `/search` returns empty results often, that is an engine-side block — reported honestly through `providerDiagnostics`, not worked around.
- **Not production-grade** (Render's own wording for Free instances).

## 5. Cost

| Item | Cost |
|---|---|
| Render Free web service (this guide) | **₹0 / $0** (750 h pool, 5 GB, 500 build-min) |
| Convex Cloud (existing dev deployment) | ₹0 on its free tier (unchanged) |
| SearXNG / FastAPI / all libraries | ₹0 (FOSS, self-hosted) |
| Search & extraction APIs | ₹0 — no paid search/AI API exists in this stack |
| Card / billing | **Never required** (official: "No payment is required.") |
| **Total** | **₹0** |

Going over a free allowance never charges money without a card — Render
suspends the affected resource instead (builds pause; service suspends on
bandwidth overrun). That is a availability risk, not a billing risk.

## 6. Verdict

**A viable ₹0 deployment exists and does not need a card.** The single-service
architecture fits Render's free allowances even in the worst case (744 ≤ 750
instance-hours), keeps SearXNG and the extractor off the public internet
behind one shared-secret gate, and preserves every existing security control
(SSRF blocklist, per-IP rate limit, verified/observed price separation,
allowlisted booking links). What it cannot promise: constant uptime, large
bandwidth, or that every upstream search engine will tolerate Render's IP —
each of those degrades honestly in the product's own diagnostics rather than
being hidden.

**Nothing is claimed live until you run the Section 3 checks against your own
deployed URL.**
