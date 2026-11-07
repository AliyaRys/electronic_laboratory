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
import { Link, useNavigate, useParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchArrival } from "../features/arrivals/api";
import type { IncomingView, Problem } from "../features/arrivals/api";
import { fetchCollections, type CollectionView } from "../features/samples/api";
import { ExaminationForm } from "../features/examinations/ExaminationForm";
import { PartyReadonlyFacts } from "../features/examinations/SampleSelection";
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
  const collections = useQuery({
    queryKey: [labId ?? null, partyId ?? null, "available-collections"],
    queryFn: ({ signal }) => fetchCollections({ laboratory_id: labId ?? "", page: 1 }, signal),
    enabled: labId !== undefined,
  });

  const arrivalProblem = problemOf(arrival.data);
  const collectionProblem = problemOf(collections.data);
  const party: IncomingView | null =
    arrival.data !== undefined && !("code" in arrival.data) ? arrival.data : null;
  const allCollections: CollectionView[] =
    collections.data !== undefined && !("code" in collections.data)
      ? (collections.data as { items: CollectionView[] }).items
      : [];

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
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/arrivals/${partyId}/reconciliation`}>← Сверка эВСД</Link>
      </nav>
      <h1>Новая запись ВСЭ</h1>
      {me.user !== null ? <p className="vse-arrival-hint">{`Специалист: ${me.user.full_name}`}</p> : null}
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
      ) : collectionProblem !== null ? (
        <StatusView
          state="network-error"
          title="Не удалось загрузить доступные пробы."
          detail={collectionProblem.detail}
          onRetry={() => void collections.refetch()}
        />
      ) : arrival.isLoading || collections.isLoading ? (
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
        <>
          <PartyReadonlyFacts party={party} />
          <ExaminationForm
            party={party}
            view={null}
            today={new Date().toISOString().slice(0, 10)}
            availableCollections={allCollections.filter(
              (collection) => collection.party_id === party.party_id && collection.disposal_id === null,
            )}
            onSaved={(created) => {
              void navigate(`/labs/${labId}/examinations/${created.id}`);
            }}
            onCancel={() => void navigate(-1)}
          />
        </>
      )}
    </div>
  );
}
