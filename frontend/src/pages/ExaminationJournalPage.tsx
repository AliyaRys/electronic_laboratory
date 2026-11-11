/**
 * ExaminationJournalPage (E04, FT-VSE): the journal of one laboratory at
 * /labs/:labId/examinations.
 *
 * The journal lists only real examination cards (real UUIDs, no fixtures):
 * the WAITING/COMPLETED tabs come from the arrivals result projection, and
 * every row links to the actual card. WAITING and COMPLETED are visibly and
 * textually distinguishable (text + color, never color alone).
 */
import "../features/examinations/examinations.css";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchArrivals, type ArrivalResult, type IncomingView } from "../features/arrivals/api";
import type { Problem } from "../features/arrivals/api";
import { StatusView } from "../shared/ui/StatusView";
import { Button } from "../shared/ui/Button";

export function ExaminationJournalPage(): React.ReactElement {
  return (
    <RequireSession>
      <ExaminationJournalContent />
    </RequireSession>
  );
}

const RESULTS: readonly ("WAITING" | "COMPLETED")[] = ["WAITING", "COMPLETED"];
const RESULT_HEADINGS: Readonly<Record<"WAITING" | "COMPLETED", string>> = Object.freeze({
  WAITING: "Ожидание результатов",
  COMPLETED: "Завершённые",
});

function badgeClass(status: ArrivalResult): string {
  return status === "COMPLETED" ? "completed" : "waiting";
}

function ExaminationJournalContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const [params, setParams] = useSearchParams();
  const status: "WAITING" | "COMPLETED" = params.get("status") === "COMPLETED" ? "COMPLETED" : "WAITING";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const search = params.get("q") ?? "";

  const rows = useQuery({
    queryKey: [labId ?? null, "examination-journal", status, page, search],
    queryFn: ({ signal }) =>
      fetchArrivals(
        { laboratory_id: labId ?? "", result: status, q: search === "" ? null : search, page },
        signal,
      ),
    enabled: labId !== undefined,
  });

  if (labId === undefined) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="not-found" title="Лаборатория не указана." />
      </div>
    );
  }

  const problem = problemOf(rows.data);
  const data = rows.data !== undefined && !("code" in rows.data) ? rows.data : null;
  const items: IncomingView[] = (data?.items ?? []).filter((item) => item.examination_id !== null);

  const setStatus = (next: ArrivalResult): void => {
    const url = new URLSearchParams(params);
    url.set("status", next);
    url.delete("page");
    setParams(url);
  };

  return (
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/arrivals`}>← Поступления</Link>
      </nav>
      <h1>Журнал ВСЭ</h1>
      <div className="vse-journal-filter">
        <div className="vse-queue-tabs" role="tablist" aria-label="Статус карточки">
          {RESULTS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={status === value}
              className="vse-queue-tab"
              onClick={() => setStatus(value)}
            >
              {RESULT_HEADINGS[value]}
            </button>
          ))}
        </div>
      </div>
      {problem !== null ? (
        <StatusView
          state="network-error"
          title="Не удалось загрузить журнал."
          detail={problem.detail}
          onRetry={() => void rows.refetch()}
        />
      ) : rows.isLoading ? (
        <StatusView state="loading" title="Загрузка журнала…" />
      ) : items.length === 0 ? (
        <StatusView state="empty" title="Карточек в этом статусе нет." />
      ) : (
        <section className="vse-journal-list" aria-label="Список ВСЭ">
          {items.map((item) => (
            <JournalRow
              key={item.examination_id ?? item.party_id}
              labId={labId}
              view={item}
              status={status}
            />
          ))}
          <nav className="vse-pagination" aria-label="Страницы журнала">
            <Button
              iconOnly
              label="Предыдущая страница"
              disabled={page <= 1}
              onClick={() => {
                const url = new URLSearchParams(params);
                url.set("page", String(page - 1));
                setParams(url);
              }}
            >
              ‹
            </Button>
            <span aria-live="polite">{`Страница ${page} из ${Math.max(1, Math.ceil((data?.total ?? 0) / (data?.page_size ?? 20)))}`}</span>
            <Button
              iconOnly
              label="Следующая страница"
              disabled={data === null || page >= Math.ceil(data.total / data.page_size)}
              onClick={() => {
                const url = new URLSearchParams(params);
                url.set("page", String(page + 1));
                setParams(url);
              }}
            >
              ›
            </Button>
          </nav>
        </section>
      )}
    </div>
  );
}

export function JournalRow({
  labId,
  view,
  status,
}: {
  labId: string;
  view: IncomingView;
  status: ArrivalResult;
}): React.ReactElement {
  const waiting = badgeClass(status) === "waiting";
  return (
    <article className="vse-journal-row">
      <div>
        <p className="vse-journal-label">Дата подтверждения</p>
        <p className="vse-journal-value">{view.confirmation?.confirmed_at ?? "—"}</p>
      </div>
      <div>
        <p className="vse-journal-label">Хозяйство</p>
        <p className="vse-journal-value">{view.external.fields.consignor ?? "—"}</p>
      </div>
      <div>
        <p className="vse-journal-label">UUID ВСД</p>
        <p className="vse-journal-value">{view.external.fields.documentUuid ?? "—"}</p>
      </div>
      <div>
        <span className={`vse-status-badge ${waiting ? "waiting" : "completed"}`}>
          {waiting ? "Ожидание результатов" : "Завершено"}
        </span>
      </div>
      <div>
        <Link
          to={`/labs/${labId}/examinations/${view.examination_id ?? ""}`}
          aria-label={`Просмотр карточки ВСЭ, UUID ВСД ${view.external.fields.documentUuid ?? "не указан"}`}
        >
          Просмотр
        </Link>
      </div>
    </article>
  );
}

function problemOf(data: unknown): Problem | null {
  return data !== undefined && data !== null && typeof data === "object" && "code" in data
    ? (data as Problem)
    : null;
}
