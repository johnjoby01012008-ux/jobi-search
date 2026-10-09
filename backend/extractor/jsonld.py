"""JSON-LD extraction from <script type="application/ld+json"> blocks.

Primary extraction path: if a page ships structured data, this is where we read
hotel / room / price / availability info from it.

Supports:
- single JSON objects
- JSON arrays
- @graph collections
- nested objects and @type edges
- GraphObject references (via @id / @type arrays)
"""

from __future__ import annotations

import json
import re
from typing import Any, Generator
from xml.etree import ElementTree as ET

from .validators import is_plausible_price


class JsonLdNode:
    __slots__ = ("obj", "path", "types")

    def __init__(self, obj: dict[str, Any], path: str = "$", types: tuple[str, ...] = ()) -> None:
        self.obj = obj
        self.path = path
        self.types = types

    def get(self, key: str, default: Any = None) -> Any:
        return self.obj.get(key, default)


def _extract_script_ldjson(html: str) -> list[str]:
    """Return the raw JSON strings from every <script type="application/ld+json"> block."""
    out: list[str] = []
    # Fast regex over the raw HTML; ElementTree parsing is slower and not
    # necessary when we only care about script tags of one type.
    for m in re.finditer(
        r"<script\b[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        html,
        re.IGNORECASE | re.DOTALL,
    ):
        payload = m.group(1).strip()
        if not payload:
            continue
        out.append(payload)
    return out


def _iter_graph_nodes(root: Any) -> Generator[Any, None, None]:
    """Walk a JSON-LD structure and yield every object we should inspect.

    Handles:
    - top-level arrays
    - top-level single objects
    - @graph arrays
    - nested nodes (dict values, list entries)
    """
    stack: list[Any] = [root]

    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            yield node
            for value in node.values():
                if isinstance(value, dict):
                    stack.append(value)
                elif isinstance(value, list):
                    stack.extend(value)
        elif isinstance(node, list):
            stack.extend(node)


def _type_of(node: dict[str, Any]) -> tuple[str, ...]:
    t = node.get("@type")
    if isinstance(t, str):
        return (t,)
    if isinstance(t, list) and t:
        return tuple(str(x) for x in t if isinstance(x, str))
    return ()


def _is_hotel_like(node: dict[str, Any]) -> bool:
    types = _type_of(node)
    hotel_types = {"Hotel", "LodgingBusiness", "HotelRoom", "Product", "Place", "LocalBusiness"}
    if not types:
        return False
    return bool(hotel_types & set(types))


def _pick_price_from_offers(node: dict[str, Any]) -> dict[str, Any] | None:
    """Try to pull a price from Offer / AggregateOffer / PriceSpecification shapes."""
    # AggregateOffer: lowPrice / highPrice / priceCurrency
    agg = node.get("aggregateOffer")
    if isinstance(agg, dict):
        for key in ("lowPrice", "price", "highPrice"):
            v = agg.get(key)
            if v is not None and isinstance(v, (int, float)) and v > 0:
                cur = agg.get("priceCurrency") or node.get("priceCurrency") or "INR"
                return {"amount": float(v), "currency": _norm_currency(cur)}

    # Direct Offer / Offer-like: price + priceCurrency
    for key in ("offer", "offers", "price", "priceSpecification", "eligibleTransactionVolume"):
        child = node.get(key)
        if isinstance(child, dict):
            price = child.get("price") if key in ("offer", "offers", "price") else None
            if price is None and isinstance(child.get("price"), (int, float)):
                price = child["price"]
            if price is not None and isinstance(price, (int, float)) and price > 0:
                cur = child.get("priceCurrency") or node.get("priceCurrency") or "INR"
                return {"amount": float(price), "currency": _norm_currency(cur)}
            # Nested: { "@type": "Offer", "price": ... }
            if isinstance(child.get("price"), dict):
                p = child["price"].get("price")
                if p is not None and isinstance(p, (int, float)):
                    cur = child["price"].get("priceCurrency") or node.get("priceCurrency") or "INR"
                    return {"amount": float(p), "currency": _norm_currency(cur)}

    # List of offers
    offers = node.get("offers")
    if isinstance(offers, list):
        for off in offers:
            if isinstance(off, dict):
                p = off.get("price")
                if p is not None and isinstance(p, (int, float)) and p > 0:
                    cur = off.get("priceCurrency") or node.get("priceCurrency") or "INR"
                    return {"amount": float(p), "currency": _norm_currency(cur)}


def _norm_currency(code: Any) -> str:
    if not isinstance(code, str):
        return "INR"
    upper = code.upper().strip()
    # Normalise common aliases.
    alias = {"USD": "USD", "US$": "USD", "$": "USD", "EUR": "EUR", "€": "EUR",
             "GBP": "GBP", "£": "GBP", "INR": "INR", "Rs.": "INR", "₹": "INR",
             "AUD": "AUD", "CAD": "CAD", "SGD": "SGD", "AED": "AED"}
    return alias.get(upper, upper if len(upper) == 3 else "INR")


