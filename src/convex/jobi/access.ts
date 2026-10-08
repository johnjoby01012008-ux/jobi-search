/**
 * Pure access-control and idempotency helpers.
 *
 * Convex enforces ownership inside every query/mutation (the equivalent of
 * Postgres RLS). Keeping the decision in one tested function makes the rule
 * easy to reason about and impossible to forget.
 */

export interface OwnedRecord {
  userId: string;
}

/** True only when the record exists and belongs to the signed-in user. */
export function canAccessRecord(
  record: OwnedRecord | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!record || !userId) return false;
  return record.userId === userId;
}
