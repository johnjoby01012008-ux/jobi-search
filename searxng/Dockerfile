# ---------------------------------------------------------------------------
# Jobi Search — SearXNG image for a public container host (e.g. Fly.io).
# ---------------------------------------------------------------------------
#
# This reuses the SAME tuned config as docker-compose.yml (JSON output enabled,
# public limiter disabled, finite outgoing timeout). The only difference is the
# deployment target: docker-compose runs it loopback-only for local dev, while
# this image is meant to run somewhere the Convex Cloud backend can reach over
# HTTPS (see fly.toml and docs/SEARXNG.md).
#
# Build/deploy:
#   cd searxng
#   docker build -t jobi-searxng .
#   # or, for Fly.io:
#   fly deploy
# ---------------------------------------------------------------------------

FROM docker.io/searxng/searxng:latest

# Bake the tuned settings into the image so the deployed instance keeps JSON
# output enabled and the limiter off. Owned by the image's unprivileged
# `searxng` user, matching the base image.
COPY --chown=searxng:searxng settings.yml /etc/searxng/settings.yml

# The official image already listens on 0.0.0.0:8080 and runs as `searxng`.
EXPOSE 8080
