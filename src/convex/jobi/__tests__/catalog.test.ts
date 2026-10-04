import { describe, expect, it } from "vitest";
import { CATALOG_DESTINATIONS, HOTEL_CATALOG } from "../catalogData";

describe("property catalog", () => {
  it("uses unique, URL-safe slugs", () => {
    const slugs = HOTEL_CATALOG.map((hotel) => hotel.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("prices every property from its cheapest room", () => {
    for (const hotel of HOTEL_CATALOG) {
      expect(hotel.rooms.length).toBeGreaterThan(0);
      const lowest = Math.min(...hotel.rooms.map((room) => room.nightlyRate));
      expect(hotel.priceFrom).toBe(lowest);
      for (const room of hotel.rooms) {
        expect(room.nightlyRate).toBeGreaterThan(0);
      }
    }
  });

  it("provides the content every listing needs to render", () => {
    for (const hotel of HOTEL_CATALOG) {
      expect(hotel.name.trim().length).toBeGreaterThan(2);
      expect(hotel.destination.trim().length).toBeGreaterThan(1);
      expect(hotel.description.length).toBeGreaterThan(60);
      expect(hotel.amenities.length).toBeGreaterThan(2);
      expect(hotel.rating).toBeGreaterThanOrEqual(1);
      expect(hotel.rating).toBeLessThanOrEqual(5);
      expect(hotel.imageUrl.startsWith("https://")).toBe(true);
    }
  });

  it("covers several destinations with at least one featured property", () => {
    expect(CATALOG_DESTINATIONS.length).toBeGreaterThanOrEqual(6);
    expect(HOTEL_CATALOG.some((hotel) => hotel.featured)).toBe(true);
  });
});
