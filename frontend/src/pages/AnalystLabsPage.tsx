/**
 * ANALYST context selection (API-02 «Начальные маршруты»): the analyst lands
 * on the choice of one laboratory — no merged journal of all laboratories is
 * ever built. Each choice enters the same canonical working route.
 */
import "../features/identity/identity.css";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchContexts, type Problem } from "../features/identity/api";
import { StatusView } from "../shared/ui/StatusView";
import { useMe } from "../shared/api/me";

export function AnalystLabsPage(): React.ReactElement {
  return (
    <RequireSession>
      <AnalystLabsContent />
    </RequireSession>
  );
}

function AnalystLabsContent(): React.ReactElement {
  const { user: me } = useMe();
  const contexts = useQuery({
    queryKey: [null, null, null, "/contexts", null],
    queryFn: ({ signal }) => fetchContexts(signal),
    enabled: me?.role === "ANALYST",
  });

  if (me !== null && me.role !== "ANALYST") {
    if (me.role === "ADMIN") {
      return <Navigate to="/users" replace />;
    }
    const laboratoryId = me.scopes[0]?.laboratory_id;
    if (laboratoryId !== undefined) {
      return <Navigate to={`/labs/${laboratoryId}/arrivals?queue=expected`} replace />;
    }
    return (
      <div className="vse-app vse-page">
        <h1>Поступления</h1>
        <StatusView
          state="no-scope"
          title="Рабочая область не назначена."
          detail="Обратитесь к администратору, чтобы назначить лабораторию и тип продукции."
        />
      </div>
    );
  }
  if (contexts.isLoading) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="loading" title="Загрузка доступных лабораторий…" />
      </div>
    );
  }
  if (contexts.data !== undefined && "code" in contexts.data) {
    return (
      <div className="vse-app vse-page">
        <StatusView
          state="network-error"
          detail={(contexts.data as Problem).detail}
          onRetry={() => void contexts.refetch()}
        />
      </div>
    );
  }
  const labs = (contexts.data ?? []).filter(
    (scope) => scope.laboratory_id !== null && scope.laboratory_id !== undefined,
  );
  const unique = Array.from(new Set(labs.map((scope) => scope.laboratory_id as string)));

  return (
    <div className="vse-app vse-page">
      <h1>Выберите лабораторию</h1>
      <div className="vse-panel">
        {unique.length === 0 ? (
          <StatusView state="no-scope" title="Доступные лаборатории не назначены." />
        ) : (
          <div className="vse-lab-list">
            {unique.map((labId) => (
              <Link
                key={labId}
                className="vse-lab-link"
                to={`/labs/${labId}/arrivals?queue=expected`}
                aria-label={`Открыть лабораторию ${labId.slice(0, 8)}…`}
              >
                Лаборатория {labId.slice(0, 8)}…<span className="app-field-message">только чтение</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
