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
# Fail-closed: without JOBI_EDGE_TOKEN the container refuses to start, so a
# misconfigured deployment can never expose the extraction endpoints.
set -eu

: "${PORT:=10000}"

if [ -z "${JOBI_EDGE_TOKEN:-}" ]; then
  echo "FATAL: JOBI_EDGE_TOKEN is not set." >&2
  echo "Set it in the Render dashboard (Environment tab), value: \$(openssl rand -hex 32)" >&2
  exit 1
fi
case "$JOBI_EDGE_TOKEN" in
  *[!A-Za-z0-9_-]*)
    echo "FATAL: JOBI_EDGE_TOKEN must contain only letters, digits, '_' and '-'." >&2
    exit 1
    ;;
esac

: "${SEARXNG_INTERNAL_URL:=http://127.0.0.1:8080}"
export PORT SEARXNG_INTERNAL_URL

# Public edge: token-gated FastAPI (extractor + /search proxy + /render-health).
PYTHONPATH="/opt/extractor-libs:/app" nohup /usr/local/searxng/.venv/bin/python -m uvicorn \
  extractor.main:app \
  --host 0.0.0.0 --port "$PORT" \
  --log-level info >>/tmp/extractor.log 2>&1 &

# Foreground: stock SearXNG entrypoint (validates config, starts granian as
# PID 1). If granian dies the container exits and Render restarts it; if
# uvicorn dies, /render-health fails and Render restarts the instance too.
exec /usr/local/searxng/entrypoint.sh "$@"
