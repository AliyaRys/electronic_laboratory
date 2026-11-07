/**
 * Session entity state (ADR-008, SPEC-02 layering).
 *
 * The selected non-secret context (actor, laboratory, product scope) and the
 * dirty flag live here so that both ``app`` and ``features`` can depend on
 * them without a bidirectional app↔features import. Nothing is persisted to
 * storage (ТЗ-02).
 */
import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import { clearCsrfToken } from "../../shared/api/csrf";

export type ProductType = "meat" | "milk";

export interface ContextState {
  userId: string | null;
  labId: string | null;
  productId: string | null;
  /** Working product context of the header (meat/milk); not persisted. */
  productType: ProductType;
  setScope: (next: Partial<Pick<ContextState, "userId" | "labId" | "productId">>) => void;
  setProductType: (product: ProductType) => void;
  reset: () => void;
}

export const useContextStore = create<ContextState>((set) => ({
  userId: null,
  labId: null,
  productId: null,
  productType: "meat",
  setScope: (next) => set(next),
  setProductType: (product) => set({ productType: product }),
  reset: () => set({ userId: null, labId: null, productId: null, productType: "meat" }),
}));

/** Current scope outside React (tests, event handlers). */
export function currentScope(): Pick<ContextState, "userId" | "labId" | "productId"> {
  const { userId, labId, productId } = useContextStore.getState();
  return { userId, labId, productId };
}

/** Non-secret dirty flag used by the router blocker for unsaved forms. */
export interface DirtyState {
  dirty: boolean;
  label: string;
  setDirty: (dirty: boolean, label?: string) => void;
}

export const useDirtyStore = create<DirtyState>((set) => ({
  dirty: false,
  label: "",
  setDirty: (dirty, label = "") => set({ dirty, label }),
}));

/** One-shot notification for screens holding closed input (SPEC-05). */
export const LOGOUT_EVENT = "vse:logout";

/**
 * Session-loss flag (FT-ACC-01): a 401 on any closed read marks the session
 * as lost deterministically — the /me clear→refetch cycle may never expose a
 * stable error render, so the guard reads this flag instead.
 */
export const useSessionLost = create<{ lost: boolean; markLost: () => void; reset: () => void }>((set) => ({
  lost: false,
  markLost: () => set({ lost: true }),
  reset: () => set({ lost: false }),
}));

/**
 * Shared cleanup used by logout and 401 session expiry (SPEC-05).
 *
 * It never dispatches events itself: the provider reacts to the 401 transport
 * event, and performLogout notifies forms with one LOGOUT_EVENT afterwards —
 * a dispatched event must not re-enter this function (regression F01-r1).
 */
export function clearQueryCache(queryClient: QueryClient): void {
  queryClient.cancelQueries().catch(() => undefined);
  queryClient.clear();
  useContextStore.getState().reset();
  useDirtyStore.getState().setDirty(false);
  clearCsrfToken();
}
