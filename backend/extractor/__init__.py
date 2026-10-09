"""Jobi hotel extraction service.

A FastAPI service (backend/extractor/main.py) that the Convex backend calls over
HTTP to extract hotel info + prices from publicly accessible web pages.

Design:
- JSON-LD is the primary extraction path.
- BeautifulSoup + lxml is the HTML fallback.
- Playwright is an optional last resort for JS-rendered pages; it is never used
  to bypass CAPTCHA / auth / paywalls / anti-bot.
- All fetches are SSRF-protected: http/https only, no private IPs / localhost /
  cloud metadata endpoints, and every redirect is validated.
- Prices are never fabricated; if extraction fails, the result is failure with a
  reason, not a fake offer.
"""

from .schemas import (
    ExtractBatchRequest,
    ExtractBatchResult,
    ExtractRequest,
    ExtractResult,
    ExtractedHotel,
    PriceAmount,
    PriceContext,
    ValidateRequest,
)
from .validators import (
    is_allowed_url,
    looks_like_price_context,
    is_plausible_price,
    price_cannot_be_phone_number,
    price_cannot_be_review_count,
    price_cannot_be_room_number,
)
from .security import fetch_page, FetchResult, parse_url_no_resolve
from .jsonld import extract_jsonld
from .html_parser import extract_from_html
from .extractor import extract_from_page
from .normalizer import normalize_offer, compare_total, same_hotel_weak

__all__ = [
    "ExtractBatchRequest",
    "ExtractBatchResult",
    "ExtractRequest",
    "ExtractResult",
    "ExtractedHotel",
    "PriceAmount",
    "PriceContext",
    "ValidateRequest",
    "is_allowed_url",
    "looks_like_price_context",
    "is_plausible_price",
    "price_cannot_be_phone_number",
    "price_cannot_be_review_count",
    "price_cannot_be_room_number",
    "fetch_page",
    "FetchResult",
    "parse_url_no_resolve",
    "extract_jsonld",
    "extract_from_html",
    "extract_from_page",
    "normalize_offer",
    "compare_total",
    "same_hotel_weak",
]
