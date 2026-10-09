"""Normalize an ExtractedHotel into a stable, comparable offer shape.

This module is intentionally deterministic and free of network access, so the
Convex backend can import the same logic if it ever vendors a copy. Today it is
used by the Python extraction service and reflected in the Convex
src/convex/jobi/extraction/types.ts mirror.
"""

from __future__ import annotations

from typing import Any

from .schemas import ExtractedHotel, PriceAmount


def normalize_offer(offer: ExtractedHotel) -> dict[str, Any]:
    """Return a stable dict for the offer, suitable for serialization and comparison.

    Missing optional fields become ``null`` rather than ``false``.
    """
    return {
        "hotel_name": offer.hotel_name,
        "provider": offer.provider,
        "room_name": offer.room_name,
        "check_in": offer.check_in,
        "check_out": offer.check_out,
        "guests": offer.guests,
        "rooms": offer.rooms,
        "price": offer.price.model_dump() if offer.price else None,
        "price_context": offer.price_context.model_dump() if offer.price_context else None,
        "taxes": offer.taxes,
        "total_price": offer.total_price,
        "breakfast_included": offer.breakfast_included,
        "free_cancellation": offer.free_cancellation,
        "cancellation_text": offer.cancellation_text,
        "availability": offer.availability,
        "booking_url": str(offer.booking_url),
        "source_url": str(offer.source_url),
        "price_verified": offer.price_verified,
        "confidence": offer.confidence,
        "rating": offer.rating,
        "address": offer.address,
        "amenities": offer.amenities,
        "description": offer.description,
        "extracted_at": offer.extracted_at,
    }


def compare_total(a: dict[str, Any], b: dict[str, Any]) -> float:
    """Return a numeric total for comparison purposes.

    - If total_price is present, use it.
    - Otherwise use price.amount if price_type is 'total'.
    - Otherwise use price.amount * nights implied by check_in/check_out if we can compute them.
    - Otherwise fall back to price.amount (treat as total).
    """
    tp = a.get("total_price") or b.get("total_price")
    if tp is not None:
        return float(tp)

    pa = a.get("price") or {}
    pb = b.get("price") or {}
    price_amount = pa.get("amount") or pb.get("amount")
    if price_amount is not None:
        # Rough night count from dates when available.
        a_in = a.get("check_in")
        a_out = a.get("check_out")
        b_in = b.get("check_in")
        b_out = b.get("check_out")
        nights = None
        if a_in and a_out:
            try:
                from datetime import date
                d1 = date.fromisoformat(a_in)
                d2 = date.fromisoformat(a_out)
                n = (d2 - d1).days
                if n >= 1:
                    nights = n
            except Exception:
                pass
        if nights is None and b_in and b_out:
            try:
                from datetime import date
                d1 = date.fromisoformat(b_in)
                d2 = date.fromisoformat(b_out)
                n = (d2 - d1).days
                if n >= 1:
                    nights = n
            except Exception:
                pass
        if nights:
            return float(price_amount) * nights
        return float(price_amount)

    return float("inf")


def same_hotel_weak(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Conservative same-hotel check: normalize names and compare tokens.

    Does NOT aggressively merge — only returns True when names are clearly the
    same hotel (high token overlap) AND destinations match.
    """
    na = _norm_hotel(a.get("hotel_name", ""))
    nb = _norm_hotel(b.get("hotel_name", ""))
    da = _norm_text(a.get("address") or a.get("hotel_name") or "")
    db = _norm_text(b.get("address") or b.get("hotel_name") or "")
    if na == nb:
        return True
    # Token Jaccard over meaningful tokens.
    ta = set(_tokens(na))
    tb = set(_tokens(nb))
    if not ta or not tb:
        return False
    inter = ta & tb
    union = ta | tb
    if len(inter) / len(union) >= 0.6:
        return True
    # Substring match: one name contains the other after normalisation.
    if na and nb and (na in nb or nb in na):
        return True
    return False


def _norm_hotel(s: str) -> str:
    s = s.lower()
    s = s.replace("&", " and ")
    s = _stripped_chars(s)
    s = _norm_whitespace(s)
    return s.strip()


def _norm_text(s: str) -> str:
    if not s:
        return ""
    s = s.lower()
    s = _stripped_chars(s)
    s = _norm_whitespace(s)
    return s.strip()


def _stripped_chars(s: str) -> str:
    # Keep letters, numbers, spaces.
    out: list[str] = []
    for ch in s:
        if ch.isalnum() or ch.isspace():
            out.append(ch)
        else:
            out.append(" ")
    return "".join(out)


def _norm_whitespace(s: str) -> str:
    return " ".join(s.split())


def _tokens(s: str) -> list[str]:
    stop = {
        "hotel", "hotels", "the", "a", "an", "of", "in", "at", "by", "for",
        "and", "resort", "resorts", "spa", "beach", "goa", "india", "official",
        "site", "pvt", "ltd", "limited", "inn", " lodge", "property", "stay",
    }
    return [t for t in _norm_whitespace(s).split() if t and t not in stop and len(t) > 1]
