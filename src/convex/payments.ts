import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { CURRENCY, SEARCH_FEE_PAISE, SEARCH_FEE_RUPEES } from "./jobi/config";
import { paymentIdempotencyKey } from "./jobi/access";

/**
 * Payments.
 *
 * Jobi charges ₹10 once per search and verifies the payment SERVER-SIDE. We
 * never trust a `payment_success=true` flag from the browser.
 *
 * - With Razorpay keys configured, `createRazorpayOrder` / `verifyRazorpayPayment`
 *   (see razorpayActions.ts) run the real flow and the signature is verified.
 * - Without keys, the service runs in DEMO mode: `confirmDemoPayment` issues a
 *   server-generated demo payment. This is clearly labelled DEMO in the UI and
 *   is only ever allowed when Razorpay is NOT configured.
 */

export function razorpayConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export const getPaymentConfig = query({
  args: {},
  handler: async () => {
    const configured = razorpayConfigured(process.env);
    return {
      provider: configured ? "razorpay" : "demo",
      demoMode: !configured,
      amount: SEARCH_FEE_RUPEES,
      amountPaise: SEARCH_FEE_PAISE,
      currency: CURRENCY,
      // The Razorpay *key id* is public (used to open Checkout). The secret is
      // never exposed.
      razorpayKeyId: configured ? process.env.RAZORPAY_KEY_ID : undefined,
    };
  },
});

async function requireUserId(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("You must be signed in.");
  return userId;
}

/**
 * Idempotently create (or return) the payment intent for a search. Calling this
 * twice for the same search — e.g. because of a double click — returns the same
 * payment record and can never charge twice.
 */
export const initiatePayment = mutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const userId = await requireUserId(ctx);
    const search = await ctx.db.get(searchId);
    if (!search || search.userId !== userId) {
      throw new ConvexError("Search not found.");
    }

    const configured = razorpayConfigured(process.env);

    const existing = await ctx.db
      .query("searchPayments")
      .withIndex("by_search", (q) => q.eq("searchId", searchId))
      .first();
    if (existing) {
      return {
        paymentId: existing._id,
        mode: configured ? ("razorpay" as const) : ("demo" as const),
        status: existing.status,
        amount: SEARCH_FEE_RUPEES,
        currency: CURRENCY,
        razorpayKeyId: configured ? process.env.RAZORPAY_KEY_ID : undefined,
      };
    }

    const paymentId = await ctx.db.insert("searchPayments", {
      userId,
      searchId,
      amount: SEARCH_FEE_RUPEES,
      currency: CURRENCY,
      provider: configured ? "razorpay" : "demo",
      idempotencyKey: paymentIdempotencyKey(searchId),
      status: "created",
      createdAt: Date.now(),
    });

    if (search.status === "created") {
      await ctx.db.patch(searchId, { status: "payment_pending", demoMode: !configured });
    }

    return {
      paymentId,
      mode: configured ? ("razorpay" as const) : ("demo" as const),
      status: "created" as const,
      amount: SEARCH_FEE_RUPEES,
      currency: CURRENCY,
      razorpayKeyId: configured ? process.env.RAZORPAY_KEY_ID : undefined,
    };
  },
});

/**
 * DEMO-mode confirmation. Refuses to run when real Razorpay keys are configured,
 * so it can never be used to sidestep a real payment.
 */
export const confirmDemoPayment = mutation({
  args: { paymentId: v.id("searchPayments") },
  handler: async (ctx, { paymentId }) => {
    const userId = await requireUserId(ctx);
    if (razorpayConfigured(process.env)) {
      throw new ConvexError("Live payments are enabled — demo confirmation is disabled.");
    }

    const payment = await ctx.db.get(paymentId);
    if (!payment || payment.userId !== userId) throw new ConvexError("Payment not found.");

    // Already confirmed: return the existing paid state (idempotent).
    if (payment.status === "paid") {
      return { searchId: payment.searchId, status: "paid" as const };
    }

    const search = await ctx.db.get(payment.searchId);
    if (!search || search.userId !== userId) throw new ConvexError("Search not found.");

    const now = Date.now();
    await ctx.db.patch(paymentId, {
      status: "paid",
      providerPaymentId: `demo_${paymentId}`,
      verifiedAt: now,
    });
    await ctx.db.patch(payment.searchId, {
      status: "paid",
      paidAt: now,
      demoMode: true,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      searchId: payment.searchId,
      action: "payment_confirmed_demo",
      detail: `₹${payment.amount}`,
      createdAt: now,
    });

    // Kick off the paid research run exactly once.
    await ctx.scheduler.runAfter(0, internal.research.runSearch, {
      searchId: payment.searchId,
    });

    return { searchId: payment.searchId, status: "paid" as const };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers used by the Razorpay node actions.
// ---------------------------------------------------------------------------

export const getPaymentInternal = internalQuery({
  args: { paymentId: v.id("searchPayments") },
  handler: async (ctx, { paymentId }) => ctx.db.get(paymentId),
});

export const setRazorpayOrder = internalMutation({
  args: { paymentId: v.id("searchPayments"), orderId: v.string() },
  handler: async (ctx, { paymentId, orderId }) => {
    await ctx.db.patch(paymentId, { providerOrderId: orderId });
  },
});

/** Mark a Razorpay payment paid after the signature has been verified. */
export const markRazorpayPaid = internalMutation({
  args: {
    paymentId: v.id("searchPayments"),
    orderId: v.string(),
    razorpayPaymentId: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { paymentId, orderId, razorpayPaymentId, signature }) => {
    const payment = await ctx.db.get(paymentId);
    if (!payment) return { alreadyPaid: false, searchId: null };
    if (payment.status === "paid") {
      return { alreadyPaid: true, searchId: payment.searchId };
    }
    const now = Date.now();
    await ctx.db.patch(paymentId, {
      status: "paid",
      providerOrderId: orderId,
      providerPaymentId: razorpayPaymentId,
      providerSignature: signature,
      verifiedAt: now,
    });
    await ctx.db.patch(payment.searchId, { status: "paid", paidAt: now, demoMode: false });
    await ctx.db.insert("auditLogs", {
      userId: payment.userId,
      searchId: payment.searchId,
      action: "payment_verified_razorpay",
      detail: razorpayPaymentId,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.research.runSearch, {
      searchId: payment.searchId,
    });
    return { alreadyPaid: false, searchId: payment.searchId };
  },
});

export const getPaymentForSearch = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const payment = await ctx.db
      .query("searchPayments")
      .withIndex("by_search", (q) => q.eq("searchId", searchId))
      .first();
    if (!payment || payment.userId !== userId) return null;
    return payment;
  },
});
