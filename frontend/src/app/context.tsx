/**
 * Session context (ADR-008): Zustand holds only the selected non-secret
 * context (actor, laboratory, product scope) and UI toggles. Forms stay in
 * component state, and nothing here is persisted to storage (ТЗ-02).
 */
import { create } from "zustand";

export interface ContextState {
  userId: string | null;
  labId: string | null;
  productId: string | null;
  setScope: (next: Partial<Pick<ContextState, "userId" | "labId" | "productId">>) => void;
  reset: () => void;
}

export const useContextStore = create<ContextState>((set) => ({
  userId: null,
  labId: null,
  productId: null,
  setScope: (next) => set(next),
  reset: () => set({ userId: null, labId: null, productId: null }),
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
