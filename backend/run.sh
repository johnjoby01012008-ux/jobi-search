#!/usr/bin/env bash
# Start the Jobi hotel extraction service.
#
# Prerequisites:
#   - Python 3.11+
#   - pip (or pipx) available
#   - (optional) Playwright for JS-rendered pages:
#       pip install playwright && playwright install chromium
#
# Usage:
#   ./run.sh            # HTTP on http://localhost:8010
#   ./run.sh --port 9000
#
# The service exposes:
#   POST /extract
#   POST /extract-batch
#   GET  /health
#   POST /validate-url
#
# The Convex backend calls this service from an internalAction using the
# BACKEND_EXTRACTOR_URL env var. See docs/EXTRACTION.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if command -v uv >/dev/null 2>&1; then
  PYTHON_CMD="uv run --with-requirements requirements.txt python"
else
  PYTHON_CMD="python"
fi

PORT="${1:-8010}"
if [[ "${PORT}" == --port* ]]; then
  PORT="${2:-8010}"
fi

exec $PYTHON_CMD -m uvicorn extractor.main:app \
  --host 127.0.0.1 \
  --port "$PORT" \
  --log-level info \
  --timeout-keep-alive 30 \
  "${@:2}"
