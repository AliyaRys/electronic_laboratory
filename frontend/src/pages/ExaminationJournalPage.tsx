/**
 * ExaminationJournalPage (E04, FT-VSE, ТЗ DR45 §1): the journal of one
 * laboratory at /labs/:labId/examinations.
 *
 * The journal is its OWN scoped server read model (GET /api/v1/examinations,
 * never the arrivals list): a plain URL answers the COMPLETED cards only and
 * the «Ожидание результатов» tab issues the explicit ?status=WAITING query.
 * Every row shows the already-resolved display values of the API — the ФИО
 * of the specialist (frozen at save time, never the raw created_by), the
 * eVSD UUID of the party, the outcome badge — and links to the real card.
 * The status, filters, sort and page live in the URL: a reload restores the
 * view, changing a filter resets the page to 1.
 */
import "../features/examinations/examinations.css";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchJournal, type ExaminationJournalItem, type JournalQuery } from "../features/examinations/api";
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

const STATUSES = ["COMPLETED", "WAITING"] as const;
type JournalStatus = (typeof STATUSES)[number];

const STATUS_HEADINGS: Readonly<Record<JournalStatus, string>> = Object.freeze({
  COMPLETED: "Завершённые",
  WAITING: "Ожидание результатов",
});

const OUTCOME_LABELS: Readonly<Record<"FIT" | "UNFIT", string>> = Object.freeze({
  FIT: "Пригодно",
  UNFIT: "Непригодно",
});

const PAGE_SIZE = 20;

const MOSCOW = "Europe/Moscow";

/** The exclusive upper boundary of a Moscow calendar day (ТЗ DR45 §2: [from; to)). */
function nextDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return `${date.toISOString().slice(0, 10)}T00:00:00+03:00`;
}