def _pick_hotel_name(node: dict[str, Any]) -> str | None:
    for key in ("name", "title", "hotelName", "description"):
        v = node.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _pick_address(node: dict[str, Any]) -> str | None:
    address = node.get("address")
    if isinstance(address, str) and address.strip():
        return address.strip()
    if isinstance(address, dict):
        parts: list[str] = []
        for key in ("streetAddress", "addressLocality", "addressRegion", "addressCountry", "postalCode"):
            v = address.get(key)
            if isinstance(v, str) and v.strip():
                parts.append(v.strip())
        if parts:
            return ", ".join(parts)
    return None


def _pick_rating(node: dict[str, Any]) -> float | None:
    # Schema.org review aggregate
    aggregate = node.get("aggregateRating")
    if isinstance(aggregate, dict):
        rating = aggregate.get("ratingValue")
        if isinstance(rating, (int, float)):
            if 0 <= rating <= 5:
                return float(rating)
    # Direct ratingValue on node
    rv = node.get("ratingValue")
    if isinstance(rv, (int, float)) and 0 <= rv <= 5:
        return float(rv)
    return None


def _pick_description(node: dict[str, Any]) -> str | None:
    for key in ("description", "summary", "comment"):
        v = node.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _pick_amenities(node: dict[str, Any]) -> list[str]:
    amen = node.get("amenityFeature")
    out: list[str] = []
    if isinstance(amen, dict):
        v = amen.get("name")
        if isinstance(v, str):
            out.append(v.strip())
    elif isinstance(amen, list):
        for item in amen:
            if isinstance(item, dict):
                v = item.get("name")
                if isinstance(v, str):
                    out.append(v.strip())
            elif isinstance(item, str):
                out.append(item.strip())
    return out


def _pick_availability(node: dict[str, Any]) -> str | None:
    # Schema.org Offer / AggregateOffer may carry offers / availability.
    for key in ("availability", "offers"):
        v = node.get(key)
        if isinstance(v, str) and v:
            if "available" in v.lower() or "instock" in v.lower():
                return "available"
            if "discontinued" in v.lower() or "outofstock" in v.lower():
                return "unavailable"
    return None


def extract_jsonld(html: str, *, expected_currency: str = "INR") -> dict[str, Any]:
    """Extract everything useful from JSON-LD on the page.

    Returns a dict with the keys the normalizer wants. Missing keys are just
    absent — we never fabricate values.
    """
    script_payloads = _extract_script_ldjson(html)
    if not script_payloads:
        return {"jsonld_found": False}

    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    for payload in script_payloads:
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue

        best_hotel: dict[str, Any] = {}
        best_price: dict[str, Any] | None = None
        best_name: str | None = None
        best_address: str | None = None
        best_rating: float | None = None
        best_description: str | None = None
        best_amenities: list[str] = []
        best_availability: str | None = None

        for node in _iter_graph_nodes(obj):
            if not isinstance(node, dict):
                continue

            types = _type_of(node)

            # Hotel / lodging business: name, address, rating, description, amenities.
            if _is_hotel_like(node) and ("Hotel" in types or "LodgingBusiness" in types):
                name = _pick_hotel_name(node)
                if name and not best_name:
                    best_name = name
                addr = _pick_address(node)
                if addr and not best_address:
                    best_address = addr
                rating = _pick_rating(node)
                if rating and best_rating is None:
                    best_rating = rating
                desc = _pick_description(node)
                if desc and not best_description:
                    best_description = desc
                amens = _pick_amenities(node)
                if amens:
                    best_amenities.extend(amens)
                avail = _pick_availability(node)
                if avail and not best_availability:
                    best_availability = avail

                # AggregateOffer / Offer on the hotel node.
                price = _pick_price_from_offers(node)
                if price:
                    best_price = price

            # HotelRoom / Product / Offer: room name + price.
            if ("HotelRoom" in types or "Product" in types or "Offer" in types):
                room_name = _pick_hotel_name(node)
                if room_name and not best_name:
                    best_name = room_name
                price = _pick_price_from_offers(node)
                if price and not best_price:
                    best_price = price

            # Generic product-level price for Product nodes without hotel type.
            if "Product" in types and not best_price:
                price = _pick_price_from_offers(node)
                if price:
                    best_price = price

        if best_name:
            candidates.append({
                "name": best_name,
                "address": best_address,
                "rating": best_rating,
                "description": best_description,
                "amenities": best_amenities,
                "availability": best_availability,
                "price": best_price,
            })

    if not candidates:
        return {"jsonld_found": True, "candidates": []}

    # Pick the candidate with the most complete pricing info.
    def completeness(c: dict[str, Any]) -> int:
        score = 0
        if c.get("price"):
            score += 3
        if c.get("address"):
            score += 1
        if c.get("rating") is not None:
            score += 1
        if c.get("description"):
            score += 1
        return score

    candidates.sort(key=completeness, reverse=True)
    primary = candidates[0]

    return {
        "jsonld_found": True,
        "candidates": candidates,
        "primary": {
            "name": primary.get("name"),
            "address": primary.get("address"),
            "rating": primary.get("rating"),
            "description": primary.get("description"),
            "amenities": primary.get("amenities", []),
            "availability": primary.get("availability"),
            "price": primary.get("price"),  # {"amount": float, "currency": str} | None
        },
    }
