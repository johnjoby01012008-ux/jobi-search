# -------------------------------------------------------------------
# Jobi Render edge image — single Render Free web service (₹0).
#
# One container runs BOTH backend services and exposes one public port
# ($PORT):
#
#   1. FastAPI extractor (uvicorn, 0.0.0.0:$PORT)
#      - the ONLY public surface of the container.
#      - token-gated: /search, /extract, /extract-batch, /validate-url
#        require the shared X-Jobi-Token (JOBI_EDGE_TOKEN).
#      - proxy /search over loopback to the co-located SearXNG.
#   2. SearXNG (granian, 127.0.0.1:8080)
#      - loopback only. The token-gated edge is the only public path.
#      - proxied as /search by the extractor, so the edge health
#        endpoint /render-health can prove SearXNG is reachable.
#
# A small Python standard-library supervisor (render/supervisor.py) owns both
# children and the container lifecycle:
#   - starts SearXNG through the stock entrypoint, binds granian to
#     127.0.0.1:8080;
#   - waits for SearXNG's real HTTP health endpoint (/healthz);
#   - starts the extractor and waits for its HTTP /health;
#   - continuously monitors BOTH children;
#   - if either dies, terminates the other and exits nonzero so Render
#     restarts the container;
#   - forwards SIGTERM/SIGINT to both children and reaps them.
#
# Python strategy:
#   - The official searxng/searxng image ships an empty venv, so pip is
#     seeded via ensurepip/get-pip.py and a GENUINE SEPARATE virtualenv is
#     created at /opt/extractor-env for the extractor.
#   - The SearXNG environment is left 100% untouched and isolated: granian
#     keeps using the image venv's own site-packages.
#   - The extractor's uvicorn lives at /opt/extractor-env/bin/uvicorn and its
#     shebang already points at the venv's interpreter, so FastAPI, Uvicorn,
#     httpx, pydantic and the rest resolve from the venv alone.
#   - No global PYTHONPATH override is made for either process. The supervisor
#     only reads environment variables (never logs the edge token).
#
# Build context: repository root (Render uses dockerfilePath: ./render.Dockerfile).
# -------------------------------------------------------------------

FROM docker.io/searxng/searxng:latest

USER root

# --- Extractor Python dependencies (genuine separate virtualenv) -----------
# The upstream image venv is created by `uv venv` (no pip seeded). Seed pip via
# stdlib ensurepip, fall back to get-pip.py, then create a separate virtualenv
# for the extractor so the image's own venv is never mutated and never holds
# the extractor's site-packages.
COPY backend/requirements.txt /tmp/extractor-requirements.txt
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

# --- Application code ------------------------------------------------------
COPY render/supervisor.py /usr/local/bin/jobi-supervisor.py
COPY render/entrypoint.sh /usr/local/bin/jobi-edge-entrypoint.sh
RUN chmod +x /usr/local/bin/jobi-supervisor.py /usr/local/bin/jobi-edge-entrypoint.sh

# Application code (extractor + tests) for the local build context.
COPY backend/extractor /app/extractor
WORKDIR /app

# --- Expose both ports (documentary; Render only forwards $PORT) -----------
EXPOSE 8080 10000

# Pin SearXNG's granian to loopback. The official image sets GRANIAN_HOST=::
# and GRANIAN_PORT=8080; the stock entrypoint maps SEARXNG_PORT to
# GRANIAN_PORT but does NOT relabel GRANIAN_HOST, so the supervisor sets it
# explicitly. SearXNG stays private inside the container.
ENV GRANIAN_HOST="127.0.0.1" \
    GRANIAN_PORT="8080" \
    SEARXNG_INTERNAL_URL="http://127.0.0.1:8080"

# SearXNG settings (JSON output enabled, limiter off) are baked by copying the
# tuned files into the path the stock image expects.
COPY --chown=searxng:searxng searxng/settings.yml /etc/searxng/settings.yml
COPY --chown=searxng:searxng searxng/limiter.toml /etc/searxng/limiter.toml

# The supervisor holds the container as PID 1. `sh` is the smallest, most
# portable wrapper; it exports the same defaults the supervisor reads.
ENTRYPOINT ["/bin/sh", "/usr/local/bin/jobi-edge-entrypoint.sh"]
