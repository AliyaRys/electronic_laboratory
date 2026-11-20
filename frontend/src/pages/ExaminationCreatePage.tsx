/**
 * ExaminationCreatePage (E04, API-05): the local VSE creation of ONE
 * confirmed party at /labs/:labId/arrivals/:partyId/examination/new.
 *
 * The header shows the current session user (header=me); the party data,
 * the four classification levels and the accepted volume are readonly from
 * the confirmed arrival (SC-033/034). If the party already carries an
 * examination, the page sends the doctor to the existing card instead of a
 * second create (409 would only repeat the fact).
 */
import "../features/examinations/examinations.css";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchArrival } from "../features/arrivals/api";
import type { IncomingView, Problem } from "../features/arrivals/api";
import { fetchExaminationForm, type ExaminationFormView } from "../features/examinations/api";
import { ExaminationForm } from "../features/examinations/ExaminationForm";
import { StatusView } from "../shared/ui/StatusView";
import { useMe } from "../shared/api/me";

export function ExaminationCreatePage(): React.ReactElement {
  return (
    <RequireSession>
      <ExaminationCreateContent />
    </RequireSession>
  );
}

function problemOf(data: unknown): Problem | null {
  return data !== undefined && data !== null && typeof data === "object" && "code" in data
    ? (data as Problem)
    : null;
}

function ExaminationCreateContent(): React.ReactElement {
  const { labId, partyId } = useParams<{ labId: string; partyId: string }>();
  const navigate = useNavigate();
  const me = useMe();

  const arrival = useQuery({
    queryKey: [labId ?? null, partyId ?? null, "arrival"],
    queryFn: ({ signal }) => fetchArrival(partyId ?? "", signal),
    enabled: partyId !== undefined,
  });
  // DR35 §4: the frozen reconciliation-step read model (participants, product
  // type, accepted volume, required researches, scoped specialists) — the
  // single read source of the create page; no SOAP and no lookup job runs here.
  const formView = useQuery({
    queryKey: [labId ?? null, partyId ?? null, "examination-form"],
    queryFn: ({ signal }) => fetchExaminationForm(partyId ?? "", signal),
    enabled: partyId !== undefined,
  });

  const arrivalProblem = problemOf(arrival.data);
  const formProblem = problemOf(formView.data);
  const party: IncomingView | null =
    arrival.data !== undefined && !("code" in arrival.data) ? arrival.data : null;
  const form: ExaminationFormView | null =
    formView.data !== undefined && !("code" in formView.data) ? formView.data : null;

  // The party already has a card: creation is impossible (one card per
  // party), so the doctor goes straight to the existing card.
  useEffect(() => {
    if (party !== null && party.examination_id !== null) {
      navigate(`/labs/${labId}/examinations/${party.examination_id}`, { replace: true });
    }
  }, [party, labId, navigate]);

  if (labId === undefined || partyId === undefined) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="not-found" title="Поступление не указано." />
      </div>
    );
  }

  return (
    <div className="vse-app vse-page vse-exam-page">
      {/* ТЗ DR54 Task 4: the redundant breadcrumb «← Сверка эВСД» was removed
          by the owner decision; the form's own «Отменить» covers navigation. */}
      <div className="vse-page-head">
        <div>
          <p className="vse-eyebrow">Новая запись</p>
          <h1>Создание карточки ВСЭ</h1>
        </div>
        <div className="vse-legend">
          <span className="vse-req">*</span> обязательные поля
        </div>
      </div>
      {arrivalProblem !== null ? (
        <StatusView
          state={arrivalProblem.status === 404 ? "not-found" : "network-error"}
          title={
            arrivalProblem.status === 404
              ? "Поступление не найдено в доступной области."
              : "Не удалось загрузить поступление."
          }
          detail={arrivalProblem.detail}
          onRetry={() => void arrival.refetch()}
        />
      ) : formProblem !== null && formProblem.status !== 404 ? (
        <StatusView
          state="network-error"
          title="Не удалось загрузить данные формы."
          detail={formProblem.detail}
          onRetry={() => void formView.refetch()}
        />
      ) : arrival.isLoading || formView.isLoading ? (
        <StatusView state="loading" title="Загрузка карточки ВСЭ…" />
      ) : party === null ? (
        <StatusView state="not-found" title="Поступление не найдено." />
      ) : party.confirmation === null ? (
        <StatusView
          state="not-found"
          title="Приёмка партии ещё не подтверждена."
          detail="Карточка ВСЭ создаётся только по подтверждённой партии (FT-ARR-14)."
        />
      ) : (
        <ExaminationForm
          party={party}
          view={null}
          today={new Date().toISOString().slice(0, 10)}
          formView={form}
          currentUserId={me.user?.id ?? null}
          onSaved={(created) => {
            void navigate(`/labs/${labId}/examinations/${created.id}`);
          }}
          onCancel={() => void navigate(-1)}
        />
      )}
    </div>
  );
}
