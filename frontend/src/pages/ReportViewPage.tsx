/**
 * ReportViewPage (R03, API-08): one saved snapshot = summary + form.
 *
 * The whole card is the stored snapshot: the matrix is rendered from the
 * payload and never recomputed; the summary shows the saved metadata. A
 * report deleted elsewhere answers 404 — the honest not-found state, not an
 * error. Exports/print/delete come from {@link ReportActions}.
 */
import "./../features/reports/reports.css";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { StatusView } from "../shared/ui/StatusView";
import { appliedRangeLabel } from "../shared/ui/DateRangePopover";
import { ReportMatrix } from "../features/reports/ReportMatrix";
import { ReportActions } from "../features/reports/ReportActions";
import { fetchReport, reportKey, type ReportSnapshotView } from "../features/reports/api";
import { reportAccess } from "../features/reports/reportCapabilities";
import { useMe } from "../shared/api/me";

export function ReportViewPage(): React.ReactElement {
  return (
    <RequireSession>
      <ReportViewContent />
    </RequireSession>
  );
}

function isProblem(data: unknown): data is { code: string; detail: string; trace_id?: string } {
  return typeof data === "object" && data !== null && "code" in data && "detail" in data;
}

function ReportViewContent(): React.ReactElement {
  const { labId, reportId } = useParams<{ labId: string; reportId: string }>();
  const navigate = useNavigate();
  const me = useMe();
  const access = reportAccess(me.user?.capabilities);

  const report = useQuery({
    queryKey: reportKey(reportId ?? ""),
    queryFn: ({ signal }) => fetchReport(reportId ?? "", signal),
    // Without ``report:5vet-read`` the snapshot endpoint is never requested.
    enabled: reportId !== undefined && access.read5vet,
  });

  if (me.user !== null && !access.read5vet) {
    return (
      <div className="vse-app vse-page">
        <h1>Отчёт 5-вет (раздел III)</h1>
        <StatusView
          state="forbidden"
          title="Просмотр отчёта недоступен: у вас нет полномочия чтения отчётов."
        />
      </div>
    );
  }
  if (reportId === undefined) {
    return (
      <div className="vse-app vse-page">
        <h1>Просмотр отчёта</h1>
        <StatusView state="not-found" title="Отчёт не указан." />
      </div>
    );
  }

  const problem = isProblem(report.data) ? report.data : null;
  const view: ReportSnapshotView | null =
    problem === null ? ((report.data ?? null) as ReportSnapshotView | null) : null;

  const payload: Record<string, unknown> = (view?.payload ?? {}) as Record<string, unknown>;
  const laboratory =
    typeof payload["laboratory"] === "object" && payload["laboratory"] !== null
      ? String((payload["laboratory"] as Record<string, unknown>)["name"] ?? "")
      : "";
  // The marking follows the SAVED payload's official flag, never live state.
  const official = payload["official"] === true;
  const savedAt = view !== null ? new Date(view.saved_at).toLocaleString("ru-RU") : "";

  return (
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/reports`}>← Отчёты</Link>
      </nav>
      <h1>Отчёт 5-вет (раздел III)</h1>
      {problem !== null ? (
        <StatusView
          state={
            problem.code === "NOT_FOUND"
              ? "not-found"
              : problem.code === "ACCESS_DENIED"
                ? "forbidden"
                : "network-error"
          }
          title={
            problem.code === "NOT_FOUND"
              ? "Отчёт не найден: возможно, он был удалён другим пользователем."
              : undefined
          }
          detail={problem.detail}
          trace={problem.trace_id}
          onRetry={() => void report.refetch()}
        />
      ) : report.isLoading ? (
        <StatusView state="loading" title="Загрузка отчёта…" />
      ) : view !== null ? (
        <>
          <dl className="vse-report-summary">
            <div>
              <dt>Отчёт</dt>
              <dd>5-вет, раздел III</dd>
            </div>
            <div>
              <dt>Период</dt>
              <dd>Период: {appliedRangeLabel({ from: view.date_from, to: view.date_to })}</dd>
            </div>
            <div>
              <dt>Лаборатория</dt>
              <dd>{laboratory !== "" ? laboratory : view.laboratory_id}</dd>
            </div>
            <div>
              <dt>Источников в снимке</dt>
              <dd>{view.source_count}</dd>
            </div>
            <div>
              <dt>Сохранён</dt>
              <dd>{savedAt}</dd>
            </div>
            <div>
              <dt>Коды шапки</dt>
              <dd>
                {Object.entries(view.codes)
                  .map(([key, value]) => `${key.toUpperCase()} ${value}`)
                  .join("; ")}
              </dd>
            </div>
          </dl>
          <ReportMatrix
            payload={payload}
            sourceCount={view.source_count}
            official={official}
            caption="Матрица сохранённого отчёта"
          />
          <ReportActions
            view={view}
            canExport={access.export5vet}
            canDelete={access.delete5vet}
            onDeleted={() => navigate(`/labs/${labId}/reports`, { replace: true })}
          />
        </>
      ) : null}
    </div>
  );
}
