"""Playwright fallback fetcher.

Used only when the regular HTTPX fetch returned a page that had no useful
JSON-LD and no extractable HTML price — i.e. a JS-rendered page that only
inlines content after load.

This module is deliberately separate so it can be disabled in environments that
don't have Playwright installed. When disabled, the extractor simply skips the
Playwright path and treats the page as "not enough info".
"""

from __future__ import annotations

import asyncio
from typing import Any

from .schemas import ExtractionResult, ExtractedHotel, FetchResult
from .extractor import extract_from_page
from .normalizer import normalize_offer


# ---------------------------------------------------------------------------
# Optional Playwright import
# ---------------------------------------------------------------------------

try:  # pragma: no cover - only used when playwright is installed
    from playwright.async_api import async_playwright, Browser, BrowserContext, Page
except Exception:  # pragma: no cover
    async_playwright = None  # type: ignore[assignment]
    Browser = Page = BrowserContext = object  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Concurrency limiter
# ---------------------------------------------------------------------------

class PlaywrightPool:
    """Simple bounded pool that serializes browser usage and shuts down cleanly."""

    def __init__(self, max_concurrent: int = 2, browser_type: str = "chromium") -> None:
        self.max_concurrent = max_concurrent
        self.browser_type = browser_type
        self._sem = asyncio.Semaphore(max_concurrent)
        self._browser: Browser | None = None
        self._playwright: Any = None
        self._closed = False

    async def start(self) -> None:
        if self._closed:
            return
        if async_playwright is None:
            raise RuntimeError("playwright is not installed")
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-software-rasterizer",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-default-apps",
                "--disable-sync",
                "--disable-translate",
                "--hide-scrollbars",
                "--mute-audio",
                "--no-first-run",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-device-discovery-notifications",
                "--safebrowsing-disable-auto-update",
                "--disable-breakpad",
                "--disable-crash-reporter",
                "--metrics-reporting-enabled=false",
            ],
        )

    async def close(self) -> None:
        self._closed = True
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None

    async def acquire(self) -> tuple[Browser | None, BrowserContext | None]:
        await self._sem.acquire()
        try:
            if self._browser is None:
                return None, None
            context = await self._browser.new_context(
                viewport={"width": 1366, "height": 900},
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
                locale="en-IN",
                timezone_id="Asia/Kolkata",
                java_script_enabled=True,
                ignore_https_errors=True,
            )
            return self._browser, context
        except Exception:
            self._sem.release()
            raise

    async def release(self, context: BrowserContext | None) -> None:
        if context:
            await context.close()
        self._sem.release()


# ---------------------------------------------------------------------------
# Single page fetch via Playwright
# ---------------------------------------------------------------------------

async def playwright_fetch_url(
    pool: PlaywrightPool,
    url: str,
    *,
    wait_until: str = "domcontentloaded",
    timeout_seconds: int = 20,
) -> FetchResult:
    """Fetch a page with Playwright and return the rendered HTML.

    Access-block detection: if the page body contains common block-pages or
    bot-challenge language, we treat it as ``access_blocked`` and do not attempt
    to extract pricing from it.
    """
    browser, context = await pool.acquire()
    try:
        if browser is None or context is None:
            return FetchResult(ok=False, reason="playwright_unavailable")

        page: Page = await context.new_page()

        try:
            response = await page.goto(
                url,
                wait_until=wait_until,
                timeout=timeout_seconds * 1000,
                referer="https://www.google.com/",
            )
        except Exception as exc:
            return FetchResult(ok=False, reason="playwright_error", notes={"error": str(exc)})

        if response is None:
            return FetchResult(ok=False, reason="playwright_no_response")

        status = response.status
        if status >= 400:
            return FetchResult(ok=False, reason="access_blocked", status_code=status)

        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type and "application/xhtml" not in content_type:
            return FetchResult(
                ok=False,
                reason="unsupported_page",
                status_code=status,
                content_type=content_type,
            )

        body = await page.content()
        if not body or len(body) < 200:
            return FetchResult(ok=False, reason="playwright_empty_page", status_code=status)

        # Bot-block heuristics: many sites serve a thin challenge page that contains
        # phrases like "verify you are human" or "cloudflare" / "captcha".
        lowered = body.lower()
        block_signals = (
            "captcha",
            "cloudflare",
            "checking your browser",
            "verify you are human",
            "unusual traffic",
            "access denied",
            "forbidden",
            "403 forbidden",
            "accesscontrol",
            "robot",
            "detected",
        )
        for signal in block_signals:
            if signal in lowered:
                return FetchResult(ok=False, reason="access_blocked", status_code=status, body=body[:4096])

        return FetchResult(
            ok=True,
            status_code=status,
            final_url=url,
            content_type=content_type,
            body=body.encode("utf-8") if isinstance(body, str) else body[:5_000_000],
        )
    finally:
        await pool.release(context)


# ---------------------------------------------------------------------------
# Extraction using Playwright
# ---------------------------------------------------------------------------

async def extract_with_playwright(
    pool: PlaywrightPool,
    fetch_result: FetchResult,
    *,
    check_in: str,
    check_out: str,
    guests: int,
    rooms: int,
) -> ExtractionResult:
    """Re-run extraction on the Playwright-rendered HTML.

    Falls back to a failure result when extraction still yields nothing.
    """
    if not fetch_result.ok or fetch_result.body is None:
        return ExtractionResult(
            success=False,
            reason=fetch_result.reason or "fetch_failed",
            notes={"playwright_used": True},
        )

    html = fetch_result.body
    if isinstance(html, bytes):
        html = html.decode("utf-8", errors="replace")

    extracted = extract_from_page(
        html=html,
        source_url=fetch_result.final_url or "",
        check_in=check_in,
        check_out=check_out,
        guests=guests,
        rooms=rooms,
    )

    hotel = extracted.get("proposed_hotel")
    if not hotel:
        return ExtractionResult(
            success=False,
            reason=extracted.get("reason") or "parse_failed",
            notes={
                "playwright_used": True,
                "jsonld_found": extracted.get("jsonld_found", False),
            },
        )

    return ExtractionResult(
        success=True,
        hotel=hotel,
        jsonld_found=extracted.get("jsonld_found", False),
        playwright_used=True,
        notes=extracted.get("notes", {}),
    )
