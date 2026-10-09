"""BeautifulSoup + lxml HTML fallback extraction.

Used when JSON-LD does not tell us enough. We deliberately avoid hardcoding one
site's CSS selectors; instead we look for recurring structural patterns
(headings, table rows, labels near prices) and for price-like tokens with
nearby context.

All extracted values are treated as untrusted text until a price has both a
currency marker AND context that indicates it is a hotel rate.
"""

from __future__ import annotations

import re
from typing import Any, Final
from urllib.parse import urlparse

from bs4 import BeautifulSoup, NavigableString, Tag

from .validators import (
    is_plausible_price,
    looks_like_price_context,
    price_cannot_be_phone_number,
    price_cannot_be_review_count,
    price_cannot_be_room_number,
)


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

WHITESPACE_NORMALISE: Final = re.compile(r"\s+")


def _norm_text(s: str) -> str:
    return WHITESPACE_NORMALISE.sub(" ", s).strip()


def _strip_tags(node) -> str:
    if isinstance(node, NavigableString):
        return _norm_text(str(node))
    return _norm_text(node.get_text(" ", strip=True))


# ---------------------------------------------------------------------------
# Price + currency extraction from text
# ---------------------------------------------------------------------------

# Common currency markers we accept. The extractor must see ONE of these
# next to a number before it will call the number a price.
CURRENCY_MARKERS: Final = re.compile(
    r"("
    r"₹|"
    r"rs\.?|"
    r"inr|"
    r"\$|"
    r"us\$|"
    r"usd|"
    r"€|"
    r"eur|"
    r"£|"
    r"gbp|"
    r"sgd|"
    r"aed|"
    r"د\.إ|"
    r"Rp\.?|"
    r"円|"
    r"¥|"
    r"AU\$|"
    r"CA\$|"
    r"HK\$|"
    r"NZ\$|"
    r"R\$|"
    r"R|"
    r"₩|"
    r"¥|"
    r")"
    r"\s*"
    r"([\d,]+(?:\s?\d{3})*(?:\.\d+)?)"
    r"",
    re.IGNORECASE,
)

# Plain number-with-commas that may need a nearby currency word (INR, Rs., etc.).
PLAIN_PRICE_WITH_COMMA: Final = re.compile(r"([\d,]{4,}(?:\.\d+)?)")


def _extract_prices_from_text(text: str) -> list[dict[str, Any]]:
    """Return every candidate (amount, currency) pair found in `text`.

    We deliberately require a currency marker or a strong nearby currency word;
    bare numbers are ignored so that '2 guests' / '3 nights' are never mistaken
    for a rate.
    """
    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    for m in CURRENCY_MARKERS.finditer(text):
        marker = m.group(1).strip().lower()
        raw = m.group(2).replace(",", "").strip()
        try:
            amount = float(raw)
        except ValueError:
            continue
        currency = _currency_from_marker(marker)
        if currency and is_plausible_price(amount, currency):
            key = f"{amount:.2f}|{currency}"
            if key not in seen:
                seen.add(key)
                results.append({"amount": amount, "currency": currency, "raw": raw})
    return results


def _currency_from_marker(marker: str) -> str | None:
    m = marker.lower().replace("usd", "usd").replace("us$", "usd").replace("$", "usd")
    m = m.replace("eur", "eur").replace("€", "eur").replace("gbp", "gbp").replace("£", "gbp")
    m = m.replace("inr", "inr").replace("rs.", "inr").replace("₹", "inr")
    m = m.replace("sgd", "sgd").replace("aed", "aed").replace("د.إ", "aed")
    m = m.replace("aud", "aud").replace("cad", "cad").replace("nzd", "nzd").replace("hkd", "hkd")
    m = m.replace("r$", "brl").replace("r", "brl")
    m = m.replace("₩", "krw").replace("¥", "jpy")
    mapping: dict[str, str] = {
        "usd": "USD", "eur": "EUR", "gbp": "GBP", "inr": "INR",
        "sgd": "SGD", "aed": "AED", "aud": "AUD", "cad": "CAD",
        "nzd": "NZD", "hkd": "HKD", "brl": "BRL", "krw": "KRW",
        "jpy": "JPY",
    }
    return mapping.get(m)


