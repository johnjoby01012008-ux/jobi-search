# -------------------------------------------------------------------
# Render single-service edge image (free tier, ₹0).
#
# Single Render Free web service runs BOTH:
#   - FastAPI extractor (public edge, token-gated, binds $PORT)
#   - SearXNG (loopback only on 127.0.0.1:8080, proxied via /search)
#
# The official searxng/searxng base image is Void Linux with its package
# manager REMOVED (xbps-remove -Rofy xbps), so nothing can be apk/apt
# installed here. All Python deps ship manylinux/musllinux wheels (verified
# against PyPI), so pip --target needs no compiler either.
#
# Python interpreter strategy:
#   - The official image's Python is /usr/local/searxng/.venv/bin/python.
#     We seed pip via ensurepip/get-pip.py (the image ships an empty venv),
#     then create a GENUINE SEPARATE virtualenv at /opt/extractor-env for the
#     extractor. This keeps the SearXNG environment 100% intact, untouched,
#     and isolated: granian / searx never sees the extractor's site-packages.
#   - The extractor's uvicorn lives at /opt/extractor-env/bin/uvicorn and its
#     shebang already points at the venv's interpreter, so FastAPI, Uvicorn,
#     httpx, pydantic and the rest resolve from the venv alone.
#   - We do NOT globally override PYTHONPATH for either process:
#       * The SearXNG (granian) process inherits the shell environment we
#         leave behind, with PYTHONPATH pointing at the SearXNG venv only.
#       * The extractor process uses only its venv bin (its shebang) and its
#         venv site-packages, so nothing can leak into the SearXNG process.
#   - We never use `pip install --target` with the SearXNG interpreter and we
#     never pass `--python` to pip. The image's own base Python is used only
#     to create the venv and to seed pip.
#
# Startup order:
#   1. uvicorn starts FIRST (background). The entrypoint polls /health.
#   2. SearXNG is started LAST through the ORIGINAL stock entrypoint, execed
#      as PID 1. That preserves the image's own initialization (settings file
#      creation, granian as PID 1, signal handling).
#   3. Both processes run, and runtime health checks verify both.
#
# Build context: repository root.
#   Render dashboard: Dockerfile Path = render.Dockerfile
#   or render.yaml (this repo) which sets it for you.
#
# Python for the extractor is installed into a genuine separate virtualenv
# (/opt/extractor-env) by the Dockerfile below, using the SearXNG image's
# own Python (via ensurepip → get-pip.py → python -m venv). We deliberately do
# not bake uvicorn into the official searxng/.venv; that venv is owned by the
# image's own packaging and mutating it can break `import searx`.
# -------------------------------------------------------------------

FROM docker.io/searxng/searxng:latest

USER root

# --- Python dependencies for the extractor (genuine separate virtualenv) ---
COPY backend/requirements.txt /tmp/extractor-requirements.txt
# The upstream venv is created by `uv venv` (no pip seeded). Seed pip via
# stdlib ensurepip, falling back to get-pip.py, then create a separate
# virtualenv for the extractor so the SearXNG image's own venv is never
# mutated and never contains the extractor's site-packages.
RUN set -eux; \
    PY=/usr/local/searxng/.venv/bin/python; \
    if ! "$PY" -m pip --version >/dev/null 2>&1; then \
      if ! "$PY" -m ensurepip --upgrade; then \
        /usr/bin/busybox wget -qO /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py; \
        "$PY" /tmp/get-pip.py --quiet; \
      fi; \
    fi; \
    "$PY" -m venv /opt/extractor-env; \
    /opt/extractor-env/bin/pip install --no-cache-dir --only-binary=:all: -r /tmp/extractor-requirements.txt; \
    rm -f /tmp/extractor-requirements.txt /tmp/get-pip.py

# --- Application code --------------------------------------------------
COPY backend/extractor /app/extractor
COPY render/entrypoint.sh /usr/local/bin/jobi-edge-entrypoint.sh
RUN chmod +x /usr/local/bin/jobi-edge-entrypoint.sh

WORKDIR /app

# --- Expose both ports (documentary; Render only forwards $PORT) --------
EXPOSE 8080 10000

# Pin SearXNG's granian to loopback: the metasearch engine must never be
# publicly reachable — only the token-gated FastAPI edge is (it proxies
# /search internally over SEARXNG_INTERNAL_URL).
#
# Official searxng/searxng:latest sets GRANIAN_HOST=:: (all interfaces) and
# GRANIAN_PORT=8080. The stock entrypoint maps SEARXNG_PORT -> GRANIAN_PORT but
# does NOT relabel GRANIAN_HOST, so we override GRANIAN_HOST ourselves.
ENV GRANIAN_HOST="127.0.0.1" \
    SEARXNG_INTERNAL_URL="http://127.0.0.1:8080"

# Locate the extractor's uvicorn with the same PATH semantics as
# `command -v uvicorn` on a host with the extractor environment. Using its
# absolute path in the image (and exporting EXTRACTOR_PY_PREFIX for the
# uvicorn command) guarantees the extractor never falls back to the official
# SearXNG venv, which deliberately does not contain fastapi/uvicorn/httpx.
# The extractor runs in its own virtualenv (/opt/extractor-env), so uvicorn
# resolves fastapi/uvicorn/httpx from there, not from the SearXNG venv.

# SearXNG settings (JSON output enabled, limiter off) are baked by copying
# the tuned files into the path the stock image expects.
COPY --chown=searxng:searxng searxng/settings.yml /etc/searxng/settings.yml
COPY --chown=searxng:searxng searxng/limiter.toml /etc/searxng/limiter.toml

# The supervisor holds the container as PID 1. `sh` is the smallest, most
# portable wrapper; it exports the same defaults the supervisor reads.
ENTRYPOINT ["/bin/sh", "/usr/local/bin/jobi-edge-entrypoint.sh"]

