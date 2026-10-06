# ---------------------------------------------------------------------------
# Root Dockerfile — for Git-based container hosts that build from the repo root.
# ---------------------------------------------------------------------------
#
# Koyeb / Render / Northflank / Back4app all build with the REPOSITORY ROOT as
# the Docker build context. The SearXNG image itself is defined in
# `searxng/Dockerfile`, whose `COPY settings.yml` only resolves when the context
# is the `searxng/` directory (as with Fly.io). This root Dockerfile is the
# equivalent for root-context builds.
#
# If your host lets you set a "Root Directory" / build context to `searxng/`,
# you can ignore this file and point the host at `searxng/Dockerfile` instead.
#
# Container port: 8080 (SearXNG's default).
# ---------------------------------------------------------------------------

FROM docker.io/searxng/searxng:latest

# Bake the tuned settings (JSON output enabled, public limiter off) into the
# image so the backend's /search?format=json calls succeed.
COPY --chown=searxng:searxng searxng/settings.yml /etc/searxng/settings.yml
COPY --chown=searxng:searxng searxng/limiter.toml /etc/searxng/limiter.toml

EXPOSE 8080