def _price_near_context(node, text: str, amount: float, currency: str) -> dict[str, Any] | None:
    """Evaluate whether this number is likely a hotel rate using nearby text."""
    if not is_plausible_price(amount, currency):
        return None
    if not looks_like_price_context(text):
        return None
    if not price_cannot_be_phone_number(text, amount):
        return None
    if not price_cannot_be_review_count(text, amount):
        return None
    if not price_cannot_be_room_number(text, amount):
        return None
    return {"amount": amount, "currency": currency}


# ---------------------------------------------------------------------------
# Price context classification
# ---------------------------------------------------------------------------

PRICE_TYPE_PATTERNS: Final = {
    "total": re.compile(
        r"\b(total|inclusive|all-in|grand total|final price|pay\s*\w*|checkout\s*price|pay at hotel|amount due|amount payable|room rate per stay|stay\s*price)\b",
        re.IGNORECASE,
    ),
    "per_night": re.compile(
        r"\b(per\s*night|nightly|each\s*night|a\s*night|per\s*room\s*night|nightly\s*rate|per\s*night\s*rate)\b",
        re.IGNORECASE,
    ),
    "starting_from": re.compile(
        r"\b(from|starting\s*at|from\s*as\s*low\s*as|as\s*low\s*as|from\s*only|rates\s*from|starting\s*price|minimum\s*price|book\s*from)\b",
        re.IGNORECASE,
    ),
}


def classify_price_context(text: str) -> dict[str, Any]:
    """Given snippet text containing a price, classify its context."""
    hints: list[str] = []
    price_type = "unknown"

    for label, pattern in PRICE_TYPE_PATTERNS.items():
        if pattern.search(text):
            if label not in hints:
                hints.append(label)
            if label == "total":
                price_type = "total"
            elif label == "per_night" and price_type == "unknown":
                price_type = "per_night"

    if price_type == "unknown":
        # Default when a price is found but no explicit type marker:
        # assume total if the text mentions "total", "stay", or "for [N] nights".
        if re.search(r"\b(for|over|during|your|this|the)\s+\d+\s+night", text, re.IGNORECASE):
            price_type = "total"
        elif re.search(r"\bstay|browse\s*offers|book\s*now|check\s*availability", text, re.IGNORECASE):
            price_type = "total"

    return {"raw": _norm_text(text)[:200], "price_type": price_type, "nearby_hints": hints}


# ---------------------------------------------------------------------------
# Hotel name detection
# ---------------------------------------------------------------------------

# Heuristic: the page's <title>, first <h1>, first <h2>, og:title, and
# twitter:title are all reasonable hotel-name candidates.
def _candidate_hotel_names(soup: BeautifulSoup, url_domain: str) -> list[str]:
    names: list[str] = []

    # <title>
    title_tag = soup.find("title")
    if title_tag:
        t = _strip_tags(title_tag)
        if t:
            names.append(t)

    # og:title
    og = soup.find("meta", property="og:title") or soup.find("meta", attrs={"name": "og:title"})
    if og and og.get("content"):
        names.append(_norm_text(og["content"]))

    # twitter:title
    tw = soup.find("meta", attrs={"name": "twitter:title"})
    if tw and tw.get("content"):
        names.append(_norm_text(tw["content"]))

    # First meaningful h1 / h2
    for tag_name in ("h1", "h2"):
        h = soup.find(tag_name)
        if h:
            t = _strip_tags(h)
            if t and len(t) > 3:
                names.append(t)
                break

    # Schema-ish: JSON-LD already handled upstream; skip.
    return names


