#!/bin/sh
# Jobi edge entrypoint — Render single-service architecture (₹0 free tier).
#
# The supervisor (render/supervisor.py) owns both children and the container
# lifecycle:
#
#   1. SearXNG (granian)  -> 127.0.0.1:8080   (loopback only)
#   2. uvicorn / FastAPI  -> 0.0.0.0:$PORT    (token-gated edge)
#
# This file:
#   * exports the same defaults the supervisor reads, so the image hard-codes
#     nothing Python-version-specific;
#   * fails closed without JOBI_EDGE_TOKEN (a misconfigured deployment can
#     never expose the extraction endpoints);
#   * then `exec`s the supervisor as PID 1 (the supervisor owns both
#     children, enforces startup ordering + health, and translates any child
#     failure or shutdown signal into a clean exit).
#
# PYTHONPATH discipline is unchanged: the official searxng/searxng image does
# not set PYTHONPATH, and granian runs from /usr/local/searxng/.venv where the
# searx package is installed. The extractor runs in its own virtualenv at
# /opt/extractor-env with a self-contained venv interpreter, so neither
# process needs a global PYTHONPATH override. The supervisor only reads
# environment variables (never logs the edge token).
#
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

# The supervisor becomes PID 1 and stays as the container's long-running
# process. `exec` replaces this shell so signals land directly on it.
exec /usr/bin/env python3 /usr/local/bin/jobi-supervisor.py
