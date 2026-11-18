/**
 * ReportsPage (R03, API-08/AT-20, DR37): the «Отчёты» hub of one laboratory.
 *
 * The hub is capability-driven (FT-RPT-01, O-05): only the directions
 * permitted by GET /me capabilities are shown, and no direction is opened by
 * the role name — the server re-checks the scope on every request. VET sees
 * only «Учёт проб»; ADMIN (no reporting capability) gets the honest forbidden
 * state without a single report/sample request. The saved reports are real
 * rows with real links — the row itself is NOT a link (the menu must not open
 * the row by accident); the visible links are keyboard-accessible <a>/<Link>
 * elements. Deleting elsewhere is not an error: a stale deep link shows the
 * honest not-found state.
 */
import "./../features/reports/reports.css";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { useMe } from "../shared/api/me";
import { fetchLaboratoryOptions, type LaboratoryOption } from "../features/identity/api";
import { StatusView } from "../shared/ui/StatusView";
import { Button } from "../shared/ui/Button";
import { appliedRangeLabel } from "../shared/ui/DateRangePopover";
import {
  fetchReports,
  reportsKey,
  type ReportSummary,
  type ReportSummaryPage,
} from "../features/reports/api";
import { reportAccess } from "../features/reports/reportCapabilities";
import { ReportHubItem } from "../features/reports/ReportHubItem";

export function ReportsPage(): React.ReactElement {
  return (
    <RequireSession>
      <ReportsContent />
    </RequireSession>
  );
}

function isProblem(data: unknown): data is { code: string; detail: string; trace_id?: string } {
  return typeof data === "object" && data !== null && "code" in data && "detail" in data;
}

function periodLabel(item: ReportSummary): string {
  return appliedRangeLabel({ from: item.date_from, to: item.date_to });
}

function ReportsContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const access = reportAccess(me.user?.capabilities);

  // The list page lives in the URL; going back corrects the page like every
  // other screen (API-08 list semantics, page_size from the server answer).
  const requestedPage = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const list = useQuery({
    queryKey: reportsKey(labId ?? "", requestedPage),
    queryFn: ({ signal }) => fetchReports(labId ?? "", requestedPage, signal),
    // Without ``report:5vet-list`` the list endpoint is never requested —
    // a hidden affordance does not replace the capability gate (DR37 §7).
    enabled: labId !== undefined && me.user !== null && access.any && access.list5vet,
  });

  // The human-readable laboratory name comes from the purpose-built scoped
  // endpoint (the same allowed set as context:list); a UUID is never the
  // main visible name (DR37 §6).
  const labName = useQuery({
    queryKey: [me.user?.id ?? null, labId ?? null, null, "/contexts/laboratories", null],
    queryFn: ({ signal }) => fetchLaboratoryOptions(signal),
    enabled: me.user !== null && labId !== undefined && access.any,
  });
  const laboratoryName: string | null = Array.isArray(labName.data)
    ? ((labName.data as LaboratoryOption[]).find((option) => option.laboratory_id === labId)?.name ?? null)
    : null;

  if (labId === undefined) {
    return (
      <div className="vse-app vse-page">
        <h1>Отчёты</h1>
        <StatusView state="not-found" title="Лаборатория не выбрана." />
        <p className="app-field-message">
          Формирование отчётности выполняется в контексте одной лаборатории.{" "}
          <Link to="/labs">Выбрать лабораторию</Link>
        </p>
      </div>
    );
  }
  if (me.user !== null && !access.any) {
    return (
      <div className="vse-app vse-page">
        <h1>Отчёты</h1>
        <StatusView state="forbidden" title="Раздел отчётов недоступен: у вас нет отчётных полномочий." />
      </div>
    );
  }

  const problem = isProblem(list.data) ? list.data : null;
  const data: ReportSummaryPage | null =
    problem === null ? ((list.data ?? null) as ReportSummaryPage | null) : null;
  const items: ReportSummary[] = data?.items ?? [];
  const pageSize = data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  // A delete elsewhere can shrink the list: an out-of-range URL corrects itself.
  const page = Math.min(requestedPage, totalPages);
  const setPage = (next: number): void => {
    const url = new URLSearchParams(params);
    if (next <= 1) {
      url.delete("page");
    } else {
      url.set("page", String(next));
    }
    setParams(url);
  };

  // Honest meta (fix-loop DR37): the «пока нет» empty text may be shown only
  // when the list is really loaded and empty (list access). Without
  // ``report:5vet-list`` the list was never requested — the meta must not
  // promise anything, a neutral "unavailable" note instead.
  const fiveVetMeta =
    problem !== null
      ? null
      : !access.list5vet
        ? null
        : list.isLoading
          ? "Загрузка списка сохранённых отчётов…"
          : (data?.total ?? 0) === 0
            ? "Сохранённых отчётов пока нет."
            : `Сохранённых отчётов: ${data?.total ?? 0}. Список — ниже на этой странице.`;

  return (
    <div className="vse-app vse-page vse-reports-hub">
      {/* ТЗ DR41 §4: the hub carries no «← Поступления» breadcrumb; the header
          navigation and nested report routes stay unchanged. */}
      <div className="vse-reports-title-row">
        <div>
          <h1>Отчёты</h1>
          <p className="vse-reports-subtitle">
            Формирование регламентированной отчётности по доступным лабораториям.
          </p>
          {laboratoryName !== null ? <p className="vse-reports-lab">{laboratoryName}</p> : null}
        </div>
        {access.create5vet ? (
          <Button type="button" variant="primary" onClick={() => navigate(`/labs/${labId}/reports/new`)}>
            Создать отчёт
          </Button>
        ) : null}
      </div>
      <section className="vse-reports-card" aria-label="Направления отчётов">
        <div className="vse-reports-hub-list">
          {access.list5vet || access.read5vet || access.create5vet ? (
            <ReportHubItem
              name="Форма 5-вет (раздел III)"
              // DR37 fix-loop: a preview+save operator without list/read sees
              // the direction honestly: create is available, the saved list
              // and the saved cards are not.
              meta={
                fiveVetMeta ??
                (access.create5vet && !access.list5vet && !access.read5vet
                  ? "Создание отчёта доступно; список сохранённых отчётов и просмотр не входят в ваши полномочия."
                  : "Список сохранённых отчётов недоступен.")
              }
            />
          ) : null}
          {access.operational ? (
            <ReportHubItem
              name="Операционные показатели"
              meta="Показатели работы лаборатории за выбранный период."
              to={`/labs/${labId}/reports/operational`}
              actionLabel="Открыть: Операционные показатели"
            />
          ) : null}
          {access.samples ? (
            <ReportHubItem
              name="Учёт проб"
              meta="Остатки проб и история утилизации."
              to={`/labs/${labId}/reports/samples`}
              actionLabel="Открыть: Учёт проб"
            />
          ) : null}
        </div>
      </section>
      {access.list5vet ? (
        <section className="vse-report-block" aria-label="Сохранённые отчёты">
          <h2>Сохранённые отчёты 5-вет (раздел III)</h2>
          {problem !== null ? (
            <StatusView
              state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
              title={problem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить список отчётов."}
              detail={problem.detail}
              trace={problem.trace_id}
              onRetry={() => void list.refetch()}
            />
          ) : list.isLoading ? (
            <StatusView state="loading" title="Загрузка отчётов…" />
          ) : items.length === 0 ? (
            <StatusView state="empty" title="Сохранённых отчётов пока нет." />
          ) : (
            <>
              <ul className="vse-reports-list">
                {items.map((item) => (
                  <li key={item.id} className="vse-report-row">
                    <Link to={`/labs/${labId}/reports/${item.id}`}>
                      Период: {periodLabel(item)}
                    </Link>
                    <span>
                      Источников: {item.source_count}; сохранён{" "}
                      {new Date(item.saved_at).toLocaleString("ru-RU")}
                      {laboratoryName !== null ? ` · ${laboratoryName}` : ""}
                    </span>
                    <Link
                      className="app-button secondary"
                      to={`/labs/${labId}/reports/${item.id}`}
                      aria-label={`Открыть: период ${periodLabel(item)}`}
                    >
                      Открыть
                    </Link>
                  </li>
                ))}
              </ul>
              <nav className="vse-pagination" aria-label="Страницы списка отчётов">
                <Button
                  iconOnly
                  label="Предыдущая страница"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  ‹
                </Button>
                <span aria-live="polite">
                  {`Страница ${page} из ${totalPages} — показано ${items.length} из ${data?.total ?? items.length}`}
                </span>
                <Button
                  iconOnly
                  label="Следующая страница"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  ›
                </Button>
              </nav>
            </>
          )}
        </section>
      ) : null}
      {access.list5vet ? (
        <p className="app-field-message">
          Экспорт PDF/XLSX и печать доступны в карточке сохранённого отчёта; файлы строятся строго из снимка и
          не пересчитываются (AT-18).
        </p>
      ) : null}
    </div>
  );
}
