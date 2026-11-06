/**
 * Context switching and cleanup (ADR-008, UI-03, API-01).
 *
 * - ``switchContext`` changes the actor/laboratory/product scope only after
 *   cancelling and dropping queries of the previous scope, so a late answer
 *   of laboratory А can never appear in laboratory Б.
 * - ``performLogout`` revokes the session, then clears the query cache, the
 *   context and the CSRF token, and asks forms to discard closed input.
 * - ``useDirtyGuard`` + ``DirtyLeaveDialog`` block a dirty navigation with an
 *   explicit confirm/cancel decision — no hidden auto-save (UX-CONTRACT).
 */
import { useBlocker } from "react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { currentScope, useContextStore, useDirtyStore } from "../../app/context";
import { isForeignScope } from "../../shared/api/queryKeys";
import { apiClient } from "../../shared/api/client";
import { clearCsrfToken, setCsrfToken } from "../../shared/api/csrf";

export { currentScope };

export const LOGOUT_EVENT = "vse:logout";

export interface ScopeUpdate {
  userId?: string;
  labId?: string;
  productId?: string | null;
}

/**
 * Switch the working context: cancel in-flight queries, drop cache entries of
 * the previous scope, then publish the new scope. The caller is responsible
 * for protecting unsaved input first (router blocker).
 */
export async function switchContext(queryClient: QueryClient, next: ScopeUpdate): Promise<void> {
  const previous = currentScope();
  await queryClient.cancelQueries();
  queryClient.removeQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return isForeignScope(
        {
          userId: next.userId ?? previous.userId,
          labId: next.labId ?? previous.labId,
          productId: next.productId ?? previous.productId,
        },
        key,
      );
    },
  });
  useContextStore.getState().setScope(next);
}

/**
 * Log out: revoke the session server-side (best effort), then clear every
 * closed surface. 401 from the revoke attempt still clears local state.
 */
export async function performLogout(queryClient: QueryClient): Promise<void> {
  try {
    await apiClient.POST("/api/v1/auth/logout", { body: undefined });
  } catch {
    // The session is being discarded either way; no mutation retry here.
  }
  clearQueryCache(queryClient);
}

/** Shared cleanup used by logout and 401 session expiry (SPEC-05). */
export function clearQueryCache(queryClient: QueryClient): void {
  queryClient.cancelQueries().catch(() => undefined);
  queryClient.clear();
  useContextStore.getState().reset();
  useDirtyStore.getState().setDirty(false);
  clearCsrfToken();
  window.dispatchEvent(new CustomEvent(LOGOUT_EVENT));
}

/** Select the current scope inside components (stable snapshot). */
export function useContextScope(): { userId: string | null; labId: string | null; productId: string | null } {
  return useContextStore(
    useShallow((state) => ({ userId: state.userId, labId: state.labId, productId: state.productId })),
  );
}

/**
 * Sync the local dirty flag into the store consumed by {@link DirtyLeaveDialog}
 * (single blocker instance, rendered by the layout).
 */
export function useDirtyGuard(isDirty: boolean, label = ""): void {
  useEffect(() => {
    useDirtyStore.getState().setDirty(isDirty, label);
    return () => {
      useDirtyStore.getState().setDirty(false);
    };
  }, [isDirty, label]);
}

/**
 * Confirm/cancel dialog for a dirty leave or context switch. Escape/cancel is
 * the safe first action (UX-03).
 */
export function DirtyLeaveDialog(): React.ReactElement | null {
  const dirty = useDirtyStore((state) => state.dirty);
  const label = useDirtyStore((state) => state.label);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  if (blocker.state !== "blocked") {
    return null;
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Несохранённый ввод">
      <p>{label !== "" ? `${label} не сохранён. ` : ""}Покинуть страницу без сохранения?</p>
      <button type="button" onClick={() => blocker.reset()}>
        Остаться
      </button>
      <button type="button" onClick={() => blocker.proceed()}>
        Покинуть без сохранения
      </button>
    </div>
  );
}

/** Record the CSRF token delivered by login/bootstrap responses. */
export function applyCsrfToken(token: string): void {
  setCsrfToken(token);
}
