import pytest
from fastapi.testclient import TestClient

from extractor.main import app
from extractor.extractor import extract_from_page
from extractor.jsonld import extract_jsonld
from extractor.html_parser import extract_from_html, classify_price_context
from extractor.normalizer import compare_total, normalize_offer, same_hotel_weak
from extractor.schemas import ExtractBatchRequest, ExtractedHotel, PriceAmount, PriceContext, ValidateRequest
from extractor.security import fetch_page
from extractor.validators import (
    is_allowed_url,
    is_plausible_price,
    looks_like_price_context,
    price_cannot_be_phone_number,
    price_cannot_be_review_count,
    price_cannot_be_room_number,
)

from tests.fixtures import (
    HTML_FALLBACK_PAGE,
    JSONLD_PAGE,
    MALFORMED_PAGE,
    NO_PRICE_PAGE,
    NON_HOTEL_PAGE,
    PHONE_NUMBER_PAGE,
)

SOURCE_URL = "https://www.bookingdemo.example/hotel/sea-view-residency"


def test_health_endpoint_reports_ok():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True


def test_extract_rejects_private_ip_url():
    with TestClient(app) as client:
        response = client.post("/extract", json={"url": "https://169.254.169.254/latest/user-data"})
        assert response.status_code in (200, 422)
        if response.status_code == 200:
            assert response.json()["success"] is False


def test_extract_rejects_localhost_url():
    with TestClient(app) as client:
        response = client.post("/extract", json={"url": "https://localhost/x"})
        assert response.status_code in (200, 422)


def test_extract_rejects_metadata_path():
    with TestClient(app) as client:
        response = client.post("/extract", json={"url": "https://example.com/latest/meta-data/"})
        assert response.status_code in (200, 422)


def test_jsonld_extraction_extracts_hotel_and_price():
    result = extract_jsonld(JSONLD_PAGE)
    assert result.get("jsonld_found") is True
    hotel = result["primary"]
    assert hotel.get("name") == "Sea View Residency"
    assert "price" in hotel and hotel["price"].get("amount") == 4250
    assert hotel["price"].get("currency") == "INR"


def test_html_fallback_extracts_room_and_rate():
    data = extract_from_html(HTML_FALLBACK_PAGE, SOURCE_URL)
    assert data.get("hotel_name") == "Beach House Anjuna"
    assert isinstance(data.get("provider"), str)
    assert "price" in data and data["price"]["amount"] > 0


def test_html_fallback_classifies_total():
    data = extract_from_html(HTML_FALLBACK_PAGE, SOURCE_URL)
    context = data.get("price_context")
    assert context is not None
    assert context["price_type"] in ("total", "per_night")


def test_no_price_page_yields_no_price_reason():
    result = extract_from_page(
        NO_PRICE_PAGE,
        SOURCE_URL,
        check_in="2026-12-12",
        check_out="2026-12-15",
        guests=2,
        rooms=1,
    )
    assert result["proposed_hotel"] is None
    assert result["reason"] == "no_price"


def test_malformed_page_does_not_crash():
    result = extract_from_page(MALFORMED_PAGE, SOURCE_URL, check_in="2026-12-12", check_out="2026-12-15", guests=2, rooms=1)
    assert result["proposed_hotel"] is None


def test_non_hotel_page_rejected():
    result = extract_from_page(NON_HOTEL_PAGE, "https://www.foodblog.example/goa-street-food", check_in="2026-12-12", check_out="2026-12-15", guests=2, rooms=1)
    assert result["proposed_hotel"] is None


def test_phone_number_page_rejected():
    result = extract_from_page(PHONE_NUMBER_PAGE, SOURCE_URL, check_in="2026-12-12", check_out="2026-12-15", guests=2, rooms=1)
    assert result["proposed_hotel"] is None


def test_is_allowed_url_rejects_private():
    assert is_allowed_url("https://127.0.0.1/hello") is False
    assert is_allowed_url("https://localhost/x") is False
    assert is_allowed_url("https://10.0.0.2/x") is False
    assert is_allowed_url("https://example.com/metadata/") is False


