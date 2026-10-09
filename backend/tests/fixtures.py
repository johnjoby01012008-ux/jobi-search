"""Reusable local HTML fixtures for extractor tests — no live websites."""

from __future__ import annotations

JSONLD_PAGE = """
<!DOCTYPE html>
<html>
<head><title>Sea View Residency — Official Site</title></head>
<body>
<h1>Sea View Residency</h1>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Hotel",
  "name": "Sea View Residency",
  "address": {"@type": "PostalAddress", "addressLocality": "Calangute, Goa"},
  "aggregateRating": {"@type": "AggregateRating", "ratingValue": 4.4, "reviewCount": 231},
  "amenityFeature": [{"name": "Free WiFi"}, {"name": "Pool"}],
  "makesOffer": {
    "@type": "Offer",
    "price": 4250,
    "priceCurrency": "INR",
    "availability": "https://schema.org/InStock"
  }
}
</script>
<p>Rooms from ₹4,250 total for your stay.</p>
</body>
</html>
"""

HTML_FALLBACK_PAGE = """
<html>
<head><title>Beach House Anjuna | HotelBookingDemo</title></head>
<body>
<div class="hotel-header"><h1>Beach House Anjuna</h1>
<span class="address">Anjuna, North Goa, India</span></div>
<div class="offer">
  <span class="room">Deluxe Sea View Room</span>
  <span class="rate">₹6,800 per night</span>
  <span>Total for 2 nights ₹13,600 incl. taxes</span>
  <span>Breakfast included. Free cancellation.</span>
  <span>4.2 out of 5 (312 reviews)</span>
</div>
</body>
</html>
"""

NO_PRICE_PAGE = """
<html><head><title>Mountain Lodge Manali</title></head>
<body><h1>Mountain Lodge Manali</h1>
<p>Beautiful lodge with panoramic Himalayan views. Call us for rates.</p>
</body></html>
"""

MALFORMED_PAGE = """<html><head><title>Broken</title><script>function { broken js
<body <p unclosed tag </html> <div class=price ₹garbage"""

PHONE_NUMBER_PAGE = """
<html><head><title>City Plaza Hotel</title></head>
<body><h1>City Plaza Hotel</h1>
<p>Contact us: tel:+918000000112</p>
<p>Room 402 , Deluxe.</p>
</body></html>
"""

NON_HOTEL_PAGE = """
<html><head><title>Best street food in Goa</title></head>
<body><h1>Best street food in Goa</h1>
<p>From ₹150 you can eat well here. Great deals!</p>
</body></html>
"""


def fixture(name: str) -> str:
    """Load an HTML file from tests/fixtures by filename."""
    import conftest  # noqa: F401 — already imported by pytest
    path = conftest.FIXTURES_DIR / name
    return path.read_text(encoding="utf-8")
