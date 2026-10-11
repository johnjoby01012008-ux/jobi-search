"""Edge-surface tests for the Render single-service deployment.

Covers the three guarantees the deployed edge must provide (all verified
in-process; no live services needed):

1. When JOBI_EDGE_TOKEN is configured, /search, /extract, /extract-batch and
   /validate-url reject callers without the exact shared secret (403), while
   /health and /render-health stay reachable for liveness probes.
2. /search proxies to the co-located SearXNG over loopback and passes the
   upstream response through (verified against a local stub HTTP server).
3. /render-health is a composite check: 503 when SearXNG is unreachable,
   200 when it responds.

When JOBI_EDGE_TOKEN is unset (local development), behaviour is unchanged
from before — the service stays open on loopback.
"""

import http.server
import threading

from fastapi.testclient import TestClient

from extractor.main import app

TOKEN = "edgetoken123"

VALID_EXTRACT_BODY = {"url": "https://example.com/hotel", "timeout_seconds": 5}
VALID_BATCH_BODY = {
    "urls": ["https://example.com/hotel"],
    "check_in": "2026-12-12",
    "check_out": "2026-12-15",
    "guests": 2,
    "rooms": 1,
    "timeout_seconds": 5,
}
VALID_VALIDATE_BODY = {"url": "https://example.com/hotel"}


class _StubHandler(http.server.BaseHTTPRequestHandler):
    """Minimal HTTP stub standing in for co-located SearXNG."""

    def do_GET(self):  # noqa: N802 (http.server API)
        if self.path.startswith("/search"):
            body = b'{"results": [{"title": "Stub", "url": "https://example.com/"}]}'
            ctype = "application/json"
        else:
            body = b'{"status": "ok"}'
            ctype = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence stub logging
        pass


def test_token_gates_every_useful_endpoint(monkeypatch):
    monkeypatch.setenv("JOBI_EDGE_TOKEN", TOKEN)
    with TestClient(app) as client:
        # No token -> 403 everywhere that matters.
        assert client.post("/extract", json=VALID_EXTRACT_BODY).status_code == 403
        assert client.post("/extract-batch", json=VALID_BATCH_BODY).status_code == 403
        assert client.post("/validate-url", json=VALID_VALIDATE_BODY).status_code == 403
        assert client.get("/search?format=json&q=goa").status_code == 403
        # Wrong token -> still 403.
        assert (
            client.post(
                "/extract", json=VALID_EXTRACT_BODY, headers={"X-Jobi-Token": "wrong"}
            ).status_code
            == 403
        )
        # Liveness endpoints stay open (Render probes cannot send secrets).
        assert client.get("/health").status_code == 200
        # With the exact token the request passes the gate (outcome depends on
        # the target page, not on auth).
        r = client.post(
            "/extract", json=VALID_EXTRACT_BODY, headers={"X-Jobi-Token": TOKEN}
        )
        assert r.status_code == 200


def test_open_when_token_not_configured(monkeypatch):
    monkeypatch.delenv("JOBI_EDGE_TOKEN", raising=False)
    with TestClient(app) as client:
        assert client.post("/validate-url", json=VALID_VALIDATE_BODY).status_code == 200
        assert client.get("/health").status_code == 200


def test_render_health_503_when_searxng_unreachable(monkeypatch):
    monkeypatch.delenv("JOBI_EDGE_TOKEN", raising=False)
    # Nothing listens on this port.
    monkeypatch.setenv("SEARXNG_INTERNAL_URL", "http://127.0.0.1:9")
    with TestClient(app) as client:
        r = client.get("/render-health")
        assert r.status_code == 503
        assert r.json()["ok"] is False


def test_search_proxy_and_health_with_stub_searxng(monkeypatch):
    monkeypatch.setenv("JOBI_EDGE_TOKEN", TOKEN)
    stub = http.server.HTTPServer(("127.0.0.1", 0), _StubHandler)
    port = stub.server_address[1]
    thread = threading.Thread(target=stub.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setenv("SEARXNG_INTERNAL_URL", f"http://127.0.0.1:{port}")
        with TestClient(app) as client:
            # Composite health: stub answers -> 200.
            r = client.get("/render-health")
            assert r.status_code == 200
            assert r.json() == {"ok": True, "searxng_reachable": True}

            # Proxy: token required, then upstream status/body passed through.
            assert client.get("/search?format=json&q=goa").status_code == 403
            r = client.get(
                "/search?format=json&q=goa", headers={"X-Jobi-Token": TOKEN}
            )
            assert r.status_code == 200
            assert "results" in r.json()
    finally:
        stub.shutdown()
        stub.server_close()
        thread.join(timeout=5)
