"""Jobi hotel extraction service — FastAPI.

Public endpoints:
- POST /extract             — extract one URL (for testing / debugging)
- POST /extract-batch       — extract many URLs for one search session
- GET  /health              — liveness
- POST /validate-url        — SSRF pre-check (used by Convex backend before fetch)

The service talks to the Convex backend over HTTP. The Convex backend calls it
from an internalAction, so it never exposes the extractor URL to the browser.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .schemas import (
    ExtractBatchRequest,
    ExtractBatchResult,
    ExtractRequest,
    ExtractResult,
    ValidateRequest,
)
from .security import fetch_page, FetchResult
from .extractor import extract_from_page
from .playwright_fetcher import PlaywrightPool, extract_with_playwright
from .validators import is_allowed_url


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MAX_URLS_PER_BATCH = int(os.environ.get("EXTRACT_MAX_URLS_PER_BATCH", "30"))
MAX_BYTES_PER_PAGE = int(os.environ.get("EXTRACT_MAX_BYTES_PER_PAGE", "5000000"))
FETCH_TIMEOUT_DEFAULT = int(os.environ.get("EXTRACT_FETCH_TIMEOUT_SECONDS", "15"))
PLAYWRIGHT_MAX_CONCURRENT = int(os.environ.get("EXTRACT_PLAYWRIGHT_MAX_CONCURRENT", "2"))
PLAYWRIGHT_ENABLED = os.environ.get("EXTRACT_DISABLE_PLAYWRIGHT", "").strip().lower() not in ("1", "true", "yes")
PLAYWRIGHT_TIMEOUT_DEFAULT = int(os.environ.get("EXTRACT_PLAYWRIGHT_TIMEOUT_SECONDS", "20"))

# Per-IP rate limit: simple fixed-window counter (not distributed; fine for a
# single-process extractor). In production you'd back this with Redis.
_rate_limits: dict[str, list[float]] = {}
_RATE_WINDOW_SECONDS = 60
_RATE_MAX_REQUESTS = 60


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(key: str) -> bool:
    now = time.time()
    window = _rate_limits.get(key, [])
    window = [t for t in window if t > now - _RATE_WINDOW_SECONDS]
    if len(window) >= _RATE_MAX_REQUESTS:
        return False
    window.append(now)
    _rate_limits[key] = window
    return True


# ---------------------------------------------------------------------------
# Application lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start Playwright pool on startup if enabled.
    if PLAYWRIGHT_ENABLED:
        try:
            app.state.playwright_pool = PlaywrightPool(max_concurrent=PLAYWRIGHT_MAX_CONCURRENT)
            await app.state.playwright_pool.start()
            app.state.playwright_available = True
        except Exception as exc:
            app.state.playwright_available = False
            app.state.playwright_error = str(exc)
            print(f"[extractor] Playwright unavailable: {exc}")
    else:
        app.state.playwright_available = False

    yield

    pool = getattr(app.state, "playwright_pool", None)
    if pool is not None:
        await pool.close()


app = FastAPI(
    title="Jobi Hotel Extraction Service",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    pool = getattr(app.state, "playwright_pool", None)
    return {
        "ok": True,
        "playwright_enabled": PLAYWRIGHT_ENABLED,
        "playwright_available": getattr(app.state, "playwright_available", False),
        "playwright_error": getattr(app.state, "playwright_error", None),
        "max_urls_per_batch": MAX_URLS_PER_BATCH,
    }


# ---------------------------------------------------------------------------
# URL validation endpoint
# ---------------------------------------------------------------------------

@app.post("/validate-url", response_model= dict[str, Any])
async def validate_url(req: ValidateRequest, request: Request):
    if not _check_rate_limit(_client_key(request)):
        raise HTTPException(status_code=429, detail="rate limited")

    url = str(req.url)
    ok = is_allowed_url(url)
    return {
        "ok": ok,
        "url": url,
        "reason": "blocked_url" if not ok else None,
    }


# ---------------------------------------------------------------------------
# Single URL extraction
# ---------------------------------------------------------------------------

@app.post("/extract", response_model= ExtractResult)
async def extract_one(req: ExtractRequest, request: Request):
    if not _check_rate_limit(_client_key(request)):
        raise HTTPException(status_code=429, detail="rate limited")

    if not is_allowed_url(str(req.url)):
        return ExtractResult(
            success=False,
            reason="blocked_url",
            notes={"url": str(req.url)},
        )

    start = time.time()
    fetch_result = fetch_page(
        str(req.url),
        timeout_seconds=req.timeout_seconds,
        max_bytes=MAX_BYTES_PER_PAGE,
    )

    if not fetch_result.ok:
        return ExtractResult(
            success=False,
            reason=fetch_result.reason or "fetch_failed",
            notes={
                "url": str(req.url),
                "status_code": fetch_result.status_code,
                "final_url": fetch_result.final_url,
                "fetch_elapsed_s": time.time() - start,
            },
        )

    extracted = extract_from_page(
        html=fetch_result.body.decode("utf-8", errors="replace"),
        source_url=fetch_result.final_url or str(req.url),
        check_in="2026-12-12",  # callers should prefer /extract-batch for real searches
        check_out="2026-12-15",
        guests=2,
        rooms=1,
    )

    hotel = extracted.get("proposed_hotel")
    if not hotel:
        return ExtractResult(
            success=False,
            reason=extracted.get("reason") or "parse_failed",
            jsonld_found=extracted.get("jsonld_found", False),
            notes={
                "url": str(req.url),
                "jsonld_found": extracted.get("jsonld_found", False),
                "html_parsed": True,
            },
        )

    return ExtractResult(
        success=True,
        hotel=hotel,
        jsonld_found=extracted.get("jsonld_found", False),
        notes=extracted.get("notes", {}),
    )


# ---------------------------------------------------------------------------
# Batch extraction — the real search-time path
# ---------------------------------------------------------------------------

@app.post("/extract-batch", response_model= ExtractBatchResult)
async def extract_batch(req: ExtractBatchRequest, request: Request):
    if not _check_rate_limit(_client_key(request)):
        raise HTTPException(status_code=429, detail="rate limited")

    if len(req.urls) > MAX_URLS_PER_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"Too many URLs: {len(req.urls)} > {MAX_URLS_PER_BATCH}",
        )

    successful: list[ExtractResult] = []
    failed: list[dict[str, Any]] = []
    pool = getattr(app.state, "playwright_pool", None)
    playwright_ok = getattr(app.state, "playwright_available", False)

    for url_obj in req.urls:
        url = str(url_obj)
        if not is_allowed_url(url):
            failed.append({"url": url, "reason": "blocked_url"})
            continue

        fetch_result = fetch_page(
            url,
            timeout_seconds=req.timeout_seconds,
            max_bytes=MAX_BYTES_PER_PAGE,
        )

        if not fetch_result.ok:
            failed.append({
                "url": url,
                "reason": fetch_result.reason or "fetch_failed",
                "status_code": fetch_result.status_code,
            })
            continue

        # Primary extraction on the raw HTTP body.
        html = fetch_result.body.decode("utf-8", errors="replace")
        extracted = extract_from_page(
            html=html,
            source_url=fetch_result.final_url or url,
            check_in=req.check_in,
            check_out=req.check_out,
            guests=req.guests,
            rooms=req.rooms,
        )

        hotel = extracted.get("proposed_hotel")
        if hotel:
            successful.append(ExtractResult(
                success=True,
                hotel=hotel,
                jsonld_found=extracted.get("jsonld_found", False),
                notes=extracted.get("notes", {}),
            ))
            continue

        # If we got no hotel yet and Playwright is available, try JS rendering.
        if playwright_ok and pool is not None and fetch_result.status_code == 200:
            pw_result = await playwright_fetch_url(
                pool,
                fetch_result.final_url or url,
                timeout_seconds=PLAYWRIGHT_TIMEOUT_DEFAULT,
            )
            if pw_result.ok:
                pw_extracted = await extract_with_playwright(
                    pool,
                    pw_result,
                    check_in=req.check_in,
                    check_out=req.check_out,
                    guests=req.guests,
                    rooms=req.rooms,
                )
                if pw_extracted.success and pw_extracted.hotel:
                    successful.append(pw_extracted)
                    continue

        failed.append({
            "url": url,
            "reason": extracted.get("reason") or "parse_failed",
            "status_code": fetch_result.status_code,
            "jsonld_found": extracted.get("jsonld_found", False),
        })

    return ExtractBatchResult(
        successful=successful,
        failed=failed,
        elapsed_seconds=round(time.time() - start, 3) if False else 0.0,
    )


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    return JSONResponse(
        status_code=422,
        content={"ok": False, "error": "validation_error", "details": exc.errors()},
    )
