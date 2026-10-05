/**
 * Booking-URL lock.
 *
 * The ₹10 unlock is enforced on the SERVER, not with CSS. A booking URL is
 * only ever returned to a client through `searches.revealBookingUrl`, and only
 * when a server-verified, paid payment exists for the search. Query results
 * returned to the browser have their `bookingUrl` stripped out entirely.
 *
 * These helpers are pure so the rule is trivially unit-testable.
 */

export interface PaymentLike {
  userId: string;
  searchId: string;
  status: string;
  verifiedAt?: number;
}

export interface OwnedSearchLike {
  userId: string;
}

/**
 * True only when the signed-in user owns the search AND a verified (paid)
 * payment record exists for it. Anything else keeps the URL locked.
 */
export function canRevealBookingUrl(
  payment: PaymentLike | null | undefined,
  search: OwnedSearchLike | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!search || !userId) return false;
  if (search.userId !== userId) return false;
  if (!payment) return false;
  if (payment.userId !== userId) return false;
  if (payment.status !== "paid") return false;
  return typeof payment.verifiedAt === "number" && payment.verifiedAt > 0;
}

/**
 * Strip `bookingUrl` from result rows before they leave the server. When the
 * search is unlocked the caller fetches the URL through `revealBookingUrl`
 * instead; this function never re-attaches it.
 */
export function redactSearchResults<T extends { bookingUrl?: string }>(
  rows: T[],
  unlocked: boolean,
): Array<Omit<T, "bookingUrl"> & { bookingUrlLocked: boolean }> {
  return rows.map((row) => {
    const { bookingUrl: _bookingUrl, ...rest } = row;
    void _bookingUrl;
    return { ...(rest as Omit<T, "bookingUrl">), bookingUrlLocked: !unlocked };
  });
}
