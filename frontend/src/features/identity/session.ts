/**
 * Session orchestration for the identity screens (API-02, SPEC-05).
 *
 * After a successful login the closed anonymous state is dropped first
 * (query cache + CSRF token), then the fresh session material is published:
 * the CSRF token lives in memory only and the non-secret working scope is
 * seeded from the login payload, so the shell reads its identity from /me.
 */
import type { QueryClient } from "@tanstack/react-query";
import { clearQueryCache, useSessionLost, useContextStore } from "../../entities/session/context";
import { setCsrfToken } from "../../shared/api/csrf";
import type { LoginPayload } from "./api";

export function completeLogin(queryClient: QueryClient, payload: LoginPayload): void {
  clearQueryCache(queryClient);
  useSessionLost.getState().reset();
  setCsrfToken(payload.csrf_token);
  const labId = payload.contexts.find((scope) => scope.laboratory_id !== null)?.laboratory_id ?? null;
  const productScope = payload.contexts.find(
    (scope) => scope.laboratory_id !== null && scope.product_scope_id !== null,
  );
  useContextStore.getState().setScope({
    userId: payload.user.id,
    labId,
    productId: productScope?.product_scope_id ?? null,
  });
}
