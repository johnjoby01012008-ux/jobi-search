"""Shared extraction schemas — both the FastAPI service and the Convex backend
import these shapes (via the vendored copy in src/convex/jobi/extraction/types.ts)
so the HTTP contract is explicit and type-checked on both sides."""

from __future__ import annotations

from pydantic import BaseModel, Field, HttpUrl
from typing import Any


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ExtractRequest(BaseModel):
    url: HttpUrl
    """The page to extract. Must be an https:// public URL; SSRF protection is
    enforced server-side before any fetch happens."""

    timeout_seconds: int = Field(default=15, ge=5, le=60)
    """Per-request fetch timeout. Playwright falls back only when normal HTTP
    extraction fails to produce usable content."""


class ValidateRequest(BaseModel):
    url: HttpUrl


# ---------------------------------------------------------------------------
# Extraction result schemas
# ---------------------------------------------------------------------------

class PriceAmount(BaseModel):
    amount: float = Field(..., gt=0, le=10_000_000)
    currency: str = Field(..., min_length=3, max_length=3)


class PriceContext(BaseModel):
    raw: str = Field(..., min_length=1, max_length=200)
    price_type: str = Field(..., pattern=r"^(total|starting_from|per_night|nightly|unknown)$")
    nearby_hints: list[str] = Field(default_factory=list)


class ExtractedHotel(BaseModel):
    hotel_name: str = Field(..., min_length=2, max_length=200)
    provider: str = Field(..., min_length=1, max_length=120)
    room_name: str | None = Field(default=None, max_length=120)

    check_in: str  # YYYY-MM-DD
    check_out: str  # YYYY-MM-DD
    guests: int = Field(..., ge=1, le=20)
    rooms: int = Field(..., ge=1, le=10)

    price: PriceAmount
    price_context: PriceContext

    taxes: float | None = Field(default=None, ge=0, le=1_000_000)
    total_price: float | None = Field(default=None, gt=0, le=10_000_000)
    breakfast_included: bool | None = None
    free_cancellation: bool | None = None
    cancellation_text: str | None = Field(default=None, max_length=300)
    availability: str | None = Field(default=None, pattern=r"^(available|limited|unavailable|unknown)$")

    booking_url: HttpUrl
    source_url: HttpUrl

    price_verified: bool = Field(default=False, description="True only when price was extracted from structured/JSON-LD data with supporting context.")
    confidence: str = Field(default="low", pattern=r"^(high|medium|low)$")

    rating: float | None = Field(default=None, ge=0, le=5)
    address: str | None = Field(default=None, max_length=300)
    amenities: list[str] = Field(default_factory=list, max_length=50)
    description: str | None = Field(default=None, max_length=1000)

    extracted_at: str  # ISO timestamp


class ExtractionResult(BaseModel):
    success: bool
    hotel: ExtractedHotel | None = None
    reason: str | None = None  # fetch_failed | access_blocked | parse_failed | invalid_price | no_hotel_data | no_price | unsupported_page
    observed_prices: list[PriceAmount] = Field(default_factory=list)
    jsonld_found: bool = False
    playwright_used: bool = False
    notes: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Batch / search session schemas
# ---------------------------------------------------------------------------

class ExtractBatchRequest(BaseModel):
    urls: list[HttpUrl] = Field(..., min_length=1, max_length=50)
    check_in: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    check_out: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    guests: int = Field(default=2, ge=1, le=20)
    rooms: int = Field(default=1, ge=1, le=10)
    timeout_seconds: int = Field(default=15, ge=5, le=60)


class ExtractBatchResult(BaseModel):
    successful: list[ExtractionResult] = Field(default_factory=list)
    failed: list[dict[str, Any]] = Field(
        default_factory=list,
        description="[{ url, reason, status? }] for pages that could not be extracted",
    )
    elapsed_seconds: float = Field(default=0.0)
