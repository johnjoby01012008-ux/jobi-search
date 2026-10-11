#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Jobi Render edge supervisor.

Long-running container process (PID 1) for the single-service edge image:

    render.Dockerfile builds one image that runs BOTH children on the same
    host and the same public port ($PORT):

      1. SearXNG (granian)   -> 127.0.0.1:8080   (loopback only)
      2. uvicorn / FastAPI   -> 0.0.0.0:$PORT    (token-gated edge)

The supervisor:

  * starts SearXNG through the stock entrypoint, binds granian strictly to
    127.0.0.1:8080;
  * waits for SearXNG's real HTTP health endpoint to answer before starting
    the extractor;
  * starts `/opt/extractor-env/bin/uvicorn extractor.main:app --host 0.0.0.0
    --port $PORT` and waits for its HTTP `/health`;
  * continuously monitors BOTH children after startup;
  * if either child exits, terminates the other and exits nonzero so Render
    restarts the container;
  * forwards SIGTERM/SIGINT to both children and reaps them.

Python standard-library process management only. Child stdout/stderr is
redirected straight to the container's log (the same file descriptors Docker
already captures), so no blocking `readline()` is used and the supervisor
keeps polling both children regardless of any child output.

This file ships as `/usr/local/bin/jobi-supervisor.py` and is the
container's main process; the shell wrapper only hard-codes the two defaults
the supervisor reads and then `exec`s it.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Config (the Dockerfile sets the same defaults when the variables are unset).
# ---------------------------------------------------------------------------

PORT = os.environ.get("PORT", "10000").strip() or "10000"
SEARXNG_INTERNAL_URL = os.environ.get(
    "SEARXNG_INTERNAL_URL", "http://127.0.0.1:8080"
).rstrip("/")

# Official searxng/searxng image ships this entrypoint inside the image
# itself (not in the repository).
SEARXNG_ENTRYPOINT = "/usr/local/searxng/entrypoint.sh"

# Extractor virtualenv shipped by render.Dockerfile.
EXTRACTOR_UVICORN = "/opt/extractor-env/bin/uvicorn"
EXTRACTOR_APP = "extractor.main:app"

# Bounded startup waits so a broken image cannot hang forever as a healthy
# process. Total budget in seconds.
SEARXNG_START_TIMEOUT = 30
EXTRACTOR_START_TIMEOUT = 60

# Failure loop: after a graceful stop, wait at most this long for children to
# finish, then escalate to SIGKILL.
STOP_TIMEOUT = 10
KILL_TIMEOUT = 5

# Health probes against the two services.
SEARXNG_HEALTH_PATH = "/healthz"
EXTRACTOR_HEALTH_URL = "http://127.0.0.1:{}/health".format(PORT)

# Never echo the shared edge token into logs.
_LOGGED_ENV_VARS = frozenset(
    {
        "JOBI_EDGE_TOKEN",
        "SEARXNG_SECRET_KEY",
        "SEARXNG_SECRET",
        "SEARXNG_API_KEY",
        "SEARXNG_AUTH_KEY",
        "EXTRACTOR_SECRET",
        "EXTRACTOR_TOKEN",
        "OPENAI_API_KEY",
        "OPENAI_ACCESS_TOKEN",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
    }
)


def _redact_env() -> dict[str, str]:
    """Return the environment with secrets stripped, for diagnostics."""
    redacted = {}
    for key, value in os.environ.items():
        if key in _LOGGED_ENV_VARS:
            redacted[key] = "***REDACTED***"
        else:
            redacted[key] = value
    return redacted


def _log(label: str, *lines: str) -> None:
    timestamp = time.strftime("%H:%M:%S")
    print("[supervisor:{}] {}".format(timestamp, label), *lines, flush=True)


def _http_get(url: str, timeout: float) -> int:
    """Return the HTTP status code, or 0 when the request fails."""
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except Exception:
        return 0


