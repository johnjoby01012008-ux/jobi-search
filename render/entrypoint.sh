#!/bin/sh
# Jobi edge entrypoint — Render single-service architecture (₹0 free tier).
#
# One container runs BOTH backend services:
#   1. FastAPI extractor (uvicorn)  -> 0.0.0.0:$PORT  (the ONLY public surface;
#      it token-gates /search, /extract, /extract-batch, /validate-url and
#      proxies /search to the co-located SearXNG over loopback).
#   2. SearXNG (granian)            -> 127.0.0.1:8080 (loopback only; Render
#      forwards inbound traffic to a single port, and GRANIAN_HOST pins
#      loopback as well, so the metasearch engine is never publicly reachable).
#
# Both services are started as children of the shell.  The startup sequence
# is:
#   1. uvicorn starts FIRST (background).  The entrypoint polls its /health
#      endpoint until it answers, or until the extractor has demonstrably
#      failed (e.g. missing uvicorn, import error, port conflict).
#   2. The stock SearXNG entrypoint is then exec'd as PID 1, which starts
#      granian on 127.0.0.1:8080.
#   3. Once both are running, the runtime /render-health endpoint (and a
#      polling loop in this file) verifies each process can answer, and the
#      container is reported healthy.
#
# A polling loop that waits for the *other* service before starting the
# current one would deadlock (SearXNG has not been started yet, and the
# extractor would block forever waiting for it).  We therefore start both,
# then poll each /health endpoint in parallel.
#
# PYTHONPATH discipline:
#   - The official searxng/searxng image does NOT set PYTHONPATH; searx is
#     importable because granian runs from /usr/local/searxng/.venv where the
#     searx package is installed. We NEVER override PYTHONPATH for granian.
#     The stock entrypoint inherits the shell environment we leave behind, so
#     granian keeps using the venv's own site-packages.
#   - The extractor's uvicorn lives in its OWN virtualenv (/opt/extractor-env),
#     and its shebang already points at that venv's interpreter. uvicorn
#     resolves fastapi/uvicorn/httpx from that venv, so we do NOT globally
#     override PYTHONPATH for the extractor either: the venv is self-contained.
#
# Fail-closed: without JOBI_EDGE_TOKEN the container refuses to start, so a
# misconfigured deployment can never expose the extraction endpoints.
set -eu

: "${PORT:=10000}"
: "${SEARXNG_INTERNAL_URL:=http://127.0.0.1:8080}"

if [ -z "${JOBI_EDGE_TOKEN:-}" ]; then
  echo "FATAL: JOBI_EDGE_TOKEN is not set." >&2
  echo "Set it in the Render dashboard (Environment tab), value: $(openssl rand -hex 32)" >&2
  exit 1
fi
case "$JOBI_EDGE_TOKEN" in
  *[!A-Za-z0-9_-]*)
    echo "FATAL: JOBI_EDGE_TOKEN must contain only letters, digits, '_' and '-'. " >&2
    exit 1
    ;;
esac

export PORT SEARXNG_INTERNAL_URL

# SearXNG is started LAST and execed as PID 1 by the stock entrypoint. We leave
# PYTHONPATH untouched so granian keeps using the image venv. The extractor
# (started below) gets its own isolated virtualenv.
export JOBI_EDGE_TOKEN

# Extractor uvicorn lives in its own virtualenv.  The shebang of the uvicorn
# binary inside that venv already points at the venv's interpreter, so uvicorn
# will import fastapi/uvicorn/httpx from the venv and nothing else.  We do not
# prepend the venv's site-packages to PYTHONPATH: doing so would inject the
# extractor's private paths into the SearXNG (granian) process too, which we
# must keep isolated.
UVICORN="/opt/extractor-env/bin/uvicorn"
if [ ! -x "$UVICORN" ]; then
  echo "FATAL: extractor uvicorn not found at $UVICORN" >&2
  echo "The extractor virtualenv was not created; rebuild the image." >&2
  exit 1
fi

echo "[entrypoint] starting extractor (PID background) on 0.0.0.0:$PORT" >&2
nohup "$UVICORN" extractor.main:app \
  --host 0.0.0.0 --port "$PORT" \
  --log-level info \
  --timeout-keep-alive 30 \
  >>/tmp/extractor.log 2>&1 &
EXTRACTOR_PID=$!

# Give uvicorn a moment to start, then poll /health.  This loop exists ONLY
# to (a) catch an extractor that failed to become healthy, and (b) provide
# a deterministic startup ordering requirement for the shared Render health
# endpoint /render-health.  It does NOT wait for SearXNG to be up.
HEALTH_URL="http://127.0.0.1:${PORT}/health"
RETRIES=40
SLEEP_S=1
EXTRACTOR_UP=0
for i in $(seq 1 "$RETRIES"); do
  if curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$HEALTH_URL" | grep -qE "^(200|403)$"; then
    echo "[entrypoint] extractor is up (PID $EXTRACTOR_PID)" >&2
    EXTRACTOR_UP=1
    break
  fi
  if [ "$i" -eq "$RETRIES" ]; then
    echo "[entrypoint] extractor failed to become healthy within $((RETRIES * SLEEP_S))s" >&2
    echo "[entrypoint] last extractor log:" >&2
    tail -n 40 /tmp/extractor.log >&2 || true
    kill "$EXTRACTOR_PID" 2>/dev/null || true
    exit 1
  fi
  sleep "$SLEEP_S"
done

# Start SearXNG LAST through the ORIGINAL stock entrypoint, execed as PID 1.
# That preserves the image's own initialization (settings file creation,
# granian as PID 1, signal handling).  If granian dies the container exits and
# Render restarts it.  If uvicorn later dies, /render-health starts failing and
# Render restarts the instance.
echo "[entrypoint] starting SearXNG (PID 1)" >&2
exec /usr/local/searxng/entrypoint.sh "$@"
