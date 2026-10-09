"""Hotel extraction pipeline.

Run order:
1. JSON-LD (primary)
2. HTML fallback (BeautifulSoup)
3. Price validation + context classification
4. Build an ExtractedHotel (or return a failure reason)

This is the module the FastAPI route and the Convex backend both depend on.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from .html_parser import extract_from_html
from .jsonld import extract_jsonld
from .schemas import ExtractedHotel, ExtractionResult, PriceAmount, PriceContext
from .validators import (
    is_plausible_price,
    price_cannot_be_phone_number,
    price_cannot_be_review_count,
    price_cannot_be_room_number,
)


def _norm_currency_for_comparison(code: str) -> str:
    return code.strip().upper()


def _build_price_context(raw: str, price: dict[str, Any], nearby_hints: list[str]) -> PriceContext:
    return PriceContext(
        raw=raw[:200],
        price_type=price.get("price_type", "unknown"),
        nearby_hints=nearby_hints,
    )


def _confirm_price(
    amount: float,
    currency: str,
    context_text: str,
    hotel_name: str,
) -> tuple[bool, str | None]:
    """Return (ok, reason). A price is confirmed only when it looks like a hotel
    rate and not a room number / phone number / review count."""
    if not is_plausible_price(amount, currency):
        return False, "invalid_price"

    if not price_cannot_be_room_number(context_text, amount):
        return False, "invalid_price"

    if not price_cannot_be_phone_number(context_text, amount):
        return False, "invalid_price"

    if not price_cannot_be_review_count(context_text, amount):
        return False, "invalid_price"

    if not hotel_name:
        return False, "no_hotel_data"

    return True, None


def _compute_total(price: dict[str, Any], nights: int | None, taxes: float | None, fees: float | None) -> float | None:
    if price is None:
        return None
    amount = price["amount"]
    if price.get("price_type") == "total":
        return amount
    # per_night or unknown: assume per night.
    multiplier = nights if nights and nights > 0 else 1
    total = amount * multiplier
    if taxes:
        total += taxes
    if fees:
        total += fees
    return total


def extract_from_page(
    html: str,
    source_url: str,
    *,
    check_in: str,
    check_out: str,
    guests: int,
    rooms: int,
) -> dict[str, Any]:
    """Run the full extraction pipeline on a single fetched page.

    Returns a dict with keys:
    - jsonld_found
    - html_hotel_name, html_provider, html_room_name, html_price, html_price_context,
      html_rating, html_address, html_amenities, html_description,
      html_breakfast_included, html_cancellation_text, html_free_cancellation, html_availability
    - proposed_hotel: ExtractedHotel | None
    - reason: failure reason string | None
    - notes: dict
    """
    jsonld_result = extract_jsonld(html)
    jsonld_found = jsonld_result.get("jsonld_found", False)
    jsonld_primary = jsonld_result.get("primary", {})

    html_data = extract_from_html(html, source_url)

    # Merge JSON-LD primary into HTML data where JSON-LD is more complete.
    merged: dict[str, Any] = {
        "hotel_name": jsonld_primary.get("name") or html_data.get("hotel_name"),
        "provider": html_data.get("provider") or "",
        "room_name": jsonld_primary.get("name") or html_data.get("room_name"),
        "price": jsonld_primary.get("price") or html_data.get("price"),
        "price_context": html_data.get("price_context"),
        "rating": jsonld_primary.get("rating") if jsonld_primary.get("rating") is not None else html_data.get("rating"),
        "address": jsonld_primary.get("address") or html_data.get("address"),
        "amenities": jsonld_primary.get("amenities", []) or html_data.get("amenities", []),
        "description": jsonld_primary.get("description") or html_data.get("description"),
        "breakfast_included": jsonld_primary.get("breakfast_included") if jsonld_primary.get("breakfast_included") is not None else html_data.get("breakfast_included"),
        "cancellation_text": jsonld_primary.get("availability") or html_data.get("cancellation_text"),
        "free_cancellation": jsonld_primary.get("availability") if jsonld_primary.get("availability") == "available" else html_data.get("free_cancellation"),
        "availability": jsonld_primary.get("availability") or html_data.get("availability"),
    }

    if merged["hotel_name"]:
        hotel_name = merged["hotel_name"]
    else:
        return {
            **merged,
            "jsonld_found": jsonld_found,
            "proposed_hotel": None,
            "reason": "no_hotel_data",
            "notes": {"jsonld_found": jsonld_found, "html_parsed": True},
        }

    price = merged.get("price")
    if not price:
        return {
            **merged,
            "jsonld_found": jsonld_found,
            "proposed_hotel": None,
            "reason": "no_price",
            "notes": {"jsonld_found": jsonld_found, "html_parsed": True},
        }

    amount = price.get("amount")
    currency = price.get("currency", "INR")
    price_type = price.get("price_type", "unknown")

    # Build context text from page text (already available in html_data context).
    context_text = ""
    if merged.get("price_context"):
        context_text = merged["price_context"].get("raw", "")
    elif html_data.get("price_context"):
        context_text = html_data["price_context"].get("raw", "")

    ok, reason = _confirm_price(amount, currency, context_text, hotel_name)
    if not ok:
        return {
            **merged,
            "jsonld_found": jsonld_found,
            "proposed_hotel": None,
            "reason": reason,
            "notes": {"jsonld_found": jsonld_found, "html_parsed": True},
        }

    # Confidence: high when JSON-LD provided the price + context, medium when HTML-only
    # but with good context, low otherwise.
    if jsonld_found and jsonld_primary.get("price"):
        confidence = "high"
    elif merged.get("price_context") and merged["price_context"].get("price_type") in ("total", "per_night"):
        confidence = "medium"
    else:
        confidence = "low"

    # Total price: use the extracted amount as total unless we know nights.
    # We don't have the page's actual night count unless the UI supplied one, so
    # default to treating the found price as total when marked total, else per-night
    # and let the caller compute if it knows nights from the search params.
    nights = None
    try:
        from datetime import date
        d1 = date.fromisoformat(check_in)
        d2 = date.fromisoformat(check_out)
        nights = (d2 - d1).days
        if nights < 1:
            nights = 1
    except Exception:
        nights = None

    total_amount = _compute_total(price, nights, None, None)

    breakfast = merged.get("breakfast_included")
    ctext = merged.get("cancellation_text")
    free_cancel = merged.get("free_cancellation")

    booking_url = source_url

    return {
        **merged,
        "jsonld_found": jsonld_found,
        "proposed_hotel": ExtractedHotel(
            hotel_name=hotel_name,
            provider=merged.get("provider") or urlparse(source_url).hostname or "",
            room_name=merged.get("room_name"),
            check_in=check_in,
            check_out=check_out,
            guests=guests,
            rooms=rooms,
            price=PriceAmount(amount=float(amount), currency=currency),
            price_context=_build_price_context(context_text, price, merged.get("price_context", {}).get("nearby_hints", []) or []),
            taxes=None,
            total_price=float(total_amount) if total_amount else None,
            breakfast_included=breakfast,
            free_cancellation=free_cancel,
            cancellation_text=ctext,
            availability=merged.get("availability") or "unknown",
            booking_url=booking_url,
            source_url=source_url,
            price_verified=jsonld_found and jsonld_primary.get("price") is not None,
            confidence=confidence,
            rating=merged.get("rating"),
            address=merged.get("address"),
            amenities=merged.get("amenities", []),
            description=merged.get("description"),
            extracted_at="",  # set by caller
        ),
        "reason": None,
        "notes": {"jsonld_found": jsonld_found, "html_parsed": True},
    }