def _wait_for_http_health(url: str, timeout: float, label: str) -> bool:
    """Poll until a 2xx/3xx response, returning False on a hard timeout.

    Unsuccessful HTTP status codes are treated as failures here: a 503 from
    SearXNG or the extractor must stop startup, not count as healthy.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = _http_get(url, timeout=2.0)
        if 200 <= status < 400:
            _log("health_ok", label, "HTTP", status, url)
            return True
        _log("health_wait", label, "HTTP", status, "retry in 1s")
        time.sleep(1.0)
    return False


def _terminate(descriptor: str, process: subprocess.Popen[str], timeout: float) -> None:
    if process is None or process.poll() is not None:
        return
    _log("termination", descriptor, "pid", process.pid)
    try:
        process.terminate()
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        _log("termination_force", descriptor, "pid", process.pid)
        try:
            process.kill()
            process.wait(timeout=KILL_TIMEOUT)
        except Exception:
            pass


def _forward_signals(
    searxng: subprocess.Popen[str],
    extractor: subprocess.Popen[str],
) -> None:
    """Install SIGTERM/SIGINT handlers that shut down both children."""

    def _handle(signum: int, frame: object) -> None:
        _log("signal", "received", signum, "shutting_down")
        _terminate("searxng", searxng, timeout=STOP_TIMEOUT)
        _terminate("extractor", extractor, timeout=STOP_TIMEOUT)
        try:
            os.kill(os.getpid(), signum)
        except Exception:
            pass

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)


def _run_child(argv: list[str], env: dict[str, str]) -> subprocess.Popen[str]:
    """Spawn one child with its output directly on the container's log.

    stdout/stderr are inherited (subprocess.DEVNULL is intentionally NOT used),
    so Docker captures everything and the supervisor never blocks on a pipe
    buffer that a chatty child could fill. No `check=` argument is accepted or
    needed: Popen itself does not take `check`.
    """
    return subprocess.Popen(
        argv,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        text=True,
    )


def main() -> int:
    _log("env", _redact_env())
    _log(
        "usage",
        "PORT={}".format(PORT),
        "SEARXNG_INTERNAL_URL={}".format(SEARXNG_INTERNAL_URL),
    )

    if not os.path.exists(SEARXNG_ENTRYPOINT):
        _log("fatal", "SearXNG entrypoint not found", SEARXNG_ENTRYPOINT)
        return 1

    if not os.path.exists(EXTRACTOR_UVICORN):
        _log(
            "fatal",
            "extractor uvicorn not found",
            EXTRACTOR_UVICORN,
            "(rebuild the image)",
        )
        return 1

    # Preconfigure the environment for each child. SearXNG's stock entrypoint
    # reads GRANIAN_HOST/GRANIAN_PORT and the app reads SEARXNG_INTERNAL_URL;
    # the extractor reads PORT and SEARXNG_INTERNAL_URL.
    searxng_env = dict(os.environ)
    searxng_env["GRANIAN_HOST"] = "127.0.0.1"
    searxng_env["GRANIAN_PORT"] = "8080"
    searxng_env["SEARXNG_INTERNAL_URL"] = SEARXNG_INTERNAL_URL

    extractor_env = dict(os.environ)
    extractor_env["PORT"] = PORT
    extractor_env["SEARXNG_INTERNAL_URL"] = SEARXNG_INTERNAL_URL

    # Start SearXNG first through the stock entrypoint (granian as its child).
    # It is already looping on loopback, so the supervisor does not need to
    # start granian itself.
    searxng = _run_child(
        [SEARXNG_ENTRYPOINT, "granian"], searxng_env
    )
    _log("started", "searxng", "pid", searxng.pid)

    # Wait for SearXNG's real HTTP health endpoint. This blocks the extractor
    # from starting (and therefore blocks inbound requests) until SearXNG is
    # actually serving. This cannot deadlock: SearXNG is already running.
    if not _wait_for_http_health(
        "{}/{}".format(SEARXNG_INTERNAL_URL, SEARXNG_HEALTH_PATH),
        timeout=SEARXNG_START_TIMEOUT,
        label="searxng",
    ):
        _log(
            "fatal",
            "SearXNG failed to become healthy",
            "http",
            "{}/{}".format(SEARXNG_INTERNAL_URL, SEARXNG_HEALTH_PATH),
        )
        _terminate("searxng", searxng, timeout=STOP_TIMEOUT)
        return 1

    # Start the extractor now that SearXNG is confirmed alive.
    extractor = _run_child(
        [EXTRACTOR_UVICORN, EXTRACTOR_APP, "--host", "0.0.0.0", "--port", PORT],
        extractor_env,
    )
    _log("started", "extractor", "pid", extractor.pid)

    # Wait for the extractor's /health endpoint. A 503 or any non-2xx/3xx is a
    # failure: it means the extractor started but reports it is not ready, and
    # the container must exit nonzero so Render restarts it.
    if not _wait_for_http_health(
        "http://127.0.0.1:{}/health".format(PORT),
        timeout=EXTRACTOR_START_TIMEOUT,
        label="extractor",
    ):
        _log(
            "fatal",
            "extractor failed to become healthy",
            "http",
            "http://127.0.0.1:{}/health".format(PORT),
        )
        _terminate("searxng", searxng, timeout=STOP_TIMEOUT)
        _terminate("extractor", extractor, timeout=STOP_TIMEOUT)
        return 1

    _log("healthy", "both services up")

    # After startup, keep watching both children in an unbounded loop. Both
    # children must stay alive for the container to stay healthy. A dead
    # child -> terminate the other -> exit nonzero so the platform restarts.
    _forward_signals(searxng, extractor)
    while True:
        poll = searxng.poll()
        if poll is not None:
            _log("fatal", "SearXNG exited", "code", poll)
            _terminate("extractor", extractor, timeout=STOP_TIMEOUT)
            return 1
        poll = extractor.poll()
        if poll is not None:
            _log("fatal", "extractor exited", "code", poll)
            _terminate("searxng", searxng, timeout=STOP_TIMEOUT)
            return 1
        time.sleep(0.25)


if __name__ == "__main__":
    sys.exit(main())