def _choose_hotel_name(candidates: list[str], url_domain: str) -> str | None:
    """Pick the most plausible hotel name from candidates."""
    if not candidates:
        return None
    # Prefer shorter, title-case strings that aren't obviously navigation / SEO noise.
    prefer: list[str] = []
    reject_words = {"book now", "check availability", "welcome", "my account", "login",
                    "sign in", "search results", "hotels in", "result", "page", "home",
                    "search", "contact", "sitemap", "privacy", "terms", "error", "404"}
    for c in candidates:
        low = c.lower()
        if any(w in low for w in reject_words):
            continue
        if len(c) < 8:
            continue
        prefer.append(c)
    if prefer:
        # Shortest reasonable name is often the hotel name.
        prefer.sort(key=len)
        return prefer[0]
    # Fallback to the shortest non-trivial candidate.
    candidates.sort(key=len)
    for c in candidates:
        if len(c) >= 6:
            return c
    return None


# ---------------------------------------------------------------------------
# Provider name detection
# ---------------------------------------------------------------------------

PROVIDER_SIGNALS: Final = {
    "booking.com": "Booking.com",
    "agoda.com": "Agoda",
    "makemytrip.com": "MakeMyTrip",
    "goibibo.com": "Goibibo",
    "cleartrip.com": "Cleartrip",
    "yatra.com": "Yatra",
    "expedia.com": "Expedia",
    "expedia.co.in": "Expedia",
    "hotels.com": "Hotels.com",
    "trip.com": "Trip.com",
    "trivago.com": "Trivago",
    "trivago.co.in": "Trivago",
    "oyorooms.com": "OYO",
    "treebo.com": "Treebo",
    "fabhotels.com": "FabHotels",
    "evenbrite": "Eventbrite",
    "airbnb.com": "Airbnb",
    "bookingedge": "Booking.com",
}


def _provider_from_domain(url: str) -> str | None:
    try:
        domain = urlparse(url).hostname.lower().replace("www.", "")
    except Exception:
        return None
    for signal, name in PROVIDER_SIGNALS.items():
        if signal in domain:
            return name
    return None


# ---------------------------------------------------------------------------
# Price-as-total inference
# ---------------------------------------------------------------------------

def _infer_total_price(price: dict[str, Any], text: str) -> dict[str, Any] | None:
    """Given a price that appears to be a real rate, decide whether it is most
    likely the total for the stay or a per-night figure."""
    if price["price_type"] == "total":
        return price
    if price["price_type"] == "per_night":
        return price  # caller will compute total if it has nights
    # Default heuristic: if the text mentions a multi-night stay, prefer total.
    nights = _count_nights(text)
    if nights and nights > 1:
        return {**price, "price_type": "total"}
    return price


def _count_nights(text: str) -> int | None:
    m = re.search(r"(\d{1,2})\s*nights?", text, re.IGNORECASE)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 30:
            return v
    return None


# ---------------------------------------------------------------------------
# HTML extraction entry point
# ---------------------------------------------------------------------------

