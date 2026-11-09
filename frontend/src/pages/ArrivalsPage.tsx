/**
 * Arrivals queues (FT-ARR-01/02, ui-mapping: working arrivals →
 * /labs/:labId/arrivals): the EXPECTED/WORK/ACCEPTED queues of one
 * laboratory. Filters/search/page live in the URL (FT-COM-01/02), rows open
 * the real party id. The refresh button (ТЗ-10, VET/HEAD only) posts the
 * SAME durable sync job the 15-minute scheduler runs and polls
 * GET /operations/:id — an honest failed run is shown, never a fake import.
 */
import "../features/arrivals/arrivals.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import {
  fetchArrivals,
  fetchOperationState,
  hideArrival,
  QUEUE_LABELS,
  RESULT_LABELS,
  revisionEtag,
  syncArrivals,
  syncIsTerminal,
  type ArrivalQueue,
  type ArrivalResult,
  type IncomingView,
  type Problem,
  type SyncAccepted,
  type SyncOperationState,
} from "../features/arrivals/api";
import { ArrivalList } from "../features/arrivals/ArrivalList";
import { useMe } from "../shared/api/me";
import { Button } from "../shared/ui/Button";
import { Dialog } from "../shared/ui/Dialog";
import { StatusView } from "../shared/ui/StatusView";

const QUEUES: readonly ArrivalQueue[] = ["EXPECTED", "WORK", "ACCEPTED"];
const RESULTS: readonly ArrivalResult[] = ["WAITING", "RETURNED", "COMPLETED"];
const SYNC_ROLES = new Set(["VET", "HEAD"]);
const POLL_INTERVAL_MS = 1500;

interface Filters {
  queue: ArrivalQueue;
  result: string;
  q: string;
  page: number;
}

