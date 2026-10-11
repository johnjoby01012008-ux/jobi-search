#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Jobi Render edge supervisor.

Long-running container process (PID 1) for the single-service edge image:

    render.Dockerfile builds one image that runs BOTH children on the same
    host and the same public port ($PORT):

      1. SearXNG (granian)   -> 127.0.0.1:8080   (loopback only)
      2. uvicorn / FastAPI   -> 0.0.0.0:$PORT    (token-gated edge)

The supervisor:

  * starts the stock SearXNG entrypoint, then binds granian strictly to
    127.0.0.1:8080;
  * waits for SearXNG's real HTTP health endpoint to answer before starting
    the extractor;
  * starts `/opt/extractor-env/bin/uvicorn extractor.main:app --host 0.0.0.0
    --port $PORT` and waits for its HTTP `/health`;
  * continuously monitors BOTH children after startup;
  * if either child exits, terminates the other and exits nonzero so Render
    restarts the container;
  * forwards SIGTERM/SIGINT to both children and reaps them.

Python standard library only. This must stay a dependency-free file so the
container never needs a separate `python` interpreter package installed.
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
# Config (all optional; the Dockerfile sets the same defaults when unset).
# ---------------------------------------------------------------------------

PORT = os.environ.get("PORT", "10000").strip() or "10000"
SEARXNG_INTERNAL_URL = os.environ.get(
    "SEARXNG_INTERNAL_URL", "http://127.0.0.1:8080"
).rstrip("/")

# Official searxng/searxng image ships this entrypoint in the image itself.
SEARXNG_ENTRYPOINT = "/usr/local/searxng/entrypoint.sh"

# Extractor virtualenv shipped by render.Dockerfile.
EXTRACTOR_UVICORN = "/opt/extractor-env/bin/uvicorn"
EXTRACTOR_APP = "extractor.main:app"

# Bounded startup waits so a broken image cannot hang forever as a healthy
# process. Total budget in seconds.
SEARXNG_START_TIMEOUT = 30
EXTRACTOR_START_TIMEOUT = 60

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
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = _http_get(url, timeout=2.0)
        if status >= 200 and status < 400:
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
            process.wait(timeout=5)
        except Exception:
            pass


def _forward_signals(
    supervisor: object,
    searxng: subprocess.Popen[str],
    extractor: subprocess.Popen[str],
) -> None:
    """Install SIGTERM/SIGINT handlers that shut down both children."""

    def _handle(signum: int, frame: object) -> None:
        _log("signal", "received", signum, "shutting_down")
        _terminate("searxng", searxng, timeout=10)
        _terminate("extractor", extractor, timeout=10)
        try:
            os.kill(os.getpid(), signum)
        except Exception:
            pass

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)


def _run_child(
    argv: list[str], env: dict[str, str], check: bool
) -> subprocess.Popen[str]:
    return subprocess.Popen(
        argv,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def _read_child_output(
    descriptor: str, process: subprocess.Popen[str], deadline: float
) -> None:
    """Consume the child's stdout line-by-line until exit or timeout."""
    if process.stdout is None:
        return
    while time.monotonic() < deadline:
        line = process.stdout.readline()
        if not line:
            if process.poll() is not None:
                break
            time.sleep(0.1)
            continue
        trimmed = line.strip()
        if trimmed:
            _log("child", descriptor, "pid", process.pid, trimmed)


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

    env = dict(os.environ)

    # Preconfigure the env for each child. SearXNG's stock entrypoint reads
    # GRANIAN_HOST/GRANIAN_PORT and the app reads SEARXNG_INTERNAL_URL; the
    # extractor reads PORT and SEARXNG_INTERNAL_URL.
    searxng_env = dict(env)
    searxng_env["GRANIAN_HOST"] = "127.0.0.1"
    searxng_env["GRANIAN_PORT"] = "8080"
    searxng_env["SEARXNG_INTERNAL_URL"] = SEARXNG_INTERNAL_URL

    extractor_env = dict(env)
    extractor_env["PORT"] = PORT
    extractor_env["SEARXNG_INTERNAL_URL"] = SEARXNG_INTERNAL_URL

    # Run the supervisor with PATH and the extractor venv bin first so it can
    # locate `env python3` and the uvicorn binary reliably.
    supervisor_env = dict(env)
    supervisor_env["PATH"] = "/opt/extractor-env/bin:" + supervisor_env.get("PATH", "")

    # Start SearXNG first. Its own stock entrypoint becomes the child; the
    # supervisor keeps the parent shell as PID 1, so the container stays live.
    searxng = _run_child([SEARXNG_ENTRYPOINT], searxng_env, check=False)
    _log("started", "searxng", "pid", searxng.pid)

    # Wait for SearXNG's real HTTP health endpoint. This blocks the extractor
    # from starting (and therefore blocks inbound traffic) until SearXNG is
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
        _terminate("searxng", searxng, timeout=10)
        return 1

    # Start the extractor now that SearXNG is confirmed alive.
    extractor = _run_child(
        [EXTRACTOR_UVICORN, EXTRACTOR_APP, "--host", "0.0.0.0", "--port", PORT],
        extractor_env,
        check=False,
    )
    _log("started", "extractor", "pid", extractor.pid)

    # Wait for the extractor's /health endpoint. Non-2xx/3xx responses are
    # failures: a 503 from the extractor must stop startup, not count as up.
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
        _terminate("searxng", searxng, timeout=10)
        _terminate("extractor", extractor, timeout=10)
        return 1

    _log("healthy", "both services up")

    # After startup, keep watching both children. If either dies, kill the
    # other and exit nonzero so the container platform restarts the service.
    _forward_signals(None, searxng, extractor)
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        poll = searxng.poll()
        if poll is not None:
            _log("fatal", "SearXNG exited", "code", poll)
            _terminate("extractor", extractor, timeout=10)
            return 1
        poll = extractor.poll()
        if poll is not None:
            _log("fatal", "extractor exited", "code", poll)
            _terminate("searxng", searxng, timeout=10)
            return 1
        time.sleep(0.25)
        _read_child_output("searxng", searxng, deadline)
        _read_child_output("extractor", extractor, deadline)

    _log("fatal", "supervisor watchdog expired")
    _terminate("searxng", searxng, timeout=10)
    _terminate("extractor", extractor, timeout=10)
    return 1


if __name__ == "__main__":
    sys.exit(main())
