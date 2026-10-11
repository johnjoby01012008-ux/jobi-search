#!/bin/sh
# Jobi edge entrypoint — Render single-service architecture (₹0 free tier).
#
# The supervisor is a small Python standard-library process (render/supervisor.py)
# that owns both children and the container lifecycle:
#
#   1. SearXNG (granian) -> 127.0.0.1:8080   (loopback only)
#   2. uvicorn / FastAPI -> 0.0.0.0:$PORT    (token-gated edge)
#
# The supervisor starts SearXNG through the stock entrypoint, waits for its
# real HTTP health endpoint, starts the extractor, waits for its /health, and
# then continuously monitors both. If either exits, it terminates the other and
# exits nonzero so Render restarts the container. Shutdown signals are
# forwarded to both children.
#
# PYTHONPATH discipline is unchanged: the official searxng/searxng image does
# not set PYTHONPATH, and granian runs from /usr/local/searxng/.venv where the
# searx package is installed. The extractor runs in its own virtualenv at
# /opt/extractor-env with a self-contained venv interpreter, so neither process
# needs a global PYTHONPATH override. The supervisor only reads environment
# variables (never logs the edge token).
#
# Fail-closed: without JOBI_EDGE_TOKEN the supervisor refuses to start, so a
# misconfigured deployment can never expose the extraction endpoints.
set -eu

export PORT SEARXNG_INTERNAL_URL

# Fail closed before binding anything.
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

# Bounded supervisor startup. The Dockerfile sets these to the same defaults
# when the variables are absent, so the image hard-codes nothing that a Python
# interpreter version would shift.
export PORT="${PORT:-10000}"
export SEARXNG_INTERNAL_URL="${SEARXNG_INTERNAL_URL:-http://127.0.0.1:8080}"

exec /usr/bin/env python3 /usr/local/bin/jobi-supervisor.py