def extract_from_html(html: str, source_url: str) -> dict[str, Any]:
    """Run the HTML fallback extraction and return whatever we found.

    Returns a dict with:
    - hotel_name
    - provider
    - room_name
    - price / currency / price_context
    - rating
    - address
    - amenities
    - description
    - breakfast_included
    - free_cancellation / cancellation_text
    - availability
    """
    soup = BeautifulSoup(html, "lxml")

    url_domain = urlparse(source_url).hostname.lower().replace("www.", "")
    provider = _provider_from_domain(source_url)

    candidates = _candidate_hotel_names(soup, url_domain)
    hotel_name = _choose_hotel_name(candidates, url_domain)

    # Full-page text for price scanning (but limit size so lxml parse stays cheap).
    page_text = soup.get_text(" ", strip=True)
    if len(page_text) > 200_000:
        page_text = page_text[:200_000]

    all_prices = _extract_prices_from_text(page_text)
    price_context = None
    chosen_price = None

    # Prefer prices in sections that look like booking / pricing UI.
    pricing_sections = soup.find_all(
        ["div", "section", "article", "li", "p", "span", "td", "tr"],
        class_=re.compile(r"(price|rate|offer|booking|room|stay|checkout|total|summary|booking-summary)", re.IGNORECASE),
    )
    for section in pricing_sections[:20]:
        section_text = _strip_tags(section)
        candidates_in_section = _extract_prices_from_text(section_text)
        for cp in candidates_in_section:
            ctx = _price_near_context(section, section_text, cp["amount"], cp["currency"])
            if ctx:
                price_context = classify_price_context(section_text)
                if not chosen_price or _better_price(chosen_price, ctx):
                    chosen_price = ctx
                    price_context = price_context

    # Fallback: scan the whole page if sections didn't yield.
    if not chosen_price:
        for cp in all_prices:
            ctx = _price_near_context(page_text, page_text, cp["amount"], cp["currency"])
            if ctx:
                chosen_price = ctx
                price_context = classify_price_context(page_text)
                break

    # Rating
    rating = _extract_rating(soup, page_text)

    # Address
    address = _extract_address(soup, page_text)

    # Amenities
    amenities = _extract_amenities(soup, page_text)

    # Room name
    room_name = _extract_room_name(soup, page_text)

    # Meal plan / cancellation
    breakfast_included = _detect_breakfast(soup, page_text)
    cancellation_text, free_cancellation = _detect_cancellation(soup, page_text)

    # Availability
    availability = _detect_availability(soup, page_text)

    return {
        "hotel_name": hotel_name,
        "provider": provider or "",
        "room_name": room_name,
        "price": chosen_price,  # {"amount": float, "currency": str, "price_type": str} | None
        "price_context": price_context,  # {"raw": str, "price_type": str, "nearby_hints": [str]} | None
        "rating": rating,
        "address": address,
        "amenities": amenities,
        "room_name_candidates": [],
        "breakfast_included": breakfast_included,
        "cancellation_text": cancellation_text,
        "free_cancellation": free_cancellation,
        "availability": availability,
        "page_text_length": len(page_text),
    }


def _better_price(existing: dict[str, Any] | None, candidate: dict[str, Any]) -> bool:
    """Prefer a total / per-night price over a starting_from price of the same magnitude."""
    if existing is None:
        return True
    if existing["price_type"] == "total" and candidate["price_type"] != "total":
        return False
    if candidate["price_type"] == "total" and existing["price_type"] != "total":
        return True
    return abs(candidate["amount"] - existing["amount"]) > 0.01


def _extract_rating(soup: BeautifulSoup, text: str) -> float | None:
    # Star-based rating from visible star markup or text.
    star_matches = re.findall(r"(\d(?:\.\d)?)\s*(?:star|stars|out of\s*5|out of 5|/5|/10)", text)
    for s in star_matches:
        v = float(s)
        if 0 < v <= 5:
            return v
    # AggregateRating JSON-LD is handled upstream, but a visible aggregateRating
    # block in HTML also works.
    agg = soup.find("div", id=re.compile(r"aggregate|review-summary|rating", re.IGNORECASE))
    if agg:
        t = _strip_tags(agg)
        m = re.search(r"(\d(?:\.\d)?)\s*(?:out of|average|/)", t)
        if m:
            v = float(m.group(1))
            if 0 < v <= 5:
                return v
    return None


def _extract_address(soup: BeautifulSoup, text: str) -> str | None:
    # Look for address microformat or a paragraph that looks like an address.
    addr_tag = soup.find("address")
    if addr_tag:
        t = _strip_tags(addr_tag)
        if t and len(t) < 200:
            return t

    # Schema org address block
    addr_div = soup.find("div", attrs={"itemprop": "address"}) or soup.find(
        "span", attrs={"itemprop": "addressLocality"}
    )
    if addr_div:
        t = _strip_tags(addr_div)
        if t:
            return t

    # Any line that looks like a postal address (number, street, city, pincode).
    m = re.search(
        r"(\d{1,6}\s+[A-Z][a-zA-Z0-9\s,.'-]+(?:st(?:reet)?|avenue|road|lane|circle|boulevard|drive|court|place|way|square|singh)?,?\s*[A-Z][a-zA-Z\s-]+,\s*[A-Z]{2,4}\s*\d{5,6})",
        text,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).strip()
    return None


