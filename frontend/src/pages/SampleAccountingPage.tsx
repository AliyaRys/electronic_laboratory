/**
 * SampleAccountingPage (S03, API-06, SC-071–079): the «Учёт проб» screen of
 * one laboratory under «Отчёты».
 *
 * Composition: the live balances (readonly shown weight), the available
 * collection facts and the immutable disposal history with its period
 * filter. The period lives in the URL and changes the history only — the
 * balances read model never depends on it (API-06: «фильтр не влияет на
 * balance»). VET/HEAD may start a disposal from a balance row; ANALYST is
 * read-only and sees no disposal affordance. The 5-ВЕТ report link exists
 * only for roles allowed to read saved reports (HEAD/ANALYST) — a VET works
 * strictly within the own scope and gets no link.
 */
import "./../features/samples/samples.css";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import {
  balancesKey,
  collectionsKey,
  disposalsKey,
  fetchBalances,
  fetchCollections,
  fetchDisposals,
  type BalanceView,
  type CollectionView,
  type DisposalView,
  type Problem,
} from "../features/samples/api";
import { Balances, problemState } from "../features/samples/Balances";
import { Collections } from "../features/samples/Collections";
import { DisposalDialog } from "../features/samples/DisposalDialog";
import { DisposalHistory } from "../features/samples/DisposalHistory";
import { useMe } from "../shared/api/me";
import { StatusView } from "../shared/ui/StatusView";

const DISPOSAL_ROLES = new Set(["VET", "HEAD"]);
const REPORT_ROLES = new Set(["HEAD", "ANALYST"]);

export function SampleAccountingPage(): React.ReactElement {
  return (
    <RequireSession>
      <SampleAccountingContent />
    </RequireSession>
  );
}

function SampleAccountingContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [dialogSpecies, setDialogSpecies] = useState<string | null>(null);
  const [openCounter, setOpenCounter] = useState(0);

  const historyFrom = params.get("from") ?? "";
  const historyTo = params.get("to") ?? "";
  const historyPage = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const collectionPage = Math.max(1, Number.parseInt(params.get("collections") ?? "1", 10) || 1);

  const role = me.user?.role ?? null;
  const canDispose = role !== null && DISPOSAL_ROLES.has(role);
  const canReadReports = role !== null && REPORT_ROLES.has(role);

  const balances = useQuery({
    queryKey: balancesKey(labId ?? ""),
    queryFn: ({ signal }) => fetchBalances(labId ?? "", signal),
    enabled: labId !== undefined,
  });
  const collections = useQuery({
    queryKey: collectionsKey(labId ?? "", collectionPage),
    queryFn: ({ signal }) => fetchCollections({ laboratory_id: labId ?? "", page: collectionPage }, signal),
    enabled: labId !== undefined,
  });
  const disposals = useQuery({
    queryKey: disposalsKey(labId ?? "", historyFrom, historyTo, historyPage),
    queryFn: ({ signal }) =>
      fetchDisposals(
        {
          laboratory_id: labId ?? "",
          date_from: historyFrom === "" ? null : historyFrom,
          date_to: historyTo === "" ? null : historyTo,
          page: historyPage,
        },
        signal,
      ),
    enabled: labId !== undefined,
  });

  if (labId === undefined) {
    return (
      <div className="vse-app vse-page">
        <h1>Учёт проб</h1>
        <StatusView state="not-found" title="Лаборатория не указана." />
      </div>
    );
  }

  const asProblem = (query: { data: unknown }): Problem | null =>
    query.data !== undefined && query.data !== null && typeof query.data === "object" && "code" in query.data
      ? (query.data as Problem)
      : null;

  const balancesProblem = asProblem(balances);
  const collectionsProblem = asProblem(collections);
  const disposalsProblem = asProblem(disposals);

  const balanceItems: BalanceView[] | null =
    balancesProblem === null ? ((balances.data ?? null) as BalanceView[] | null) : null;
  const collectionPageData: { items: CollectionView[]; total: number } | null =
    collectionsProblem === null
      ? ((collections.data ?? null) as { items: CollectionView[]; total: number } | null)
      : null;
  const disposalsPageData: { items: DisposalView[]; total: number } | null =
    disposalsProblem === null
      ? ((disposals.data ?? null) as { items: DisposalView[]; total: number } | null)
      : null;

  const applyPeriod = (from: string, to: string): void => {
    const next = new URLSearchParams();
    if (from !== "") next.set("from", from);
    if (to !== "") next.set("to", to);
    setParams(next);
  };

  return (
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/reports`}>← Отчёты</Link>
      </nav>
      <h1>Учёт проб</h1>
      <div className="vse-samples-links">
        {canReadReports ? <Link to={`/labs/${labId}/reports`}>Отчёт 5-ВЕТ (раздел III)</Link> : null}
      </div>
      <div className="vse-samples-blocks">
        {balancesProblem !== null ? (
          <StatusView
            state={problemState(balancesProblem)}
            title={balancesProblem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить остатки."}
            detail={balancesProblem.detail}
            trace={balancesProblem.trace_id !== "" ? `trace_id: ${balancesProblem.trace_id}` : undefined}
            onRetry={() => void balances.refetch()}
          />
        ) : (
          <Balances
            balances={balanceItems ?? []}
            loading={balances.isLoading}
            emptyMessage="Положительных остатков нет."
            canDispose={canDispose}
            onDispose={(target) => {
              // The dialog binds the SPECIES, not a captured snapshot: the
              // fresh BalanceView is resolved from the live balances query on
              // every render, so after a 409 the refreshed remainder (and its
              // revision) reaches both the readonly fact and the fresh
              // confirmation's If-Match/expected_mass_kg.
              setDialogSpecies(target.product_species_id);
              setOpenCounter((counter) => counter + 1);
            }}
          />
        )}
        {collectionsProblem !== null ? (
          <StatusView
            state={problemState(collectionsProblem)}
            title={collectionsProblem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить отборы."}
            detail={collectionsProblem.detail}
            onRetry={() => void collections.refetch()}
          />
        ) : (
          <Collections
            items={collectionPageData?.items ?? null}
            total={collectionPageData?.total ?? 0}
            loading={collections.isLoading}
            page={collectionPage}
            onPageChange={(next) => {
              const nextParams = new URLSearchParams(params);
              nextParams.set("collections", String(next));
              setParams(nextParams);
            }}
          />
        )}
        <section className="vse-samples-block">
          <h2>Период истории</h2>
          <PeriodControls from={historyFrom} to={historyTo} onApply={applyPeriod} />
          {disposalsProblem !== null ? (
            <StatusView
              state={problemState(disposalsProblem)}
              title={disposalsProblem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить историю."}
              detail={disposalsProblem.detail}
              onRetry={() => void disposals.refetch()}
            />
          ) : (
            <DisposalHistory
              items={disposalsPageData?.items ?? null}
              collections={collectionPageData?.items ?? []}
              total={disposalsPageData?.total ?? 0}
              page={historyPage}
              loading={disposals.isLoading}
              onPageChange={(next) => {
                const nextParams = new URLSearchParams(params);
                nextParams.set("page", String(next));
                setParams(nextParams);
              }}
            />
          )}
        </section>
      </div>
      {/* The dialog's balance is the LIVE row of the opened species: after a
          conflict the refreshed query data flows straight into the readonly
          fact and the fresh confirmation. */}
      {(() => {
        const dialogBalance =
          dialogSpecies !== null
            ? ((balanceItems ?? []).find((item) => item.product_species_id === dialogSpecies) ?? null)
            : null;
        return (
          <DisposalDialog
            key={dialogSpecies === null ? "closed" : `open-${openCounter}`}
            laboratoryId={labId}
            balance={dialogBalance}
            open={dialogSpecies !== null}
            today={new Date().toISOString().slice(0, 10)}
            onClose={() => {
              setDialogSpecies(null);
              void balances.refetch();
            }}
            onDisposed={() => void balances.refetch()}
          />
        );
      })()}
    </div>
  );
}

/** The history period controls (from/to in the URL, applied explicitly). */
function PeriodControls({
  from,
  to,
  onApply,
}: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
}): React.ReactElement {
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  return (
    <form
      className="vse-samples-history-controls"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draftFrom, draftTo);
      }}
    >
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="history-from">С даты</label>
        </div>
        <input
          id="history-from"
          type="date"
          value={draftFrom}
          onChange={(event) => setDraftFrom(event.target.value)}
        />
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="history-to">По дату</label>
        </div>
        <input
          id="history-to"
          type="date"
          value={draftTo}
          onChange={(event) => setDraftTo(event.target.value)}
        />
      </div>
      <div>
        <button type="submit">Применить период</button>
      </div>
    </form>
  );
}
