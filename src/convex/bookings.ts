import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { buildBookingSearchUrl } from "./jobi/links";
import { isValidISODate, nightsBetween } from "./jobi/parse";
import { ROLES } from "./schema";

/**
 * Reservations.
 *
 * Jobi Search records the reservation and hands the guest to the property's
 * provider to complete the stay payment — we never take the stay payment
 * ourselves, and Jobi charges the traveller nothing.
 */

async function requireUserId(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("You must be signed in.");
  return userId;
}

async function isAdmin(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user?.role === ROLES.ADMIN;
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeReference(): string {
  let value = "";
  for (let index = 0; index < 6; index += 1) {
    value += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return `JS-${value}`;
}

export const create = mutation({
  args: {
    hotelSlug: v.string(),
    roomName: v.string(),
    checkIn: v.string(),
    checkOut: v.string(),
    guests: v.number(),
    rooms: v.number(),
    contactName: v.string(),
    contactEmail: v.string(),
    contactPhone: v.optional(v.string()),
    specialRequests: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const hotel = await ctx.db
      .query("hotels")
      .withIndex("by_slug", (q) => q.eq("slug", args.hotelSlug))
      .first();
    if (!hotel) throw new ConvexError("That property is no longer available.");

    const room = hotel.rooms.find((option) => option.name === args.roomName);
    if (!room) throw new ConvexError("Please choose a valid room type.");

    if (!isValidISODate(args.checkIn) || !isValidISODate(args.checkOut)) {
      throw new ConvexError("Please choose valid check-in and check-out dates.");
    }
    const nights = nightsBetween(args.checkIn, args.checkOut);
    if (nights < 1) throw new ConvexError("Check-out must be after check-in.");
    if (nights > 30) throw new ConvexError("Stays longer than 30 nights are handled by the property.");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(`${args.checkIn}T00:00:00`).getTime() < today.getTime()) {
      throw new ConvexError("Check-in cannot be in the past.");
    }

    const guests = Math.round(args.guests);
    const rooms = Math.round(args.rooms);
    if (guests < 1 || guests > 20) throw new ConvexError("Please enter between 1 and 20 guests.");
    if (rooms < 1 || rooms > 5) throw new ConvexError("Please enter between 1 and 5 rooms.");
    if (room.maxGuests !== undefined && guests > room.maxGuests) {
      throw new ConvexError(`The ${room.name} accommodates up to ${room.maxGuests} guests.`);
    }
    if (!args.contactName.trim()) throw new ConvexError("Please enter the lead guest's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.contactEmail)) {
      throw new ConvexError("Please enter a valid email address.");
    }

    const now = Date.now();
    const reference = makeReference();
    const totalPrice = room.nightlyRate * nights * rooms;

    const bookingId = await ctx.db.insert("bookings", {
      userId,
      hotelId: hotel._id,
      hotelSlug: hotel.slug,
      hotelName: hotel.name,
      destination: hotel.destination,
      locality: hotel.locality,
      imageUrl: hotel.imageUrl,
      providerName: "Booking.com",
      roomName: room.name,
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      guests,
      rooms,
      nightlyRate: room.nightlyRate,
      totalPrice,
      currency: hotel.currency,
      bookingUrl: buildBookingSearchUrl({
        hotelName: hotel.name,
        destination: hotel.destination,
        locality: hotel.locality,
        checkIn: args.checkIn,
        checkOut: args.checkOut,
        guests,
        rooms,
      }),
      status: "reserved",
      reference,
      contactName: args.contactName.trim(),
      contactEmail: args.contactEmail.trim(),
      contactPhone: args.contactPhone?.trim() || undefined,
      specialRequests: args.specialRequests?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "booking_reserved",
      detail: `${reference} · ${hotel.name} · ${args.checkIn}→${args.checkOut}`,
      createdAt: now,
    });

    return { bookingId, reference };
  },
});

export const get = query({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const booking = await ctx.db.get(bookingId);
    if (!booking) return null;
    if (booking.userId === userId) return booking;
    if (await isAdmin(ctx, userId)) return booking;
    return null;
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("bookings")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const cancel = mutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const userId = await requireUserId(ctx);
    const booking = await ctx.db.get(bookingId);
    if (!booking || booking.userId !== userId) throw new ConvexError("Booking not found.");
    if (booking.status === "cancelled") return { status: "cancelled" as const };

    await ctx.db.patch(bookingId, { status: "cancelled", updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "booking_cancelled",
      detail: booking.reference,
      createdAt: Date.now(),
    });
    return { status: "cancelled" as const };
  },
});

// ---------------------------------------------------------------------------
// Administrator management
// ---------------------------------------------------------------------------

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    if (!(await isAdmin(ctx, userId))) return [];

    const bookings = await ctx.db.query("bookings").order("desc").take(100);
    return await Promise.all(
      bookings.map(async (booking) => {
        const owner = await ctx.db.get(booking.userId);
        return {
          ...booking,
          guestEmail: owner?.email ?? booking.contactEmail,
        };
      }),
    );
  },
});

export const setStatus = mutation({
  args: {
    bookingId: v.id("bookings"),
    status: v.union(
      v.literal("reserved"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("completed"),
    ),
  },
  handler: async (ctx, { bookingId, status }) => {
    const userId = await requireUserId(ctx);
    if (!(await isAdmin(ctx, userId))) throw new ConvexError("Administrator access required.");
    await ctx.db.patch(bookingId, { status, updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "booking_status_changed",
      detail: status,
      createdAt: Date.now(),
    });
    return null;
  },
});
