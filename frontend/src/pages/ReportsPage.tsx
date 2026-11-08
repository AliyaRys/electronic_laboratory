/**
 * ReportsPage (R03, API-08/AT-20): the «Отчёты» hub of one laboratory.
 *
 * HEAD/ANALYST only (VET works in the own samples scope; ADMIN is forbidden).
 * The saved reports are real rows with real links — the row itself is NOT a
 * link (the menu must not open the row by accident); the visible links are
 * keyboard-accessible <a>/<Link> elements. Deleting elsewhere is not an
 * error: a stale deep link shows the honest not-found state.
 */
import "./../features/reports/reports.css";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { useMe } from "../shared/api/me";
import { StatusView } from "../shared/ui/StatusView";
import { Button } from "../shared/ui/Button";
import {
  fetchReports,
  REPORT_ROLES,
  reportsKey,
  type ReportSummary,
  type ReportSummaryPage,
} from "../features/reports/api";

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

function halfLabel(half: number): string {
  return half === 1 ? "I полугодие" : "II полугодие";
}

function ReportsContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const role = me.user?.role ?? null;
  const allowed = role !== null && REPORT_ROLES.has(role);

  // The list page lives in the URL; going back corrects the page like every
  // other screen (API-08 list semantics, page_size from the server answer).
  const requestedPage = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const list = useQuery({
    queryKey: reportsKey(labId ?? "", requestedPage),
    queryFn: ({ signal }) => fetchReports(labId ?? "", requestedPage, signal),
    enabled: labId !== undefined && allowed,
  });

  if (labId === undefined) {
    return (
      <div className="vse-app vse-page">
        <h1>Отчёты</h1>
        <StatusView state="not-found" title="Лаборатория не указана." />
      </div>
    );
  }
  if (me.user !== null && !allowed) {
    return (
      <div className="vse-app vse-page">
        <h1>Отчёты</h1>
        <StatusView state="forbidden" title="Раздел доступен только заведующему и аналитику." />
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

  return (
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/arrivals`}>← Поступления</Link>
      </nav>
      <h1>Отчёты</h1>
      <div className="vse-report-actions">
        <Link to={`/labs/${labId}/reports/operational`}>Операционный отчёт</Link>
        <Link to={`/labs/${labId}/reports/samples`}>Учёт проб</Link>
        <Button type="button" variant="primary" onClick={() => navigate(`/labs/${labId}/reports/new`)}>
          Создать отчёт 5-вет
        </Button>
      </div>
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
                    {item.year}, {halfLabel(item.half)}
                  </Link>
                  <span>
                    Источников: {item.source_count}; сохранён{" "}
                    {new Date(item.saved_at).toLocaleString("ru-RU")}
                  </span>
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
      <p className="app-field-message">
        Экспорт PDF/XLSX и печать доступны в карточке сохранённого отчёта; файлы строятся строго из снимка и
        не пересчитываются (AT-18).
      </p>
    </div>
  );
}
