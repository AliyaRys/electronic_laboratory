/**
 * ExaminationJournalPage (E04, FT-VSE, ТЗ DR45 §1, ТЗ DR47 §2.3): the journal
 * of one laboratory at /labs/:labId/examinations, rebuilt in the composition
 * of ``journal.html`` — the two-row filter panel (3 + 2) with the «Автор»
 * label, the three-mode date popover with Moscow half-open boundaries, the
 * ``.vse-card`` rows with outcome badges, the icon-only eye action and the
 * centred pagination.
 *
 * The read model stays the scoped server query (GET /api/v1/examinations,
 * never the arrivals list): a plain URL answers the COMPLETED cards only and
 * the «Ожидание результатов» tab issues the explicit ?status=WAITING query.
 * Status, filters, the date mode and page live in the URL; changing a filter
 * resets the page to 1. Money never travels through this page; the journal
 * shows no prices at all.
 */
import "../features/examinations/examinations.css";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { JournalDateFilter, emptyJournalDate, type JournalDateValue } from "./JournalDateFilter";
import {
  fetchJournal,
  fetchJournalAuthors,
  type ExaminationJournalItem,
  type JournalAuthor,
  type JournalQuery,
} from "../features/examinations/api";
import type { Problem } from "../features/arrivals/api";
import { StatusView } from "../shared/ui/StatusView";
import { Button } from "../shared/ui/Button";
import { Tooltip } from "../shared/ui/HelpTooltip";
import { Icon } from "../shared/ui/Icon";

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

/** A datetime-local minute + one minute (the exclusive upper boundary). */
function nextMinute(datetimeLocal: string): string {
  const [day, minute = ""] = datetimeLocal.split("T");
  const [year, month, date] = day.split("-").map(Number);
  const [hours = 0, minutes = 0] = minute.split(":").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date, hours, minutes + 1));
  return `${shifted.toISOString().slice(0, 16)}:00+03:00`;
}

/** The Moscow half-open window of the committed date filter (§2.3.3). */
export function journalDateWindow(value: JournalDateValue): {
  occurred_from: string | null;
  occurred_to: string | null;
} {
  if (value.mode === "date" && value.date !== "") {
    return { occurred_from: `${value.date}T00:00:00+03:00`, occurred_to: nextDay(value.date) };
  }
  if (value.mode === "datetime" && value.moment !== "") {
    return { occurred_from: `${value.moment}:00+03:00`, occurred_to: nextMinute(value.moment) };
  }
  if (value.mode === "range") {
    return {
      occurred_from: value.from === "" ? null : `${value.from}:00+03:00`,
      occurred_to: value.to === "" ? null : nextMinute(value.to),
    };
  }
  return { occurred_from: null, occurred_to: null };
}

/** The badge of one row: computed from the ROW's status and outcome (never
 * the tab alone), so an unknown completed outcome stays neutral. */
export function journalBadgeOf(view: ExaminationJournalItem): {
  label: string;
  className: string;
} {
  if (view.status === "WAITING") {
    return { label: "Ожидание результатов", className: "vse-status-badge waiting" };
  }
  if (view.outcome === "FIT") {
    return { label: "Пригодно", className: "vse-status-badge completed-fit" };
  }
  if (view.outcome === "UNFIT") {
    return { label: "Непригодно", className: "vse-status-badge completed-unfit" };
  }
  return { label: "Итог не указан", className: "vse-status-badge completed" };
}

interface JournalPage {
  items: ExaminationJournalItem[];
  total: number;
}

const DATE_KEYS = ["date_mode", "date", "moment", "from", "to"] as const;

