import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

/** A single stage in the deep-search pipeline. Drives the real (non-faked) progress UI. */
export const stageValidator = v.object({
  key: v.string(),
  label: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("active"),
    v.literal("done"),
    v.literal("skipped"),
  ),
});
export type SearchStage = Infer<typeof stageValidator>;

export const searchStatusValidator = v.union(
  v.literal("created"),
  v.literal("payment_pending"),
  v.literal("paid"),
  v.literal("researching"),
  v.literal("comparing"),
  v.literal("completed"),
  v.literal("partial"),
  v.literal("failed"),
);
export type SearchStatus = Infer<typeof searchStatusValidator>;

export const budgetTypeValidator = v.union(
  v.literal("total"),
  v.literal("per_night"),
);

export const parsedQueryValidator = v.object({
  destination: v.string(),
  locality: v.optional(v.string()),
  /** Desired radius around `locality`, in kilometres. */
  proximityKm: v.optional(v.number()),
  checkIn: v.string(),
  checkOut: v.string(),
  guests: v.number(),
  rooms: v.number(),
  budget: v.optional(v.number()),
  budgetType: budgetTypeValidator,
  preferences: v.array(v.string()),
});

export const priceStatusValidator = v.union(
  v.literal("verified"),
  v.literal("observed"),
  v.literal("estimated"),
  v.literal("unknown"),
);

export const confidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

export const offerValidator = v.object({
  hotelName: v.string(),
  hotelAddress: v.optional(v.string()),
  destination: v.string(),
  providerName: v.string(),
  bookingUrl: v.string(),
  roomName: v.optional(v.string()),
  checkIn: v.string(),
  checkOut: v.string(),
  guests: v.number(),
  rooms: v.number(),
  basePrice: v.optional(v.number()),
  taxes: v.optional(v.number()),
  mandatoryFees: v.optional(v.number()),
  totalPrice: v.optional(v.number()),
  currency: v.string(),
  mealPlan: v.optional(v.string()),
  cancellationPolicy: v.optional(v.string()),
  sourceUrl: v.string(),
  priceStatus: priceStatusValidator,
  confidence: confidenceValidator,
  checkedAt: v.string(),
  rating: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  amenities: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
});
export type StoredOffer = Infer<typeof offerValidator>;

export const metricsValidator = v.object({
  sourcesFound: v.number(),
  sourcesRead: v.number(),
  offersFound: v.number(),
  offersVerified: v.number(),
  comparableOffers: v.number(),
  cheapestVerified: v.optional(v.number()),
  durationMs: v.number(),
  queriesRun: v.number(),
  truncated: v.boolean(),
});

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ---------------------------------------------------------------------
    // JOBI TABLES
    // ---------------------------------------------------------------------

    searches: defineTable({
      userId: v.id("users"),
      query: v.string(),
      parsed: parsedQueryValidator,
      status: searchStatusValidator,
      stages: v.array(stageValidator),
      amountPaid: v.number(),
      currency: v.string(),
      demoMode: v.boolean(),
      createdAt: v.number(),
      paidAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      metrics: v.optional(metricsValidator),
      /** Human-readable transparency report shown on the results page. */
      report: v.optional(
        v.object({
          sourcesChecked: v.array(v.string()),
          unavailable: v.array(v.string()),
          limitations: v.array(v.string()),
          checkedAt: v.string(),
        }),
      ),
      error: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_status", ["status"]),

    searchPayments: defineTable({
      userId: v.id("users"),
      searchId: v.id("searches"),
      amount: v.number(),
      currency: v.string(),
      provider: v.string(),
      providerOrderId: v.optional(v.string()),
      providerPaymentId: v.optional(v.string()),
      providerSignature: v.optional(v.string()),
      idempotencyKey: v.string(),
      status: v.union(v.literal("created"), v.literal("paid"), v.literal("failed")),
      createdAt: v.number(),
      verifiedAt: v.optional(v.number()),
    })
      .index("by_search", ["searchId"])
      .index("by_user", ["userId"])
      .index("by_idempotency", ["idempotencyKey"])
      .index("by_provider_payment", ["providerPaymentId"]),

    searchResults: defineTable({
      searchId: v.id("searches"),
      userId: v.id("users"),
      hotelEntityId: v.optional(v.id("hotelEntities")),
      canonicalHotelName: v.string(),
      matchConfidence: confidenceValidator,
      providerName: v.string(),
      hotelName: v.string(),
      roomName: v.optional(v.string()),
      bookingUrl: v.string(),
      sourceUrl: v.string(),
      basePrice: v.optional(v.number()),
      taxes: v.optional(v.number()),
      mandatoryFees: v.optional(v.number()),
      totalPrice: v.optional(v.number()),
      currency: v.string(),
      priceStatus: priceStatusValidator,
      confidence: confidenceValidator,
      mealPlan: v.optional(v.string()),
      cancellationPolicy: v.optional(v.string()),
      checkedAt: v.string(),
      rating: v.optional(v.number()),
      imageUrl: v.optional(v.string()),
      amenities: v.optional(v.array(v.string())),
      isCheapestVerified: v.boolean(),
      savingsVsAverage: v.optional(v.number()),
      metadata: v.optional(v.any()),
    }).index("by_search", ["searchId"]),

    hotelEntities: defineTable({
      canonicalName: v.string(),
      normalizedName: v.string(),
      destination: v.string(),
      address: v.optional(v.string()),
      brand: v.optional(v.string()),
      aliases: v.array(v.string()),
      createdAt: v.number(),
    }).index("by_normalized", ["normalizedName", "destination"]),

    hotelProviderMatches: defineTable({
      hotelEntityId: v.id("hotelEntities"),
      providerName: v.string(),
      providerHotelName: v.string(),
      matchConfidence: confidenceValidator,
      signals: v.array(v.string()),
      createdAt: v.number(),
    }).index("by_entity", ["hotelEntityId"]),

    favorites: defineTable({
      userId: v.id("users"),
      searchId: v.id("searches"),
      resultId: v.id("searchResults"),
      hotelName: v.string(),
      providerName: v.string(),
      totalPrice: v.optional(v.number()),
      currency: v.string(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_result", ["userId", "resultId"]),

    auditLogs: defineTable({
      userId: v.optional(v.id("users")),
      searchId: v.optional(v.id("searches")),
      action: v.string(),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_search", ["searchId"])
      .index("by_created", ["createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
