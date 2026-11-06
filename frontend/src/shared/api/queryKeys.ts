/**
 * Shared query-key construction (ADR-008).
 *
 * Every server-state key starts with the actor scope so that answers of one
 * laboratory/product/user can never be served to another context. Numeric
 * identifiers stay strings.
 */

export interface ContextScope {
  /** Actor id (UUID) from the session, not from URL input; null when logged out. */
  userId: string | null;
  /** Selected laboratory id (UUID) or null before selection. */
  labId: string | null;
  /** Selected product scope id (UUID) or null when not applicable. */
  productId: string | null;
}

/** Key ``[userId, labId, productId, resource, params]`` — ADR-008. */
export function scopedKey(
  scope: ContextScope,
  resource: string,
  params?: Record<string, unknown>,
): readonly unknown[] {
  return [scope.userId, scope.labId, scope.productId, resource, params ?? null];
}

/** True when the cached entry belongs to a different context scope. */
export function isForeignScope(scope: ContextScope, queryKey: readonly unknown[]): boolean {
  const [userId, labId, productId] = queryKey;
  return userId !== scope.userId || labId !== scope.labId || productId !== scope.productId;
}
