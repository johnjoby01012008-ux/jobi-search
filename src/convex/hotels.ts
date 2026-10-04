import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { HOTEL_CATALOG } from "./jobi/catalogData";
import { ROLES, roomOptionValidator } from "./schema";

/**
 * The browsable property catalog.
 *
 * Reading the catalog is public — visitors can browse before signing in. Only
 * administrators can modify inventory, and every booking is scoped to its owner.
 */

async function requireAdmin(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("You must be signed in.");
  const user = await ctx.db.get(userId);
  if (user?.role !== ROLES.ADMIN) throw new ConvexError("Administrator access required.");
  return userId;
}

function lowestRate(rooms: Array<{ nightlyRate: number }>): number {
  if (rooms.length === 0) return 0;
  return Math.min(...rooms.map((room) => room.nightlyRate));
}

/**
 * Seed the curated catalog once. Idempotent: subsequent calls are no-ops, and
 * each property is checked by slug before insertion so a racing call cannot
 * duplicate inventory.
 */
export const ensureCatalog = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("hotels").take(1);
    if (existing.length > 0) return { seeded: 0, total: existing.length };

    const now = Date.now();
    let seeded = 0;
    for (const hotel of HOTEL_CATALOG) {
      const duplicate = await ctx.db
        .query("hotels")
        .withIndex("by_slug", (q) => q.eq("slug", hotel.slug))
        .first();
      if (duplicate) continue;
      await ctx.db.insert("hotels", {
        ...hotel,
        priceFrom: lowestRate(hotel.rooms),
        createdAt: now,
        updatedAt: now,
      });
      seeded += 1;
    }
    return { seeded, total: seeded };
  },
});

export const destinations = query({
  args: {},
  handler: async (ctx) => {
    const hotels = await ctx.db.query("hotels").take(200);
    const counts = new Map<string, number>();
    for (const hotel of hotels) {
      counts.set(hotel.destination, (counts.get(hotel.destination) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([destination, count]) => ({ destination, count }))
      .sort((a, b) => a.destination.localeCompare(b.destination));
  },
});

export const list = query({
  args: {
    search: v.optional(v.string()),
    destination: v.optional(v.string()),
    guests: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    sort: v.optional(
      v.union(v.literal("price"), v.literal("rating"), v.literal("name")),
    ),
    featuredOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let hotels = await ctx.db.query("hotels").take(200);

    if (args.destination) {
      hotels = hotels.filter((hotel) => hotel.destination === args.destination);
    }
    if (args.featuredOnly) {
      hotels = hotels.filter((hotel) => hotel.featured);
    }
    if (args.maxPrice) {
      hotels = hotels.filter((hotel) => hotel.priceFrom <= args.maxPrice!);
    }
    if (args.guests) {
      const guests = args.guests;
      hotels = hotels.filter((hotel) =>
        hotel.rooms.some((room) => (room.maxGuests ?? 2) >= guests),
      );
    }
    if (args.search && args.search.trim().length > 0) {
      const term = args.search.trim().toLowerCase();
      hotels = hotels.filter((hotel) => {
        const haystack = [
          hotel.name,
          hotel.destination,
          hotel.locality,
          hotel.propertyType,
          ...hotel.tags,
          ...hotel.amenities,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
    }

    const sort = args.sort ?? "rating";
    hotels = [...hotels].sort((a, b) => {
      if (sort === "price") return a.priceFrom - b.priceFrom;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.rating - a.rating || b.reviews - a.reviews;
    });

    return hotels.slice(0, args.limit ?? 60);
  },
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("hotels")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
  },
});

export const related = query({
  args: { slug: v.string(), destination: v.string() },
  handler: async (ctx, { slug, destination }) => {
    const hotels = await ctx.db
      .query("hotels")
      .withIndex("by_destination", (q) => q.eq("destination", destination))
      .take(6);
    return hotels.filter((hotel) => hotel.slug !== slug).slice(0, 3);
  },
});

// ---------------------------------------------------------------------------
// Administrator management
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    destination: v.string(),
    locality: v.string(),
    address: v.string(),
    propertyType: v.string(),
    rating: v.number(),
    reviews: v.number(),
    imageUrl: v.string(),
    description: v.string(),
    amenities: v.array(v.string()),
    highlights: v.array(v.string()),
    rooms: v.array(roomOptionValidator),
    tags: v.array(v.string()),
    featured: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new ConvexError("A URL slug is required.");

    const existing = await ctx.db
      .query("hotels")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) throw new ConvexError("A property with that slug already exists.");

    const now = Date.now();
    const hotelId = await ctx.db.insert("hotels", {
      ...args,
      slug,
      currency: "INR",
      priceFrom: lowestRate(args.rooms),
      gallery: [args.imageUrl],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      action: "hotel_created",
      detail: slug,
      createdAt: now,
    });
    return hotelId;
  },
});

export const update = mutation({
  args: {
    hotelId: v.id("hotels"),
    name: v.optional(v.string()),
    destination: v.optional(v.string()),
    locality: v.optional(v.string()),
    propertyType: v.optional(v.string()),
    rating: v.optional(v.number()),
    imageUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    rooms: v.optional(v.array(roomOptionValidator)),
  },
  handler: async (ctx, { hotelId, rooms, ...patch }) => {
    await requireAdmin(ctx);
    const hotel = await ctx.db.get(hotelId);
    if (!hotel) throw new ConvexError("Property not found.");

    const nextRooms = rooms ?? hotel.rooms;
    await ctx.db.patch(hotelId, {
      ...patch,
      rooms: nextRooms,
      priceFrom: lowestRate(nextRooms),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { hotelId: v.id("hotels") },
  handler: async (ctx, { hotelId }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(hotelId);
    await ctx.db.insert("auditLogs", {
      action: "hotel_removed",
      detail: hotelId,
      createdAt: Date.now(),
    });
    return null;
  },
});
