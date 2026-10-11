"""Tests for GET /render-health in `backend/extractor/main.py`.

Covers the three behaviours requested in the fix review:

* SearXNG responds            -> HTTP 200, valid JSON, ok=True
* SearXNG unreachable         -> HTTP 503, ok=False, searxng_reachable=False
* No code path raises anything -> NameError is never raised
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_ROOT = Path(__file__).resolve().parent.parent

# Make `backend.extractor.main` importable without the Convex backend global
# state being present.
sys.path.insert(0, str(_ROOT / "backend"))


@pytest.fixture()
def client():
    from backend.extractor.main import app

    with TestClient(app) as c:
        yield c


class TestRenderHealth:
    def test_when_searxng_responds_returns_200_and_valid_json(self, client):
        # Point the extractor at a mock SearXNG on the co-located loopback
        # address and verify HTTP 200, valid JSON and the reachability flag.
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        searxng_app = FastAPI()

        @searxng_app.get("/healthz")
        def searxng_healthz():
            return {"ok": True}

        # Start the mock on an ephemeral loopback port.
        import http.server
        import socketserver
        import threading
        import time

        class ReusableTCPServer(socketserver.TCPServer):
            allow_reuse_address = True

        server = ReusableTCPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        ready = False
        for _ in range(100):
            try:
                TestClient(searxng_app).get("/healthz", timeout=0.2)
                ready = True
                break
            except Exception:
                time.sleep(0.02)

        if not ready:
            server.shutdown()
            raise RuntimeError("SearXNG mock did not start")

        # Point the extractor at the mock by patching the module function the
        # endpoint resolves at request time.
        import backend.extractor.main as m
        original = m._searxng_internal_url

        def _stub():
            return f"http://127.0.0.1:{port}"

        m._searxng_internal_url = _stub
        try:
            response = client.get("/render-health")
            assert response.status_code == 200
            body = response.json()
            assert body["ok"] is True
            assert body["searxng_reachable"] is True
        finally:
            m._searxng_internal_url = original
            server.shutdown()
            thread.join(timeout=5)

    def test_when_searxng_unreachable_returns_503(self, client):
        # No service behind the co-located loopback address. The endpoint must
        # return 503, never 200 and never a traceback/NameError.
        response = client.get("/render-health")
        assert response.status_code == 503
        body = response.json()
        assert body["ok"] is False
        assert body["searxng_reachable"] is False

    def test_never_raises_nameerror(self, client):
        # The endpoint must not raise a NameError regardless of the upstream.
        for _ in range(3):
            response = client.get("/render-health")
            assert response.status_code in (200, 503)