function filtersFromParams(params: URLSearchParams): Filters {
  const queue = (params.get("queue") ?? "EXPECTED").toUpperCase() as ArrivalQueue;
  return {
    queue: QUEUES.includes(queue) ? queue : "EXPECTED",
    result: params.get("result") ?? "",
    q: params.get("q") ?? "",
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
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
  const queryClient = useQueryClient();
  const { user } = useMe();
  const filters = filtersFromParams(params);
  const searchRef = useRef<HTMLInputElement>(null);
  const [hideTarget, setHideTarget] = useState<IncomingView | null>(null);
  const [hideError, setHideError] = useState("");
  const [syncJob, setSyncJob] = useState<SyncAccepted | null>(null);
  const [syncError, setSyncError] = useState("");
  const [syncState, setSyncState] = useState<SyncOperationState | null>(null);

  const arrivals = useQuery({
    queryKey: [null, labId ?? null, null, "/arrivals", filters],
    queryFn: ({ signal }) =>
      fetchArrivals(
        {
          laboratory_id: labId ?? "",
          queue: filters.queue,
          result: filters.result === "" ? null : (filters.result as ArrivalResult),
          q: filters.q === "" ? null : filters.q,
          page: filters.page,
        },
        signal,
      ),
    enabled: labId !== undefined,
  });

  const page = arrivals.data !== undefined && !("code" in arrivals.data) ? arrivals.data : null;

  const applyFilters = (next: Partial<Filters>): void => {
    const merged = { ...filters, ...next };
    const search = new URLSearchParams();
    search.set("queue", merged.queue.toLowerCase());
    if (merged.result !== "") search.set("result", merged.result.toLowerCase());
    if (merged.q !== "") search.set("q", merged.q);
    if (merged.page > 1) search.set("page", String(merged.page));
    setParams(search);
  };

  const runHide = async (): Promise<void> => {
    if (hideTarget === null) return;
    const problem = await hideArrival(hideTarget.party_id, revisionEtag(hideTarget), crypto.randomUUID());
    if (problem === null) {
      setHideTarget(null);
      setHideError("");
      await queryClient.invalidateQueries({ queryKey: [null, labId ?? null, null, "/arrivals"] });
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
        await queryClient.invalidateQueries({ queryKey: [null, labId ?? null, null, "/arrivals"] });
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
  const syncHint =
    syncError !== ""
      ? syncError
      : syncRunning
        ? "Обновление выполняется…"
        : syncDone
          ? "Поступления обновлены из ВетИС."
          : syncFailed
            ? "Обновление не выполнено: повторите позже или обратитесь к администратору."
            : "Обновление поступлений из ВетИС выполняется автоматически каждые 15 минут.";

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
    <div className="vse-app vse-page">
      <h1>Поступления</h1>
      <div className="vse-panel">
        <div className="vse-queue-tabs" role="tablist" aria-label="Очереди поступлений">
          {QUEUES.map((queue) => (
            <button
              key={queue}
              type="button"
              role="tab"
              className="vse-queue-tab"
              aria-selected={filters.queue === queue}
              aria-disabled={filters.queue === queue}
              onClick={() => applyFilters({ queue, result: "", page: 1 })}
            >
              {QUEUE_LABELS[queue]}
            </button>
          ))}
        </div>

        <form
          className="vse-arrival-controls"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters({ q: searchRef.current?.value ?? "", page: 1 });
          }}
        >
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="arrivals-q">Поиск (документ, продукция)</label>
            </div>
            <input id="arrivals-q" ref={searchRef} type="text" defaultValue={filters.q} key={filters.q} />
          </div>
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="arrivals-result">Результат</label>
            </div>
            <select
              id="arrivals-result"
              value={filters.result}
              onChange={(event) => applyFilters({ result: event.target.value, page: 1 })}
            >
              <option value="">Все результаты</option>
              {RESULTS.map((result) => (
                <option key={result} value={result}>
                  {RESULT_LABELS[result]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Button type="submit" variant="primary">
              Найти
            </Button>
          </div>
          <div>
            <Button
              onClick={() => void runSync()}
              disabled={!canSync || syncRunning}
              label={
                canSync
                  ? "Обновить поступления из ВетИС"
                  : "Обновление доступно только ветврачу и заведующему"
              }
            >
              Обновить
            </Button>
          </div>
        </form>
        <p className="vse-arrival-hint app-field-message" role="status">
          {syncHint}
        </p>

        {arrivals.isLoading ? (
          <StatusView state="loading" title="Загрузка поступлений…" />
        ) : problem !== null ? (
          <StatusView
            state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
            title={problem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить поступления."}
            detail={problem.detail}
            trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
            onRetry={() => void arrivals.refetch()}
          />
        ) : (
          <>
            <ArrivalList
              labId={labId}
              items={page?.items ?? []}
              onHide={(partyId) => {
                const target = page?.items.find((item) => item.party_id === partyId);
                if (target === undefined) return;
                setHideError("");
                setHideTarget(target);
              }}
            />
            <nav className="vse-pagination" aria-label="Страницы списка поступлений">
              <Button
                onClick={() => applyFilters({ page: filters.page - 1 })}
                disabled={filters.page <= 1}
                label="Предыдущая страница"
                iconOnly
                icon="caret"
              >
                ‹
              </Button>
              <span>
                Страница {page?.page ?? filters.page} из{" "}
                {page !== null ? Math.max(1, Math.ceil(page.total / page.page_size)) : 1}
              </span>
              <Button
                onClick={() => applyFilters({ page: filters.page + 1 })}
                disabled={page === null || page.page * page.page_size >= page.total}
                label="Следующая страница"
                iconOnly
                icon="caret"
              >
                ›
              </Button>
            </nav>
          </>
        )}
      </div>

      <Dialog
        open={hideTarget !== null}
        onOpenChange={(open) => {
          if (!open) setHideTarget(null);
        }}
        title="Скрыть поступление из очереди?"
        description={
          hideTarget === null
            ? undefined
            : `Документ ${hideTarget.external.fields.documentNumber ?? ""} перестанет отображаться в очереди «Ожидается». Сам эВСД не аннулируется: документ останется в системе и при изменении внешнего содержания появится снова.`
        }
        confirmLabel="Скрыть"
        error={hideError}
        onConfirm={() => void runHide()}
      />
    </div>
  );
}
