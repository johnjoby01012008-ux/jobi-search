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

# Pin SearXNG's granian to loopback: the metasearch engine must never be
# publicly reachable — only the token-gated FastAPI edge is (it proxies
# /search internally over SEARXNG_INTERNAL_URL).
ENV GRANIAN_HOST="127.0.0.1" \
    GRANIAN_PORT="8080" \
    SEARXNG_INTERNAL_URL="http://127.0.0.1:8080"

# Render forwards inbound traffic to ONE port ($PORT, default 10000); the
# entrypoint binds uvicorn there. The SearXNG settings (JSON output enabled)
# are baked by the upstream image's own config path — we copy the tuned ones.
COPY --chown=searxng:searxng searxng/settings.yml /etc/searxng/settings.yml
COPY --chown=searxng:searxng searxng/limiter.toml /etc/searxng/limiter.toml

ENTRYPOINT ["/usr/local/bin/jobi-edge-entrypoint.sh"]