def test_is_allowed_url_accepts_public():
    assert is_allowed_url("https://example.com/hotel-booking") is True
    assert is_allowed_url("http://example.com/x") is True


def test_is_allowed_url_rejects_non_http_schemes():
    for bad in ("javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/f"):
        assert is_allowed_url(bad) is False


def test_is_plausible_price_rejects_garbage():
    assert is_plausible_price(0, "INR") is False
    assert is_plausible_price(-5, "INR") is False
    assert is_plausible_price(999999999, "INR") is False


def test_price_cannot_be_phone_number_flags_tel_context():
    assert price_cannot_be_phone_number("tel:+918000000112", 8000000011) is False


def test_price_cannot_be_review_count_flags_rating():
    assert price_cannot_be_review_count("4.5 out of 5 stars", 4.5) is False


def test_price_cannot_be_room_number_flags_room_context():
    assert price_cannot_be_room_number("room number 402", 402) is False


def test_looks_like_price_context_positive_and_negative():
    assert looks_like_price_context("₹4,250 total for your stay incl taxes") is True
    assert looks_like_price_context("nice weather in Goa") is False


def test_classify_price_context_total():
    ctx = classify_price_context("₹13,600 total for 2 nights incl. taxes")
    assert ctx["price_type"] in ("total", "per_night")


def _make_offer(total: float, currency: str = "INR", hotel: str = "Grand Beach") -> ExtractedHotel:
    return ExtractedHotel(
        hotel_name=hotel,
        provider="booking.com",
        check_in="2026-12-12",
        check_out="2026-12-15",
        guests=2,
        rooms=1,
        price=PriceAmount(amount=total, currency=currency),
        price_context=PriceContext(raw="₹ total", price_type="total", nearby_hints=[]),
        booking_url="https://www.booking.com/hotel/x",
        source_url="https://www.booking.com/x",
        extracted_at="2026-10-09T00:00:00Z",
    )


def test_compare_total_prefers_smaller():
    a, b = _make_offer(8740).model_dump(), _make_offer(9000).model_dump()
    assert compare_total(a, b) < compare_total(b, a)


def test_normalize_offer_sets_defaults():
    normalized = normalize_offer(_make_offer(8740))
    assert normalized["hotel_name"] == "Grand Beach"
    assert normalized["price"]["currency"] == "INR"
    assert normalized["price_verified"] is False


def test_same_hotel_weak_matches_similar_names():
    a = _make_offer(8740, "INR", "Sea Breeze Inn Goa").model_dump()
    b = _make_offer(9000, "INR", "Sea Breeze Inn").model_dump()
    assert same_hotel_weak(a, b)


def test_same_hotel_weak_rejects_different_hotels():
    a = _make_offer(8740, "INR", "Sea Breeze Inn").model_dump()
    b = _make_offer(9000, "INR", "Mountain Lodge").model_dump()
    assert not same_hotel_weak(a, b)


def test_schemas_roundtrip():
    req = ExtractBatchRequest(
        urls=["https://www.booking.com/hotel/x"],
        check_in="2026-12-12",
        check_out="2026-12-15",
        guests=2,
        rooms=1,
        timeout_seconds=15,
    )
    assert req.guests == 2
    ValidateRequest(url="https://example.com")


def test_fetch_page_rejects_unsafe_url_without_network():
    res = fetch_page("https://localhost/secret", timeout_seconds=2)
    assert res.ok is False
    assert res.reason in ("blocked_url", "blocked_ip")


def test_fetch_page_rejects_metadata_ip_without_network():
    res = fetch_page("https://169.254.169.254/latest/meta-data/", timeout_seconds=2)
    assert res.ok is False


def test_fetch_page_timeout_on_slow_public_host():
    res = fetch_page("https://example.invalid/nothing-here", timeout_seconds=3)
    assert res.ok is False
    assert res.reason in ("connect_failed", "dns_failed", "timeout")