/** dd.mm.yyyy hh:mm in Europe/Moscow (ТЗ DR45 §1). */
export function formatJournalMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("day")}.${pick("month")}.${pick("year")} ${pick("hour")}:${pick("minute")}`;
}

function badgeClass(status: string): string {
  return status === "COMPLETED" ? "completed" : "waiting";
}

function ExaminationJournalContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const [params, setParams] = useSearchParams();
  const status: JournalStatus = params.get("status") === "WAITING" ? "WAITING" : "COMPLETED";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const search = params.get("q") ?? "";
  const outcome = params.get("outcome") ?? "";
  const specialist = params.get("specialist_id") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const sort = params.get("sort") === "asc" ? "asc" : "desc";

  const query: JournalQuery = {
    laboratory_id: labId ?? "",
    status,
    q: search === "" ? null : search,
    outcome: outcome === "" ? null : outcome === "FIT" || outcome === "UNFIT" ? outcome : null,
    occurred_from: from === "" ? null : `${from}T00:00:00+03:00`,
    occurred_to: to === "" ? null : nextDay(to),
    sort,
    page,
  };

  const rows = useQuery({
    queryKey: [
      "examinations",
      "journal",
      labId ?? null,
      status,
      search,
      outcome,
      specialist,
      from,
      to,
      sort,
      page,
    ],
    queryFn: ({ signal }) => fetchJournal(query, signal),
    enabled: labId !== undefined,
  });

  if (labId === undefined) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="not-found" title="Лаборатория не указана." />
      </div>
    );
  }

  const problem =
    rows.data !== undefined && rows.data !== null && "code" in rows.data ? (rows.data as Problem) : null;
  const data = problem === null && rows.data !== undefined ? (rows.data as JournalPage) : null;
  const allItems: ExaminationJournalItem[] = data?.items ?? [];
  const items = specialist === "" ? allItems : allItems.filter((item) => item.specialist_id === specialist);
  const specialists = new Map(
    allItems
      .filter((item) => item.specialist_name !== null)
      .map((item) => [item.specialist_id, item.specialist_name as string]),
  );

  const setParam = (key: string, value: string): void => {
    const url = new URLSearchParams(params);
    if (value === "") url.delete(key);
    else url.set(key, value);
    if (key !== "page") url.delete("page");
    setParams(url);
  };

  return (
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/arrivals`}>← Поступления</Link>
      </nav>
      <h1>Журнал ВСЭ по мясопродуктам</h1>
      <section className="vse-journal-filters" aria-label="Фильтры журнала">
        <div className="vse-journal-filter-field">
          <label htmlFor="journal-search">Поиск</label>
          <input
            id="journal-search"
            type="search"
            placeholder="Номер, клеймо или UUID ВСД"
            defaultValue={search}
            onChange={(event) => setParam("q", event.target.value.trim())}
          />
        </div>
        <div className="vse-journal-filter-field">
          <label htmlFor="journal-outcome">Итог ВСЭ</label>
          <select
            id="journal-outcome"
            value={outcome}
            onChange={(event) => setParam("outcome", event.target.value)}
          >
            <option value="">Все итоги</option>
            <option value="FIT">Пригодно</option>
            <option value="UNFIT">Непригодно</option>
          </select>
        </div>
        <div className="vse-journal-filter-field">
          <label htmlFor="journal-specialist">Врач</label>
          <select
            id="journal-specialist"
            value={specialist}
            onChange={(event) => setParam("specialist_id", event.target.value)}
          >
            <option value="">Все врачи</option>
            {[...specialists.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="vse-journal-filter-field">
          <label htmlFor="journal-sort">Сортировка</label>
          <select id="journal-sort" value={sort} onChange={(event) => setParam("sort", event.target.value)}>
            <option value="desc">Сначала новые</option>
            <option value="asc">Сначала старые</option>
          </select>
        </div>
      </section>
      <section className="vse-journal-filter" aria-label="Период и статус">
        <div className="vse-queue-tabs" role="tablist" aria-label="Статус карточки">
          {STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={status === value}
              className="vse-queue-tab"
              onClick={() => setParam("status", value === "COMPLETED" ? "" : value)}
            >
              {STATUS_HEADINGS[value]}
            </button>
          ))}
        </div>
        <div className="vse-journal-period">
          <div className="vse-journal-filter-field">
            <label htmlFor="journal-from">Период завершения с</label>
            <input
              id="journal-from"
              type="date"
              value={from}
              onChange={(event) => setParam("from", event.target.value)}
            />
          </div>
          <div className="vse-journal-filter-field">
            <label htmlFor="journal-to">по</label>
            <input
              id="journal-to"
              type="date"
              value={to}
              onChange={(event) => setParam("to", event.target.value)}
            />
          </div>
        </div>
      </section>
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
            <JournalRow key={item.examination_id} labId={labId} view={item} status={status} />
          ))}
          <nav className="vse-pagination" aria-label="Страницы журнала">
            <Button
              iconOnly
              label="Предыдущая страница"
              disabled={page <= 1}
              onClick={() => setParam("page", String(page - 1))}
            >
              ‹
            </Button>
            <span aria-live="polite">
              {`Страница ${page} из ${Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))}`}
            </span>
            <Button
              iconOnly
              label="Следующая страница"
              disabled={data === null || page >= Math.ceil(data.total / PAGE_SIZE)}
              onClick={() => setParam("page", String(page + 1))}
            >
              ›
            </Button>
          </nav>
        </section>
      )}
    </div>
  );
}

interface JournalPage {
  items: ExaminationJournalItem[];
  total: number;
}

export function JournalRow({
  labId,
  view,
  status,
}: {
  labId: string;
  view: ExaminationJournalItem;
  status: JournalStatus;
}): React.ReactElement {
  const waiting = badgeClass(status) === "waiting";
  const outcomeLabel =
    !waiting && (view.outcome === "FIT" || view.outcome === "UNFIT") ? OUTCOME_LABELS[view.outcome] : null;
  return (
    <article className="vse-journal-row">
      <div>
        <p className="vse-journal-label">Дата и время внесения</p>
        <p className="vse-journal-value">{formatJournalMoment(view.created_at)}</p>
      </div>
      <div>
        <p className="vse-journal-label">Хозяйство</p>
        <p className="vse-journal-value">{view.consignor_name ?? "Название не получено"}</p>
      </div>
      <div>
        <p className="vse-journal-label">UUID ВСД</p>
        <p className="vse-journal-value">{view.evsd_uuid}</p>
      </div>
      <div>
        <p className="vse-journal-label">Врач</p>
        <p className="vse-journal-value">{view.specialist_name ?? "Название не получено"}</p>
      </div>
      <div>
        <span className={`vse-status-badge ${waiting ? "waiting" : "completed"}`}>
          {waiting ? "Ожидание результатов" : (outcomeLabel ?? "Завершено")}
        </span>
      </div>
      <div>
        <Link
          to={`/labs/${labId}/examinations/${view.examination_id}`}
          aria-label={`Просмотр карточки ВСЭ, UUID ВСД ${view.evsd_uuid}`}
        >
          Просмотр
        </Link>
      </div>
    </article>
  );
}