function journalDateOf(params: URLSearchParams): JournalDateValue {
  const modeParam = params.get("date_mode");
  const mode: JournalDateValue["mode"] =
    modeParam === "datetime" || modeParam === "range" ? modeParam : "date";
  return {
    mode,
    date: params.get("date") ?? "",
    moment: params.get("moment") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
}

function ExaminationJournalContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const [params, setParams] = useSearchParams();
  const status: JournalStatus = params.get("status") === "WAITING" ? "WAITING" : "COMPLETED";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const search = params.get("q") ?? "";
  const outcome = params.get("outcome") ?? "";
  const specialist = params.get("specialist_id") ?? "";
  const sort = params.get("sort") === "asc" ? "asc" : "desc";
  const dateValue = journalDateOf(params);

  // ТЗ DR47 §2.3.3: only the search rides a debounce (the existing 300 ms
  // window of the pricing preview); selects and the date popover send
  // immediately. React Query keys every query and a stale response can
  // never overwrite a newer one.
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const query: JournalQuery = {
    laboratory_id: labId ?? "",
    status,
    q: search === "" ? null : search,
    outcome: outcome === "" || status === "WAITING" ? null : outcome === "FIT" || outcome === "UNFIT" ? outcome : null,
    ...journalDateWindow(dateValue),
    sort,
    // §2: the specialist filter is SERVER-side — the id rides the query, so
    // the total and every page are computed over the filtered set.
    specialist_id: specialist === "" ? null : specialist,
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
      query.occurred_from ?? "",
      query.occurred_to ?? "",
      sort,
      page,
    ],
    queryFn: ({ signal }) => fetchJournal(query, signal),
    enabled: labId !== undefined,
  });
  const authors = useQuery({
    queryKey: ["examinations", "journal-authors", labId ?? null],
    queryFn: ({ signal }) => fetchJournalAuthors(labId ?? "", signal),
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
  const items: ExaminationJournalItem[] = data?.items ?? [];
  const authorsProblem =
    authors.data !== undefined && authors.data !== null && "code" in authors.data
      ? (authors.data as Problem)
      : null;
  const authorOptions: JournalAuthor[] =
    authorsProblem === null ? ((authors.data as JournalAuthor[]) ?? []) : [];

  /** A filter change always resets the page to 1 (URL state, §2.3.3). */
  const setParam = (key: string, value: string): void => {
    const url = new URLSearchParams(params);
    if (value === "") url.delete(key);
    else url.set(key, value);
    url.delete("page");
    setParams(url);
  };

  const setDateValue = (next: JournalDateValue): void => {
    const url = new URLSearchParams(params);
    for (const key of DATE_KEYS) url.delete(key);
    if (next.date !== "") url.set("date", next.date);
    if (next.moment !== "") url.set("moment", next.moment);
    if (next.from !== "") url.set("from", next.from);
    if (next.to !== "") url.set("to", next.to);
    if (next.mode !== "date" || next.date !== "" || next.from !== "" || next.to !== "") {
      url.set("date_mode", next.mode);
    }
    url.delete("page");
    setParams(url);
  };

  // The debounced commit of the search draft (Enter applies immediately).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitSearch = (value: string): void => {
    setSearchDraft(value);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setParam("q", value.trim()), 300);
  };
  const commitSearchNow = (value: string): void => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    setParam("q", value.trim());
  };

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="vse-app vse-journal-page">
      {/* ТЗ DR47 §2.3.2: no breadcrumb — the shell header owns navigation. */}
      <div className="vse-journal-title">
        <h1>Журнал ВСЭ мяса и мясопродуктов</h1>
      </div>
      {/* §2.3.1: the approved two tabs stay between the title and the filters. */}
      <div className="vse-queue-tabs vse-journal-tabs" role="tablist" aria-label="Статус карточки">
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
      <section className="vse-journal-filters" aria-label="Фильтры журнала">
        <div className="vse-journal-filters-row">
          <div className="vse-journal-filter-field">
            <label htmlFor="journal-search">Поиск</label>
            <input
              id="journal-search"
              type="search"
              placeholder="Хозяйство или UUID ВСД"
              value={searchDraft}
              onChange={(event) => commitSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitSearchNow(searchDraft);
              }}
            />
          </div>
          <div className="vse-journal-filter-field">
            <label htmlFor="journal-outcome">Итог ВСЭ</label>
            <select
              id="journal-outcome"
              value={status === "WAITING" ? "" : outcome}
              disabled={status === "WAITING"}
              onChange={(event) => setParam("outcome", event.target.value)}
            >
              <option value="">Все итоги</option>
              <option value="FIT">Пригодно</option>
              <option value="UNFIT">Непригодно</option>
            </select>
            {status === "WAITING" ? <p className="vse-journal-filter-note">Итог ещё не сформирован</p> : null}
          </div>
          <div className="vse-journal-filter-field">
            <label htmlFor="journal-specialist">Автор</label>
            <select
              id="journal-specialist"
              value={specialist}
              onChange={(event) => setParam("specialist_id", event.target.value)}
            >
              <option value="">Все авторы</option>
              {authorOptions.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="vse-journal-filters-row secondary">
          <div className="vse-journal-filter-field">
            <label htmlFor="journal-sort">Сортировка</label>
            <select
              id="journal-sort"
              value={sort}
              onChange={(event) => setParam("sort", event.target.value)}
            >
              <option value="desc">Сначала новые</option>
              <option value="asc">Сначала старые</option>
            </select>
          </div>
          <div className="vse-journal-filter-field">
            <label htmlFor="journal-date-trigger">Период обращения</label>
            <JournalDateFilter value={dateValue} onChange={setDateValue} />
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
        <div className="vse-journal-empty" role="status">
          По заданным условиям записи не найдены
        </div>
      ) : (
        <section className="vse-journal-list" aria-label="Список ВСЭ">
          {items.map((item) => (
            <JournalRow key={item.examination_id} labId={labId} view={item} />
          ))}
          <nav className="vse-pagination" aria-label="Пагинация журнала">
            <Button
              iconOnly
              label="Предыдущая страница"
              disabled={page <= 1}
              onClick={() => setParam("page", String(page - 1))}
            >
              ‹
            </Button>
            <span className="vse-pagination-page" aria-current="page">
              {page}
            </span>
            <Button
              iconOnly
              label="Следующая страница"
              disabled={data === null || page >= totalPages}
              onClick={() => setParam("page", String(page + 1))}
            >
              ›
            </Button>
            {/* The total is announced to screen readers without the visible
                «Страница N из M» text, which the mockup does not show. */}
            <span className="vse-visually-hidden" aria-live="polite">
              {`Всего страниц: ${totalPages}`}
            </span>
          </nav>
        </section>
      )}
    </div>
  );
}

export function JournalRow({
  labId,
  view,
}: {
  labId: string;
  view: ExaminationJournalItem;
}): React.ReactElement {
  const badge = journalBadgeOf(view);
  return (
    <article className="vse-journal-card">
      <div>
        <p className="vse-journal-label">Дата и время обращения</p>
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
        <p className="vse-journal-label">Автор</p>
        <p className="vse-journal-value">{view.specialist_name ?? "Название не получено"}</p>
      </div>
      <div>
        <span className={badge.className}>{badge.label}</span>
      </div>
      <div className="vse-journal-card-actions">
        <Tooltip text="Посмотреть карточку ВСЭ">
          <Link
            to={`/labs/${labId}/examinations/${view.examination_id}`}
            className="app-button secondary icon-only"
            aria-label="Посмотреть карточку ВСЭ"
          >
            <Icon name="admin-view" />
          </Link>
        </Tooltip>
      </div>
    </article>
  );
}
