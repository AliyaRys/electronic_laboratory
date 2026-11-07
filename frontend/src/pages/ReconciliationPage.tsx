/**
 * ReconciliationPage (A02, API-04/FT-ARR-02): the saved CHK screen of one
 * party. Loads the arrival and its (possibly not-yet-created) reconciliation;
 * the empty OPEN view carries the parent ETag, so the first save uses the
 * party revision and later saves the reconciliation revision.
 */
import "../features/arrivals/arrivals.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { RequireSession } from "./RequireSession";
import {
  fetchArrival,
  fetchReconciliation,
  type Problem,
  type ReconciliationView,
} from "../features/arrivals/api";
import { ReconciliationForm } from "../features/arrivals/ReconciliationForm";
import { StatusView } from "../shared/ui/StatusView";
import type { IncomingView } from "../features/arrivals/api";

export function ReconciliationPage(): React.ReactElement {
  return (
    <RequireSession>
      <ReconciliationContent />
    </RequireSession>
  );
}

function ReconciliationContent(): React.ReactElement {
  const { labId, partyId } = useParams<{ labId: string; partyId: string }>();
  const queryClient = useQueryClient();

  // The party is loaded by its REAL route id (API-04 GET /arrivals/:party_id):
  // a foreign or unknown UUID is a 404, never a queue search — a UUID never
  // matches the queue `q` projection (issue number/product names).
  const arrival = useQuery({
    queryKey: [labId ?? null, partyId ?? null, "arrival"],
    queryFn: ({ signal }) => fetchArrival(partyId ?? "", signal),
    enabled: labId !== undefined && partyId !== undefined,
  });
  const reconciliation = useQuery({
    queryKey: [labId ?? null, partyId ?? null, "reconciliation"],
    queryFn: ({ signal }) => fetchReconciliation(partyId ?? "", signal),
    enabled: partyId !== undefined,
  });

  if (labId === undefined || partyId === undefined) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="not-found" title="Поступление не указано." />
      </div>
    );
  }

  const arrivalProblem =
    arrival.data !== undefined && "code" in arrival.data ? (arrival.data as Problem) : null;
  const reconciliationProblem =
    reconciliation.data !== undefined && "code" in reconciliation.data
      ? (reconciliation.data as Problem)
      : null;
  const party: IncomingView | null =
    arrival.data !== undefined && !("code" in arrival.data) ? arrival.data : null;
  const view =
    reconciliation.data !== undefined && !("code" in reconciliation.data) ? reconciliation.data : null;

  return (
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/arrivals`}>← Поступления</Link>
      </nav>
      <h1>Сверка эВСД</h1>
      {arrivalProblem !== null ? (
        arrivalProblem.status === 404 ? (
          <StatusView
            state="not-found"
            title="Поступление не найдено в доступной области."
            detail={arrivalProblem.detail}
          />
        ) : (
          <StatusView
            state="network-error"
            title="Не удалось загрузить поступление."
            detail={arrivalProblem.detail}
            onRetry={() => void arrival.refetch()}
          />
        )
      ) : reconciliationProblem !== null ? (
        <StatusView
          state="network-error"
          title="Не удалось загрузить сверку."
          detail={reconciliationProblem.detail}
          onRetry={() => void reconciliation.refetch()}
        />
      ) : arrival.isLoading || reconciliation.isLoading ? (
        <StatusView state="loading" title="Загрузка сверки…" />
      ) : party === null || view === null ? (
        <StatusView state="not-found" title="Поступление не найдено в доступной очереди." />
      ) : view.state !== "OPEN" ? (
        <StatusView
          state="not-found"
          title="Сверка уже подтверждена внешним результатом."
          detail="Изменение принятого состава через обычное сохранение невозможно (FT-ARR-15)."
        />
      ) : (
        <ReconciliationForm
          party={party}
          initial={view}
          onSaved={(next: ReconciliationView) => {
            void queryClient.setQueryData([labId, partyId, "reconciliation"], next);
          }}
        />
      )}
    </div>
  );
}
