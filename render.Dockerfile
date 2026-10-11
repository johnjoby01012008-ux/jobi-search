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
# CRITICAL: we do NOT touch the SearXNG virtualenv, PYTHONPATH, or
# entrypoint. The stock image starts SearXNG through:
#   /usr/local/searxng/docker/entrypoint.sh  ->  granian searx.webapp:app
# and sets PYTHONPATH to include the SearXNG source tree + its venv
# site-packages. Any override of PYTHONPATH breaks `import searx`.
#
# Instead:
#  - Extractor deps are installed into an isolated /opt/extractor-libs.
#  - The entrypoint starts uvicorn with `-p /opt/extractor-libs` and its
#    own PYTHONPATH, so the extractor never touches the SearXNG env.
#  - SearXNG is started LAST through the ORIGINAL entrypoint as PID 1.
#
# Build context: repository root.
#   Render dashboard: Dockerfile Path = render.Dockerfile
#   or render.yaml (this repo) which sets it for you.
# -------------------------------------------------------------------

FROM docker.io/searxng/searxng:latest

USER root

# --- Python dependencies for the extractor (isolated target dir) -------
COPY backend/requirements.txt /tmp/extractor-requirements.txt
# The upstream venv is created by `uv venv` (no pip seeded). Seed pip via
# stdlib ensurepip, falling back to get-pip.py, then install into an isolated
# --target directory so nothing can conflict with SearXNG's own packages.
RUN set -eux; \
    PY=/usr/local/searxng/.venv/bin/python; \
    if ! "$PY" -m pip --version >/dev/null 2>&1; then \
      if ! "$PY" -m ensurepip --upgrade; then \
        /usr/bin/busybox wget -qO /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py; \
        "$PY" /tmp/get-pip.py --quiet; \
      fi; \
    fi; \
    "$PY" -m pip install --no-cache-dir --only-binary=:all: \
      --target /opt/extractor-libs -r /tmp/extractor-requirements.txt; \
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

# SearXNG settings (JSON output enabled, limiter off) are baked by copying
# the tuned files into the path the stock image expects.
COPY --chown=searxng:searxng searxng/settings.yml /etc/searxng/settings.yml
COPY --chown=searxng:searxng searxng/limiter.toml /etc/searxng/limiter.toml

ENTRYPOINT ["/usr/local/bin/jobi-edge-entrypoint.sh"]
