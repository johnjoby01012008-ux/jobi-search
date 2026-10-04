"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import crypto from "node:crypto";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { razorpayConfigured } from "./payments";
import { SEARCH_FEE_PAISE } from "./jobi/config";

/**
 * Real Razorpay integration — only reachable when RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET are configured in the Convex deployment environment.
 * Without them the app runs in DEMO mode and these actions throw.
 */

function credentials(): { keyId: string; keySecret: string } {
  if (!razorpayConfigured(process.env)) {
    throw new ConvexError("Razorpay is not configured.");
  }
  return {
    keyId: process.env.RAZORPAY_KEY_ID as string,
    keySecret: process.env.RAZORPAY_KEY_SECRET as string,
  };
}

/** Create a Razorpay order for an existing payment intent. */
export const createRazorpayOrder = action({
  args: { paymentId: v.id("searchPayments") },
  handler: async (
    ctx,
    { paymentId },
  ): Promise<{ orderId: string; keyId: string; amount: number; currency: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("You must be signed in.");
    const { keyId, keySecret } = credentials();

    const payment: Doc<"searchPayments"> | null = await ctx.runQuery(
      internal.payments.getPaymentInternal,
      { paymentId },
    );
    if (!payment || payment.userId !== userId) throw new ConvexError("Payment not found.");
    if (payment.status === "paid") {
      throw new ConvexError("This search is already paid.");
    }

    // Reuse an existing order so a refresh never creates a second one.
    if (payment.providerOrderId) {
      return {
        orderId: payment.providerOrderId,
        keyId,
        amount: payment.amount,
        currency: payment.currency,
      };
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: SEARCH_FEE_PAISE,
        currency: payment.currency,
        receipt: `search_${payment.searchId}`,
        notes: { searchId: payment.searchId },
      }),
    });

    if (!response.ok) {
      throw new ConvexError(`Could not create Razorpay order (${response.status}).`);
    }
    const order = (await response.json()) as { id: string };
    await ctx.runMutation(internal.payments.setRazorpayOrder, {
      paymentId,
      orderId: order.id,
    });

    return { orderId: order.id, keyId, amount: payment.amount, currency: payment.currency };
  },
});

/** Verify the Razorpay signature server-side before unlocking the search. */
export const verifyRazorpayPayment = action({
  args: {
    paymentId: v.id("searchPayments"),
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.string(),
    signature: v.string(),
  },
  handler: async (
    ctx,
    { paymentId, razorpayOrderId, razorpayPaymentId, signature },
  ): Promise<{ searchId: Id<"searches"> | null; verified: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("You must be signed in.");
    const { keySecret } = credentials();

    const payment: Doc<"searchPayments"> | null = await ctx.runQuery(
      internal.payments.getPaymentInternal,
      { paymentId },
    );
    if (!payment || payment.userId !== userId) throw new ConvexError("Payment not found.");
    if (payment.status === "paid") {
      return { searchId: payment.searchId, verified: true };
    }

    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(signature, "utf8");
    const valid =
      expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer);

    if (!valid) {
      throw new ConvexError("Payment verification failed. No charge was unlocked.");
    }

    const result: { alreadyPaid: boolean; searchId: Id<"searches"> | null } =
      await ctx.runMutation(internal.payments.markRazorpayPaid, {
        paymentId,
        orderId: razorpayOrderId,
        razorpayPaymentId,
        signature,
      });
    return { searchId: result.searchId, verified: true };
  },
});
