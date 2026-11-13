/**
 * Arrivals queues (FT-ARR-01/02, DR3): the EXPECTED/WORK/ACCEPTED stages of
 * one laboratory, visually aligned with the approved mockups. The page owns
 * the queries, URL state and mutations; the composition itself lives in
 * ArrivalsScreen (shared with the stories). The refresh button (ТЗ-10,
 * VET/HEAD only) posts the SAME durable sync job the 15-minute scheduler
 * runs and polls GET /operations/:id — an honest failed run is shown, never
 * a fake import. The work area is limited to 1180 px (spec 6.1) without
 * changing the global app shell width.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import {
  fetchArrivals,
  fetchOperationState,
  hideArrival,
  revisionEtag,
  syncArrivals,
  syncIsTerminal,
  type ArrivalQueue,
  type ArrivalResult,
  type ArrivalSort,
  type IncomingView,
  type Problem,
  type SyncAccepted,
  type SyncOperationState,
} from "../features/arrivals/api";
import { ArrivalsScreen } from "../features/arrivals/ArrivalsScreen";
import { type StageCount } from "../features/arrivals/StageTabs";
import { useMe } from "../shared/api/me";
import { Button } from "../shared/ui/Button";
import { Dialog } from "../shared/ui/Dialog";
import { StatusView } from "../shared/ui/StatusView";

const QUEUES: readonly ArrivalQueue[] = ["EXPECTED", "WORK", "ACCEPTED"];
const SYNC_ROLES = new Set(["VET", "HEAD"]);
const POLL_INTERVAL_MS = 1500;

interface Filters {
  queue: ArrivalQueue;
  result: string;
  q: string;
  page: number;
  /** DR15 §5.1: the issue-date sort; the URL default is the server default. */
  sort: ArrivalSort;
}

/** DR15 §6: the default sort matches the server default (desc = newest first). */
const DEFAULT_SORT: ArrivalSort = "desc";
const SORTS: readonly ArrivalSort[] = ["asc", "desc"];

function filtersFromParams(params: URLSearchParams): Filters {
  const queue = (params.get("queue") ?? "EXPECTED").toUpperCase() as ArrivalQueue;
  const sortParam = params.get("sort") as ArrivalSort | null;
  return {
    queue: QUEUES.includes(queue) ? queue : "EXPECTED",
    result: params.get("result") ?? "",
    q: params.get("q") ?? "",
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
    sort: sortParam !== null && SORTS.includes(sortParam) ? sortParam : DEFAULT_SORT,
  };
}

export function ArrivalsPage(): React.ReactElement {
  return (
    <RequireSession>
      <ArrivalsContent />
    </RequireSession>
  );
}

function ArrivalsContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const [params, setParams] = useSearchParams();
  const { user } = useMe();
  const filters = filtersFromParams(params);
  const [hideTarget, setHideTarget] = useState<IncomingView | null>(null);
  const [hideError, setHideError] = useState("");
  const [syncJob, setSyncJob] = useState<SyncAccepted | null>(null);
  const [syncError, setSyncError] = useState("");
  const [syncState, setSyncState] = useState<SyncOperationState | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());

  const arrivals = useQuery({
    // DR15 §6: the sort is part of the query key so a stale answer never
    // replaces the newly sorted page.
    queryKey: ["arrivals", labId ?? null, filters],
    queryFn: ({ signal }) =>
      fetchArrivals(
        {
          laboratory_id: labId ?? "",
          queue: filters.queue,
          result: filters.result === "" ? null : (filters.result as ArrivalResult),
          q: filters.q === "" ? null : filters.q,
          page: filters.page,
          sort: filters.sort,
        },
        signal,
      ),
    enabled: labId !== undefined,
    // Fresh data keep the table geometry while a new page/filter loads.
    placeholderData: (previous) => previous,
  });

  // Real stage totals for the tab counters (NOT the 20 rows of one page).
  // A failed counter degrades to a neutral dash and never blocks the queue.
  const expectedCount = useQuery({
    queryKey: ["arrivals-count", labId ?? null, "EXPECTED", filters.q],
    queryFn: ({ signal }) =>
      fetchArrivals(
        { laboratory_id: labId ?? "", queue: "EXPECTED", q: filters.q === "" ? null : filters.q, page: 1 },
        signal,
      ),
    enabled: labId !== undefined,
  });
  const workCount = useQuery({
    queryKey: ["arrivals-count", labId ?? null, "WORK", filters.q],
    queryFn: ({ signal }) =>
      fetchArrivals(
        { laboratory_id: labId ?? "", queue: "WORK", q: filters.q === "" ? null : filters.q, page: 1 },
        signal,
      ),
    enabled: labId !== undefined,
  });
  const acceptedCount = useQuery({
    queryKey: ["arrivals-count", labId ?? null, "ACCEPTED", filters.q],
    queryFn: ({ signal }) =>
      fetchArrivals(
        {
          laboratory_id: labId ?? "",
          queue: "ACCEPTED",
          result: filters.result === "" ? null : (filters.result as ArrivalResult),
          q: filters.q === "" ? null : filters.q,
          page: 1,
        },
        signal,
      ),
    enabled: labId !== undefined,
  });

  const stageCount = (query: typeof expectedCount): StageCount => {
    if (query.isPending) return "loading";
    if (query.isError || query.data === undefined || "code" in query.data) return "failed";
    return query.data.total;
  };
  const counts = {
    EXPECTED: stageCount(expectedCount),
    WORK: stageCount(workCount),
    ACCEPTED: stageCount(acceptedCount),
  };

  const page = arrivals.data !== undefined && !("code" in arrivals.data) ? arrivals.data : null;
  const pageCount = page !== null ? Math.max(1, Math.ceil(page.total / page.page_size)) : 1;

  // ТЗ DR22 §6: after committed SUCCESS the table and the three stage counters
  // are re-read DIRECTLY (refetch()). cancelRefetch drops a superseded in-flight
  // read so a stale response can never replace the fresh one; every refetch is
  // awaited, so the screen waits for the ACTUAL post-commit answer.
  const refreshAfterSync = async (): Promise<void> => {
    await Promise.all([
      arrivals.refetch({ cancelRefetch: true }),
      expectedCount.refetch({ cancelRefetch: true }),
      workCount.refetch({ cancelRefetch: true }),
      acceptedCount.refetch({ cancelRefetch: true }),
    ]);
  };

  const applyFilters = (next: Partial<Filters>): void => {
    const merged = { ...filters, ...next };
    const search = new URLSearchParams();
    search.set("queue", merged.queue.toLowerCase());
    if (merged.result !== "") search.set("result", merged.result.toLowerCase());
    if (merged.q !== "") search.set("q", merged.q);
    // DR15 §5.1: the sort is URL-persistent; the non-default order is written
    // explicitly while the absent param means the server default (desc) — the
    // existing routes/landing URLs stay unchanged.
    if (merged.sort !== DEFAULT_SORT) search.set("sort", merged.sort);
    if (merged.page > 1) search.set("page", String(merged.page));
    setParams(search);
  };

  const runHide = async (): Promise<void> => {
    if (hideTarget === null) return;
    const problem = await hideArrival(hideTarget.party_id, revisionEtag(hideTarget), crypto.randomUUID());
    if (problem === null) {
      setHideTarget(null);
      setHideError("");
      // After hiding the last row of the current page, move to the previous
      // existing page instead of keeping an empty page number.
      if (page !== null && page.items.length <= 1 && filters.page > 1) {
        applyFilters({ page: filters.page - 1 });
      }
      await refreshAfterSync();
      return;
    }
    setHideError(problem.detail !== "" ? problem.detail : problem.code);
  };

  // Poll the accepted sync job until it reaches a terminal state; the list is
  // refreshed for BOTH outcomes — a failed run shows its own honest problem.
  const pollSyncJob = async (accepted: SyncAccepted): Promise<void> => {
    setSyncState({ id: accepted.operation_id, kind: "vetis.sync", state: accepted.state });
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const state = await fetchOperationState(accepted.operation_id);
      if ("code" in state) {
        setSyncError(state.detail !== "" ? state.detail : state.code);
        setSyncJob(null);
        return;
      }
      setSyncState(state);
      if (syncIsTerminal(state)) {
        setSyncJob(null);
        await refreshAfterSync();
        return;
      }
    }
  };

  const runSync = async (): Promise<void> => {
    if (labId === undefined) return;
    setSyncError("");
    const accepted = await syncArrivals(labId);
    if ("code" in accepted) {
      setSyncError(accepted.detail !== "" ? accepted.detail : accepted.code);
      return;
    }
    setSyncJob(accepted);
    await pollSyncJob(accepted);
  };

  const canSync = user !== null && SYNC_ROLES.has(user.role);
  const syncRunning = syncJob !== null;
  const syncDone =
    syncState !== null && syncJob === null && syncError === "" && syncState.state === "SUCCESS";
  const syncFailed =
    syncState !== null && syncJob === null && syncError === "" && syncState.state === "FAILED";
  // ТЗ DR22 §7: a retryable failure BETWEEN attempts is a retry-wait — the
  // operation is still pending, so NO final error is shown and the button
  // stays disabled (the polling continues on the SAME operation).
  const syncRetryWait = syncRunning && syncState?.state === "PENDING" && !!syncState.problem;
  // DR7 §6.3 + ТЗ DR22 §7: an unconfigured integration / scope / auth problem
  // is an ADMIN action — never an automatic retry, never a fake success and
  // never worded as an empty result. Every other code keeps its honest cause.
  const syncProblemText = (state: SyncOperationState): string | null => {
    switch (state.problem) {
      case "INTEGRATION_NOT_CONFIGURED":
        return "Обновление из ВетИС недоступно: интеграция не настроена. Обратитесь к администратору.";
      case "INTEGRATION_SCOPE_MISSING":
        return "Обновление из ВетИС недоступно: связь площадки с хозяйствующим субъектом не зарегистрирована. Обратитесь к администратору.";
      case "INTEGRATION_SCOPE_REVOKED":
        return "Обновление из ВетИС недоступно: доступ отозван. Обратитесь к администратору.";
      case "INTEGRATION_INITIATOR_MISSING":
        return "Обновление из ВетИС недоступно: не зарегистрирован инициатор чтения. Обратитесь к администратору.";
      case "VETIS_AUTH_ERROR":
        return "Обновление не выполнено: ВетИС отклонил доступ. Обратитесь к администратору.";
      case "VETIS_TRANSPORT_ERROR":
        return "Обновление не выполнено: сервис ВетИС временно недоступен. Повторите обновление позже.";
      case "VETIS_CURSOR_CONTRACT_VIOLATED":
        return "Обновление не выполнено: ответ ВетИС не соответствует контракту чтения. Повторите обновление позже.";
      case "VETIS_IMPORT_FAILED":
        return "Обновление не выполнено: документ не импортирован. Повторите обновление или обратитесь к администратору.";
      default:
        return null;
    }
  };
  // ТЗ DR9 §7 + DR22 §7: the honest итог of a finished pass — how many were
  // RECEIVED, suitable, imported and excluded from the active queue, plus the
  // current attempt number. An error stays an error and is never worded as
  // «ВСД не найдены».
  const syncDiagnosticsText =
    syncState !== null && (syncDone || syncFailed || syncRetryWait)
      ? (() => {
          const diagnostics = syncState.diagnostics ?? null;
          const attempt =
            diagnostics !== null && diagnostics.attempt !== undefined && diagnostics.attempt !== null
              ? Number(diagnostics.attempt)
              : null;
          if (diagnostics !== null && (syncDone || syncRetryWait)) {
            const externalTotal = Number(diagnostics.external_total ?? 0);
            const observed = Number(diagnostics.observed_uuids ?? 0);
            const imported = Number(diagnostics.kept ?? syncState.imported ?? 0);
            const marked = Number(diagnostics.marked_not_current ?? 0);
            const pages = Number(diagnostics.pages ?? syncState.pages_done ?? 0);
            const parts = [
              `Получено документов: ${externalTotal}.`,
              `Наблюдено во внешнем списке: ${observed}.`,
              `Импортировано: ${imported}.`,
            ];
            if (marked > 0) parts.push(`Исключено из активной очереди: ${marked}.`);
            parts.push(`Обработано страниц: ${pages}.`);
            if (attempt !== null) parts.push(`Попытка: ${attempt}.`);
            return parts.join(" ");
          }
          const pages = syncState.pages_done ?? null;
          const imported = syncState.imported ?? null;
          if (pages === null && imported === null) return null;
          const parts = [`Обработано страниц: ${pages ?? 0}; импортировано документов: ${imported ?? 0}.`];
          if (attempt !== null) parts.push(`Попытка: ${attempt}.`);
          return parts.join(" ");
        })()
      : null;
  const syncStatus =
    syncError !== ""
      ? syncError
      : syncRunning
        ? syncRetryWait
          ? "Повторяем обновление…"
          : "Обновление выполняется…"
        : syncDone
          ? "Поступления обновлены из ВетИС."
          : syncFailed
            ? (syncProblemText(syncState) ??
              "Обновление не выполнено: повторите позже или обратитесь к администратору.")
            : canSync
              ? "Автообновление из ВетИС каждые 15 минут"
              : "";

  if (labId === undefined) {
    return (
      <div className="vse-app vse-page">
        <h1>Поступления</h1>
        <StatusView state="not-found" title="Лаборатория не указана." />
      </div>
    );
  }

  const problem: Problem | null =
    arrivals.data !== undefined && "code" in arrivals.data ? (arrivals.data as Problem) : null;

  return (
    <div className="vse-app">
      <ArrivalsScreen
        queue={filters.queue}
        counts={counts}
        onQueueChange={(queue) => applyFilters({ queue, result: "", page: 1 })}
        q={filters.q}
        onSearch={(q) => applyFilters({ q, page: 1 })}
        result={filters.result}
        onResultChange={(result) => applyFilters({ result, page: 1 })}
        sort={filters.sort}
        onSortChange={(sort) => applyFilters({ sort, page: 1 })}
        hiddenColumns={hiddenColumns}
        onToggleColumn={(id) =>
          setHiddenColumns((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        labId={labId}
        items={page?.items ?? []}
        loading={arrivals.isPending && arrivals.data === undefined}
        problem={problem}
        onRetry={() => void arrivals.refetch()}
        page={filters.page}
        pageCount={pageCount}
        onPage={(next) => applyFilters({ page: next })}
        onHide={(partyId) => {
          const target = page?.items.find((item) => item.party_id === partyId);
          if (target === undefined) return;
          setHideError("");
          setHideTarget(target);
        }}
        sync={
          canSync ? (
            // DR29 §3: the group wrapper (status above the button) belongs to
            // the shared ArrivalsScreen composition; the page passes only the
            // button with the SAME label/variant/handler contract.
            <Button
              onClick={() => void runSync()}
              disabled={!canSync || syncRunning}
              busy={syncRunning}
              // ТЗ DR22 §7: between attempts the busy label honestly says a
              // retry is running — never a final error, never a fake success.
              busyLabel={syncRetryWait ? "Повторяем обновление…" : "Обновление…"}
              label="Обновить поступления из ВетИС"
            >
              Обновить
            </Button>
          ) : undefined
        }
        syncStatus={syncStatus}
        syncDiagnostics={syncDiagnosticsText}
      />

      <Dialog
        open={hideTarget !== null}
        onOpenChange={(open) => {
          if (!open) setHideTarget(null);
        }}
        title="Скрыть поступление из очереди?"
        description={
          hideTarget === null
            ? undefined
            : `Документ ${hideTarget.external.fields.documentUuid ?? hideTarget.external.evsd_uuid} перестанет отображаться в очереди «Ожидаемые». Сам эВСД не аннулируется: документ останется в системе и при изменении внешнего содержания появится снова.`
        }
        confirmLabel="Скрыть"
        error={hideError}
        onConfirm={() => void runHide()}
      />
    </div>
  );
}
