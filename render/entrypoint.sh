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
# Startup order matters:
#   - uvicorn starts FIRST (background). The entrypoint polls /health until it
#     answers, then starts SearXNG. If uvicorn never becomes healthy the
#     entrypoint exits nonzero and Render restarts the instance.
#   - SearXNG is started LAST through the ORIGINAL stock entrypoint, execed as
#     PID 1. That preserves the image's own initialization (settings file
#     creation, granian as PID 1, signal handling). If granian dies the
#     container exits and Render restarts it.
#
# PYTHONPATH discipline:
#   - The official searxng/searxng image does NOT set PYTHONPATH; searx is
#     importable because granian runs from /usr/local/searxng/.venv where the
#     searx package is installed. We NEVER override PYTHONPATH for granian.
#     The stock entrypoint inherits the shell environment we leave behind, so
#     granian keeps using the venv's own site-packages.
#   - The extractor runs in its OWN import sandbox: uvicorn is started with
#     `-p /opt/extractor-libs` and PYTHONPATH set to only that dir plus the app
#     dir. That way the extractor can never accidentally import searx, and
#     SearXNG's env is never polluted by the extractor's deps.
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
    echo "FATAL: JOBI_EDGE_TOKEN must contain only letters, digits, '_' and '-'." >&2
    exit 1
    ;;
esac

export PORT SEARXNG_INTERNAL_URL

# SearXNG is started LAST and execed as PID 1 by the stock entrypoint. We leave
# PYTHONPATH untouched so granian keeps using the image venv. The extractor (started
# below) gets its own PYTHONPATH.

export JOBI_EDGE_TOKEN

UVICORN="/usr/local/searxng/.venv/bin/uvicorn"
if [ ! -x "$UVICORN" ]; then
  echo "FATAL: uvicorn not found at $UVICORN" >&2
  exit 1
fi

# Extractor lives in its own Python env: only the isolated target dir and the
# app dir are on its PYTHONPATH. This never touches the SearXNG PYTHONPATH that
# granian needs (which is left intact in the shell environment).
export PYTHONPATH="/opt/extractor-libs:/app"

echo "[entrypoint] starting extractor on 0.0.0.0:$PORT" >&2
nohup "$UVICORN" extractor.main:app \
  --host 0.0.0.0 --port "$PORT" \
  --log-level info \
  --timeout-keep-alive 30 \
  >>/tmp/extractor.log 2>&1 &
UVICORN_PID=$!

# Give uvicorn a moment to start, then poll /health.
HEALTH_URL="http://127.0.0.1:${PORT}/health"
RETRIES=40
SLEEP_S=1
for i in $(seq 1 "$RETRIES"); do
  if curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$HEALTH_URL" | grep -qE "^(200|403)$"; then
    echo "[entrypoint] extractor is up (PID $UVICORN_PID)" >&2
    break
  fi
  if [ "$i" -eq "$RETRIES" ]; then
    echo "[entrypoint] extractor failed to become healthy within $((RETRIES * SLEEP_S))s" >&2
    echo "[entrypoint] last extractor log:" >&2
    tail -n 40 /tmp/extractor.log >&2 || true
    kill "$UVICORN_PID" 2>/dev/null || true
    exit 1
  fi
  sleep "$SLEEP_S"
done

# Discard uvicorn's PID — SearXNG becomes PID 1 below and is the process
# Render's supervisor watches. If uvicorn later dies, /render-health starts
# failing and Render restarts the instance.
echo "[entrypoint] starting SearXNG (PID 1)" >&2

# The official image entrypoint is /usr/local/searxng/entrypoint.sh. It validates
# config, fixes ownership, then execs granian as PID 1. We do not reimplement it.
exec /usr/local/searxng/entrypoint.sh "$@"