def _extract_amenities(soup: BeautifulSoup, text: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for tag in soup.find_all(["li", "span", "div"], class_=re.compile(r"(amenit|feature|facility|service)", re.IGNORECASE)):
        t = _strip_tags(tag)
        if t and len(t) < 80 and not t.lower().startswith(("book", "check", "view", "more")):
            low = t.lower()
            if low not in seen and len(t) > 2:
                seen.add(low)
                out.append(t)
                if len(out) >= 12:
                    break

    # Fallback: keywords from a common amenities list.
    known = ["wifi", "free wifi", "parking", "restaurant", "breakfast", "pool", "gym", "spa", "air conditioning",
             "ac", "laundry", "reception", "concierge", "room service", "bar", "coffee shop", "pet friendly",
             "family room", "non-smoking", "outdoor pool"]
    for k in known:
        if re.search(rf"\b{re.escape(k)}", text, re.IGNORECASE) and k not in seen:
            seen.add(k)
            out.append(k)
    return out[:12]


def _extract_room_name(soup: BeautifulSoup, text: str) -> str | None:
    # Room type often appears near the price or in a heading like "Deluxe Room".
    m = re.search(r"((?:deluxe|premium|executive|suite|superior|standard|classic|garden|sea view|ocean view|pool|king|queen|double|twin|single|family|studio|apartment|linen|club|grand|presidential|penthouse|beachfront|infinity|heritage|royalty|premier)\s*(?:room|suite|king|queen|double|twin|single|studio|apartment|villa|chalet))",
                  text, re.IGNORECASE)
    if m:
        return _norm_text(m.group(1))
    # Heading near price
    for tag in soup.find_all(["h2", "h3", "h4", "span", "div", "p"], class_=re.compile(r"(room|type|select-room|room-type)", re.IGNORECASE)):
        t = _strip_tags(tag)
        if t and 3 < len(t) < 60:
            return t
    return None


def _detect_breakfast(soup: BeautifulSoup, text: str) -> bool | None:
    # Only return True when breakfast is explicitly mentioned as included.
    if re.search(r"breakfast\s+(included|provided|served|buffet|complimentary|free|on\s*us)", text, re.IGNORECASE):
        return True
    if re.search(r"(included|complimentary|free|served)\s+breakfast", text, re.IGNORECASE):
        return True
    return None


def _detect_cancellation(soup: BeautifulSoup, text: str) -> tuple[str | None, bool | None]:
    cancellation_text = None
    free_cancellation = None

    m = re.search(r"(free\s+)?(cancellation|cancel|book\s*without\s*payment|pay\s*at\s*hotel)?\s*(?:until|up\s*to|within|before|until\s*|prior\s*to)?\s*(\d{1,2}\s*(?:hours?|hours|hours|days?|nights?|weeks?))?", text, re.IGNORECASE)
    if m:
        snippet = m.group(0).strip()
        if len(snippet) < 120:
            cancellation_text = snippet

    if re.search(r"free\s*cancellation|cancel\s*for\s*free|free\s+취소|免费退房", text, re.IGNORECASE):
        free_cancellation = True
    elif re.search(r"non-refundable|nonrefundable|no\s*cancellation| nonrefundable| cancel\s*fees|deposit\s*non\s*refundable", text, re.IGNORECASE):
        free_cancellation = False

    return cancellation_text, free_cancellation


def _detect_availability(soup: BeautifulSoup, text: str) -> str | None:
    t = text.lower()
    if re.search(r"not available|unavailable|sold\s*out|fully\s*booked|no\s*availability|booking\s*closed|closed\s*for\s*bookings", t):
        return "unavailable"
    if re.search(r"available|book\s*now|check\s*availability|select\s*dates|limited\s*availability|few\s*rooms\s*left", t):
        return "available"
    return None
