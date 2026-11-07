/**
 * Session guard for working pages: a lost/blocked session (stable codes from
 * /me) leaves for the login; a transport failure shows an honest retry state
 * — the guard never fabricates a session.
 */
import { Navigate } from "react-router";
import { useMe } from "../shared/api/me";
import { useSessionLost } from "../entities/session/context";
import { StatusView } from "../shared/ui/StatusView";

const SESSION_LOST_CODES = new Set(["SESSION_REQUIRED", "SESSION_EXPIRED", "ACCOUNT_BLOCKED"]);

export function RequireSession({ children }: { children: React.ReactElement }): React.ReactElement | null {
  const me = useMe();
  const lost = useSessionLost((state) => state.lost);
  if (lost) {
    // Marked by the 401 handler: no further probing, go straight to login.
    return <Navigate to="/login" replace />;
  }
  if (me.loading) {
    return <StatusView state="loading" title="Загрузка сеанса…" />;
  }
  if (me.user === null) {
    if (me.errorCode !== null && SESSION_LOST_CODES.has(me.errorCode)) {
      // A lost or blocked session: the only way back is the login (FT-ACC-01).
      return <Navigate to="/login" replace />;
    }
    return (
      <StatusView
        state="network-error"
        title="Не удалось загрузить данные сеанса."
        detail={me.errorMessage ?? undefined}
        trace={me.traceId !== null ? `trace_id: ${me.traceId}` : undefined}
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  }
  return children;
}
