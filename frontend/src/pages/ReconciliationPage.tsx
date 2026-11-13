/**
 * ReconciliationPage (A02, API-04/FT-ARR-02): the saved CHK screen of one
 * party in the approved evsd-check composition — the 1180 px working area,
 * the 30 px title with the Mercury badge and the linked receipt stage.
 * Loads the arrival and its (possibly not-yet-created) reconciliation; the
 * empty OPEN view carries the parent ETag, so the first save uses the party
 * revision and later saves the reconciliation revision.
 */
import "../features/arrivals/reconciliation.css";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { RequireSession } from "./RequireSession";
import {
  NAME_POLL_INTERVAL_MS,
  NAME_POLL_MAX_MS,
  fetchArrival,
  fetchReconciliation,
  hasPendingParticipantNames,
  type Problem,
  type ReconciliationView,
} from "../features/arrivals/api";
import { ReconciliationForm } from "../features/arrivals/ReconciliationForm";
import { ReceiptOperation } from "../features/arrivals/ReceiptOperation";
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
  // ТЗ DR10 §6: when the incoming source snapshot changes (a refreshed party
  // revision), the reconciliation is re-read from the server — no stale unit
  // state is kept in local storage.
  const partyRevision =
    arrival.data !== undefined && !("code" in arrival.data) ? arrival.data.revision : null;
  useEffect(() => {
    if (partyRevision !== null) {
      void queryClient.invalidateQueries({ queryKey: [labId, partyId, "reconciliation"] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyRevision]);

  // ТЗ DR23 §6.2: while a participant name is still PENDING, the open screen
  // re-reads the local read-model endpoints on a BOUNDED interval — refetch
  // only while a PENDING state exists, stopping after RESOLVED/ERROR/MISSING
  // or after 30 s, and never touching VetIS. The timer is cancelled with the
  // screen; react-query aborts the in-flight GETs through the query signal.
  const arrivalView = arrival.data !== undefined && !("code" in arrival.data) ? arrival.data : null;
  const pendingNames = arrivalView !== null && hasPendingParticipantNames(arrivalView);
  useEffect(() => {
    if (!pendingNames) {
      return undefined;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= NAME_POLL_MAX_MS) {
        window.clearInterval(timer);
        return;
      }
      void arrival.refetch();
      void reconciliation.refetch();
    }, NAME_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNames]);

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
    <div className="vse-rec-page">
      <nav className="vse-rec-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/arrivals`}>← Поступления</Link>
      </nav>
      <div className="vse-rec-title-row">
        <h1>Сверка данных транспортного эВСД</h1>
        <span className="vse-rec-mercury-badge">
          {/* ТЗ DR24 §3.2: the decorative mockup logo ships from
              frontend/public (it reaches the Docker build); the accessible
              name of the badge is the text «Меркурий». */}
          <img src="/mercury-logo.webp" alt="" />
          <span>Меркурий</span>
        </span>
      </div>
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
      ) : (
        <>
          {view.state === "OPEN" ? (
            <ReconciliationForm
              party={party}
              initial={view}
              onSaved={(next: ReconciliationView) => {
                void queryClient.setQueryData([labId, partyId, "reconciliation"], next);
              }}
            />
          ) : (
            <StatusView
              state="empty"
              title="Сверка подтверждена внешним результатом."
              detail="Принятый состав больше нельзя изменить через обычное сохранение (FT-ARR-15)."
            />
          )}
          {/* 10. The legally significant receipt stage — the next linked step. */}
          <ReceiptOperation party={party} reconciliation={view} />
        </>
      )}
    </div>
  );
}
