/**
 * Role-aware catalog context (ТЗ-DR6 §6).
 *
 * - HEAD: exactly ONE laboratory assigned by the administrator; the switcher
 *   is never rendered and a query override is ignored. 0/2+ laboratories is
 *   an honest blocking configuration error, never a silent first pick.
 * - ADMIN/ANALYST: a compact selector of the allowed laboratories only,
 *   built from the purpose-built scoped endpoint GET /contexts/laboratories
 *   (the /contexts rows of ADMIN carry only territories), the chosen
 *   laboratory in the URL for a restorable deep link.
 * - VET: the assigned laboratory, read-only.
 * - Raw UUIDs are never shown as names; unknown ids keep the honest
 *   «название недоступно» wording.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocation } from "react-router";
import { fetchContexts, fetchLaboratoryOptions } from "../identity/api";
import { PRODUCTS } from "../../shared/ui/AppHeader";
import { useMe } from "../../shared/api/me";
import { useContextScope } from "../../features/context/SwitchContext";
import { useContextStore, type ProductType } from "../../entities/session/context";

export interface CatalogLaboratory {
  id: string;
  /** Human-readable name from the §6.4 read model (never a shortened UUID). */
  name: string;
}

export type CatalogRole = "VET" | "HEAD" | "ADMIN" | "ANALYST";

export interface CatalogContext {
  loading: boolean;
  role: CatalogRole | null;
  /** Server-checked editing capability for this page (VET stays read-only). */
  canEdit: boolean;
  canBulk: boolean;
  laboratories: CatalogLaboratory[];
  /** Effective laboratory of this page; HEAD cannot be overridden. */
  laboratoryId: string | null;
  laboratoryName: string | null;
  /** Product scope of the chosen laboratory (assigned context). */
  productSpeciesId: string | null;
  productLabel: string;
  /** Blocking honest configuration error (HEAD 0/2+ labs, no scope at all). */
  configError: string | null;
  /** ADMIN/ANALYST must choose one laboratory before any data is loaded. */
  needsSelection: boolean;
  /** Pick another allowed laboratory (ADMIN/ANALYST; VET read-only switch). */
  allowedToSwitch: boolean;
}

export function productTypeLabel(productType: ProductType | null): string {
  if (productType === null) return "Продукция не выбрана";
  return PRODUCTS[productType].label;
}

function nameOrHonest(name: string | null | undefined): string {
  return typeof name === "string" && name.trim() !== "" ? name : "Название лаборатории недоступно";
}

/**
 * Resolve the page context from GET /me and GET /contexts. The product scope
 * prefers the store pair of the chosen laboratory and falls back to the
 * context rows of that laboratory.
 */
