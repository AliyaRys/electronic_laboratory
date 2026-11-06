/**
 * Application shell — the single layout route (the F01 router mounts it once
 * for the whole tree): canonical header + outlet + extra children. The
 * dirty-leave dialog and the logout command are wired by the app layer
 * (app/router.tsx) so ``shared`` stays free of feature dependencies.
 *
 * Session identity comes only from GET /me. A missing/failed session renders
 * an honest error state — the shell never fabricates a user, and an open
 * examination's specialist is never shown as the current user (Review Focus).
 */
import "./ui.css";
import "./app-header.css";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useEffect, useMemo, type ReactNode } from "react";
import { AppHeader, headerUserFromView, type HeaderUser, type HeaderMode } from "./AppHeader";
import { StatusView } from "./StatusView";
import { LEGACY_HTML_NAMES, resolveLegacyRoute } from "../lib/legacyRoutes";
import { useContextStore, type ProductType } from "../../entities/session/context";
import { useMe } from "../api/me";
import type { components } from "../api/schema";

type UserRole = components["schemas"]["UserRole"];

export interface AppShellProps {
  /** Injected session state (stories/tests); when omitted, GET /me is used. */
  user?: HeaderUser;
  /** Role for the injected user; real sessions use UserView.role (API-02). */
  role?: UserRole;
  /** Whether the injected user has any laboratory scope assigned. */
  hasScopes?: boolean;
  session?: {
    status: "loading" | "error" | "ready";
    message?: string;
    errorCode?: string;
    traceId?: string;
  };
  onLogout?: () => void;
  onRetrySession?: () => void;
  /**
   * Product context change; the app layer wires switchContext (stale
   * in-flight reads are cancelled there). Without it the shell updates the
   * scope store directly.
   */
  onProductChange?: ((product: ProductType) => void) | undefined;
  /** Rendered below the outlet (e.g. the app-level dirty-leave dialog). */
  children?: ReactNode;
}

/**
 * Header mode from the real UserView (API-02 semantics): ADMIN works in the
 * administration section without working-data navigation; ANALYST gets its
 * own navigation; VET/HEAD work in their laboratory — without any assigned
 * scope there are no working sections at all (no-products mode).
 */
export function headerMode(
  user: HeaderUser | null,
  role: UserRole | undefined,
  hasScopes: boolean,
): HeaderMode {
  if (user === null) return "no-products";
  if (role === "ADMIN") return "admin";
  if (role === "ANALYST") return "analyst";
  return hasScopes ? "work" : "no-products";
}

function useLegacyOutcome(): ReturnType<typeof resolveLegacyRoute> {
  const location = useLocation();
  const labId = useContextStore((state) => state.labId);
  return useMemo(() => {
    if (!LEGACY_HTML_NAMES.includes(location.pathname)) return null;
    return resolveLegacyRoute(location.pathname, location.search, labId);
  }, [location.pathname, location.search, labId]);
}

export function AppShell({
  user: injectedUser,
  role: injectedRole,
  hasScopes: injectedHasScopes,
  session: injectedSession,
  onLogout,
  onRetrySession,
  onProductChange,
  children,
}: AppShellProps): React.ReactElement {
  const navigate = useNavigate();
  const legacy = useLegacyOutcome();
  const me = useMe();
  const productType = useContextStore((state) => state.productType);

  // Publish the session identity into the scope store so scoped query keys
  // (F01) and the legacy resolver work from the same source of truth.
  useEffect(() => {
    if (me.user !== null) {
      useContextStore.getState().setScope({ userId: me.user.id });
    }
  }, [me.user]);

  // A legacy link with a real UUID identity redirects (replace) to its
  // canonical route; without identity the honest not-specified state renders.
  useEffect(() => {
    if (legacy?.outcome === "route") {
      navigate(legacy.path, { replace: true });
    }
  }, [legacy, navigate]);

  const session = injectedSession ?? {
    status: (me.loading ? "loading" : me.user !== null ? "ready" : "error") as "loading" | "ready" | "error",
    message: me.errorMessage ?? undefined,
    errorCode: me.errorCode ?? undefined,
    traceId: me.traceId ?? undefined,
  };
  const user = injectedUser ?? (me.user !== null ? headerUserFromView(me.user) : null);
  const role = injectedRole ?? me.user?.role;
  const hasScopes = injectedHasScopes ?? (me.user !== null ? me.user.scopes.length > 0 : false);
  const mode = headerMode(user, role, hasScopes);

  const changeProduct = (product: ProductType): void => {
    if (onProductChange !== undefined) {
      onProductChange(product);
      return;
    }
    useContextStore.getState().setProductType(product);
  };

  return (
    <div className="vse-app">
      <AppHeader
        mode={mode}
        user={user}
        product={productType}
        onProductChange={changeProduct}
        onLogout={() => onLogout?.()}
      />
      <main className="app-main">
        {legacy !== null && legacy.outcome === "not-specified" ? (
          <StatusView state="not-found" title={legacy.message}>
            <p className="app-status-detail">
              Старые ссылки без реквизитов записи не открывают данные. Воспользуйтесь доступными разделами в
              шапке.
            </p>
          </StatusView>
        ) : (
          <>
            {session.status === "error" ? (
              <div style={{ marginBottom: 16 }}>
                <StatusView
                  state="network-error"
                  title={session.message ?? "Не удалось загрузить данные сеанса."}
                  detail={session.errorCode}
                  trace={session.traceId !== undefined ? `trace_id: ${session.traceId}` : undefined}
                  onRetry={onRetrySession}
                />
              </div>
            ) : null}
            <Outlet />
            {children}
          </>
        )}
      </main>
    </div>
  );
}
