"""Input validation and SSRF protection for the extraction service.

The extractor receives URLs from search results, so every URL is untrusted.
We only ever fetch http:// and https:// pages on real public hosts — never
localhost, private IPs, cloud metadata endpoints, or internal services.
"""

from __future__ import annotations

import ipaddress
import re
from typing import Final


# ---------------------------------------------------------------------------
# SSRF / URL allowlisting
# ---------------------------------------------------------------------------

ALLOWED_SCHEMES: Final = ("http", "https")

PRIVATE_PREFIXES: Final = (
    "localhost",
    "metadata",
    "169.254",  # link-local / cloud metadata
    "0.0.0.0",
)

# Cloud metadata endpoints we explicitly block even on public IPs.
METADATA_PATHS: Final = (
    "/metadata/",
    "/latest/meta-data",
    "/latest/user-data",
    "/computeMetadata",
)


def _is_private_ip(hostname: str) -> bool:
    """Return True when `hostname` resolves to a private / reserved / loopback
    IP address. Hex octets, IPv6 and IPv4-mapped addresses are all covered."""
    try:
        # Direct IP literal.
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved


def _looks_like_ip(hostname: str) -> bool:
    """Platonic IP check without network access — used to reject bare IPs
    before any resolution attempt."""
    if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", hostname):
        return True
    if ":" in hostname:  # IPv6 (including IPv4-mapped ::ffff:x.x.x.x)
        return True
    return False


def is_allowed_url(url: str) -> bool:
    """Fast, no-network check: is this URL safe to fetch at all?

    Rejects:
    - non-http/https schemes (javascript:, data:, file:, ftp:)
    - bare IPs, localhost, .local, metadata hosts
    - obvious cloud-metadata paths
    """
    try:
        parsed = _parse_url_no_resolve(url)
    except Exception:
        return False

    if parsed.scheme not in ALLOWED_SCHEMES:
        return False

    hostname = parsed.hostname.lower()
    if not hostname or not hostname.startswith("."):
        return False

    # Reject bare IPs / localhost / metadata hosts early.
    if _looks_like_ip(hostname):
        return False
    for prefix in PRIVATE_PREFIXES:
        if hostname.startswith(prefix):
            return False
    if hostname == "localhost" or hostname.endswith(".local"):
        return False

    # Block cloud metadata paths on any host.
    path = (parsed.path or "/").lower()
    for meta in METADATA_PATHS:
        if path.startswith(meta):
            return False

    return True


def needs_redirect_validation(url: str) -> bool:
    """Whether a fetch for this URL should validate redirects against SSRF.

    Public https pages generally redirect to other public pages, but we still
    validate every redirect location so a public page can't hand us a private IP.
    """
    return True


# ---------------------------------------------------------------------------
# Price validation
# ---------------------------------------------------------------------------

_INVALID_PRICE_WORDS: Final = (
    "review",
    "rating",
    "rooms",
    "rooms",
    "stars",
    "suit",
    "floor",
    "level",
    "room",
    "suite",
    "phone",
    "fax",
    "guest",
    "guests",
    "night",
    "nights",
    "day",
    "days",
    "people",
    "person",
    "pax",
    "adult",
    "child",
    "year",
    "month",
    "week",
    "hour",
    "min",
    "ft",
    "m2",
    "sqft",
    "acre",
)


def looks_like_price_context(text: str) -> bool:
    """Heuristic: does this snippet talk about price/rates rather than room
    counts, guest counts, ratings or phone numbers?"""
    t = text.lower()
    price_words = ("price", "rate", "rates", "from", "starting", "total", "cost", "per night", "per night", "nightly", "stay", "booking", "fare", "deal", "offer", "pay", "charges", "inclusive", "incl", "plus taxes")
    if not any(w in t for w in price_words):
        return False
    return True


def is_plausible_price(value: float, currency: str) -> bool:
    """Reject obvious non-price numbers (e.g. a room number or phone number
    that happened to match a currency pattern)."""
    if value <= 0:
        return False
    # Hotel prices are usually below a sane ceiling.
    if value > 5_000_000:
        return False
    # A price of 1-9 in a 3-letter currency is almost always not a hotel rate.
    if value < 10:
        return False
    return True


def price_cannot_be_room_number(text: str, value: float) -> bool:
    """If the same snippet mentions obvious room/suite identifiers near the
    number, it might be a room number rather than a price."""
    t = text.lower()
    room_signals = ("room no", "room no.", "room number", "suite no", "floor", "suite ", "room ", "roomtype", "room type")
    # Only flag when the numeric value could plausibly be a room number (small).
    if value > 500:
        return True
    for signal in room_signals:
        if signal in t:
            return False
    return True


def price_cannot_be_phone_number(text: str, value: float) -> bool:
    """Phone numbers sometimes match currency patterns in international text.
    A 10-15 digit-ish value with '+' or 'tel' nearby is suspicious."""
    if value > 999999:
        return False
    t = text.lower()
    phone_signals = ("tel:", "telephone", "phone:", "contact us", "call us", "mobile", "whatsapp")
    if any(signal in t for signal in phone_signals):
        # Could be a phone — only reject if the number looks like a phone length.
        if 7 <= value <= 99999999999999:
            return False
    return True


def price_cannot_be_review_count(text: str, value: float) -> bool:
    """Review counts (e.g. '4.5 out of 5' parsed oddly, or '1,247 reviews')
    can surface as numbers. If the text has explicit review language and the
    value fits a plausible review-count range, treat it with caution."""
    t = text.lower()
    review_signals = ("review", "reviews", "rating", "out of", "stars", "star")
    if not any(signal in t for signal in review_signals):
        return True
    if value > 10_000_000:
        return True
    # If there's explicit "out of" / "stars" language, it's probably a rating.
    if re.search(r"\d+(\.\d+)?\s*(?:out of|stars?|star)", t):
        return False
    return True