export function useCatalogContext(): CatalogContext {
  const { user: me, loading } = useMe();
  const location = useLocation();
  const scopeStore = useContextScope();
  const productType = useContextStore((state) => state.productType);
  const contexts = useQuery({
    queryKey: [null, null, null, "/contexts", null],
    queryFn: ({ signal }) => fetchContexts(signal),
    enabled: me !== null,
  });
  // The selector options of ADMIN/ANALYST come from the purpose-built scoped
  // endpoint (§6.4): for ADMIN the /contexts rows carry ONLY territories
  // (laboratory_id null), so they can never fill the selector.
  const rolePre = me !== null ? (me.role as string) : null;
  const needsLaboratoryOptions = rolePre === "ADMIN" || rolePre === "ANALYST";
  const laboratoryOptions = useQuery({
    queryKey: [null, null, null, "/contexts/laboratories", null],
    queryFn: ({ signal }) => fetchLaboratoryOptions(signal),
    enabled: me !== null && needsLaboratoryOptions,
  });

  return useMemo(() => {
    if (
      loading ||
      me === null ||
      contexts.isLoading ||
      (needsLaboratoryOptions && laboratoryOptions.isLoading)
    ) {
      return {
        loading: true,
        role: null,
        canEdit: false,
        canBulk: false,
        laboratories: [],
        laboratoryId: null,
        laboratoryName: null,
        productSpeciesId: null,
        productLabel: productTypeLabel(productType),
        configError: null,
        needsSelection: false,
        allowedToSwitch: false,
      };
    }
    const role = me.role as CatalogRole;
    if (!["VET", "HEAD", "ADMIN", "ANALYST"].includes(role)) {
      return {
        loading: false,
        role: null,
        canEdit: false,
        canBulk: false,
        laboratories: [],
        laboratoryId: null,
        laboratoryName: null,
        productSpeciesId: null,
        productLabel: productTypeLabel(productType),
        configError: "Раздел доступен заведующему, администратору и аналитику.",
        needsSelection: false,
        allowedToSwitch: false,
      };
    }
    if (contexts.data !== undefined && contexts.data !== null && "code" in contexts.data) {
      return {
        loading: false,
        role,
        canEdit: false,
        canBulk: false,
        laboratories: [],
        laboratoryId: null,
        laboratoryName: null,
        productSpeciesId: null,
        productLabel: productTypeLabel(productType),
        configError: null,
        needsSelection: false,
        allowedToSwitch: false,
      };
    }
    const rows = contexts.data ?? [];

    if (role === "HEAD" || role === "VET") {
      // Only the assigned laboratories; a query override never widens it.
      // Names come from the trusted /contexts read model (§6.4); the scope
      // rows are the same set, kept as a fallback when /contexts is empty.
      const sourceRows = rows.length > 0 ? rows : me.scopes;
      const byId = new Map<string, string | null>();
      for (const scope of sourceRows) {
        if (scope.laboratory_id == null) continue;
        byId.set(scope.laboratory_id, nameOrHonest(scope.laboratory_name));
      }
      const laboratories = Array.from(byId, ([id, name]) => ({ id, name: name ?? "" }));
      if (laboratories.length === 0) {
        return {
          loading: false,
          role,
          canEdit: false,
          canBulk: false,
          laboratories,
          laboratoryId: null,
          laboratoryName: null,
          productSpeciesId: null,
          productLabel: productTypeLabel(productType),
          configError:
            "Рабочая область не назначена. Обратитесь к администратору, чтобы назначить лабораторию и тип продукции.",
          needsSelection: false,
          allowedToSwitch: false,
        };
      }
      if (laboratories.length > 1 && role === "HEAD") {
        return {
          loading: false,
          role,
          canEdit: false,
          canBulk: false,
          laboratories,
          laboratoryId: null,
          laboratoryName: null,
          productSpeciesId: null,
          productLabel: productTypeLabel(productType),
          configError:
            "Учётная запись заведующего должна иметь ровно одну назначенную лабораторию. Обратитесь к администратору.",
          needsSelection: false,
          allowedToSwitch: false,
        };
      }
      if (laboratories.length > 1 && role === "VET") {
        // Several assigned laboratories: an honest pick of one allowed lab.
        return {
          loading: false,
          role,
          canEdit: false,
          canBulk: false,
          laboratories,
          laboratoryId: null,
          laboratoryName: null,
          productSpeciesId: null,
          productLabel: productTypeLabel(productType),
          configError: null,
          needsSelection: true,
          allowedToSwitch: true,
        };
      }
      const [only] = laboratories;
      const pair = rows.find((scope) => scope.laboratory_id === only.id && scope.product_scope_id !== null);
      const productSpeciesId =
        scopeStore.labId === only.id && scopeStore.productId !== null
          ? scopeStore.productId
          : (pair?.product_scope_id ?? null);
      return {
        loading: false,
        role,
        canEdit: role === "HEAD",
        canBulk: false,
        laboratories,
        laboratoryId: only.id,
        laboratoryName: only.name,
        productSpeciesId,
        productLabel: productTypeLabel(productType),
        configError: null,
        needsSelection: false,
        allowedToSwitch: false,
      };
    }

    // ADMIN / ANALYST: the selector covers only the server-allowed set. The
    // options come from the scoped /contexts/laboratories endpoint with
    // human-readable names; the /contexts rows are the fallback only when the
    // endpoint answers with a problem (older backend before the §6.4 deploy).
    const optionRows = laboratoryOptions.data;
    const optionsFromEndpoint =
      optionRows !== undefined && optionRows !== null && !("code" in optionRows)
        ? optionRows.map((option) => ({ id: option.laboratory_id, name: nameOrHonest(option.name) }))
        : null;
    const byId = new Map<string, string>();
    if (optionsFromEndpoint !== null) {
      for (const option of optionsFromEndpoint) byId.set(option.id, option.name);
    } else {
      for (const scope of rows) {
        if (scope.laboratory_id == null) continue;
        byId.set(scope.laboratory_id, nameOrHonest(scope.laboratory_name));
      }
    }
    const laboratories = Array.from(byId, ([id, name]) => ({ id, name }));
    const params = new URLSearchParams(location.search);
    const requested = params.get("laboratory_id");
    const allowed = laboratories.find((item) => item.id === requested) ?? null;
    if (laboratories.length === 0) {
      return {
        loading: false,
        role,
        canEdit: false,
        canBulk: false,
        laboratories,
        laboratoryId: null,
        laboratoryName: null,
        productSpeciesId: null,
        productLabel: productTypeLabel(productType),
        configError: "Доступные лаборатории не назначены. Обратитесь к администратору.",
        needsSelection: false,
        allowedToSwitch: false,
      };
    }
    if (allowed === null) {
      return {
        loading: false,
        role,
        canEdit: false,
        canBulk: false,
        laboratories,
        laboratoryId: null,
        laboratoryName: null,
        productSpeciesId: null,
        productLabel: productTypeLabel(productType),
        configError: null,
        needsSelection: true,
        allowedToSwitch: true,
      };
    }
    const pair = rows.find((scope) => scope.laboratory_id === allowed.id && scope.product_scope_id !== null);
    const productSpeciesId =
      scopeStore.labId === allowed.id && scopeStore.productId !== null
        ? scopeStore.productId
        : (pair?.product_scope_id ?? null);
    return {
      loading: false,
      role,
      canEdit: true,
      canBulk: true,
      laboratories,
      laboratoryId: allowed.id,
      laboratoryName: allowed.name,
      productSpeciesId,
      productLabel: productTypeLabel(productType),
      configError: null,
      needsSelection: false,
      allowedToSwitch: true,
    };
  }, [
    loading,
    me,
    contexts.isLoading,
    contexts.data,
    laboratoryOptions.isLoading,
    laboratoryOptions.data,
    scopeStore,
    productType,
    location.search,
  ]);
}
