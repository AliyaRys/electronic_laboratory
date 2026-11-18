/**
 * OperationalReportPage (R03, API-08): the operational indicators of one
 * laboratory over a chosen period (DR48 §2). The three metrics are
 * «Сохранённых ВСЭ», идентификаций продукции and оценок транспорта — the
 * sample balances are NOT part of the endpoint and are never shown here.
 * HEAD/ANALYST only (AT-20); VET/ADMIN get the honest forbidden state.
 */
import "./../features/reports/reports.css";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { useMe } from "../shared/api/me";
import { StatusView } from "../shared/ui/StatusView";
import { Button } from "../shared/ui/Button";
import { fetchOperational, operationalKey, type OperationalView } from "../features/reports/api";
import { reportAccess } from "../features/reports/reportCapabilities";

export function OperationalReportPage(): React.ReactElement {
  return (
    <RequireSession>
      <OperationalContent />
    </RequireSession>
  );
}

function isProblem(data: unknown): data is { code: string; detail: string; trace_id?: string } {
  return typeof data === "object" && data !== null && "code" in data && "detail" in data;
}

function OperationalContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const access = reportAccess(me.user?.capabilities);

  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const defaultTo = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);
  const from = params.get("from") ?? defaultFrom;
  const to = params.get("to") ?? defaultTo;

  const report = useQuery({
    queryKey: operationalKey(labId ?? "", from, to),
    queryFn: ({ signal }) => fetchOperational(labId ?? "", from, to, signal),
    // Without ``report:operational`` the metrics endpoint is never requested.
    enabled: labId !== undefined && me.user !== null && access.operational,
  });

  if (me.user !== null && !access.operational) {
    return (
      <div className="vse-app vse-page">
        <h1>Операционный отчёт</h1>
        <StatusView
          state="forbidden"
          title="Операционные показатели недоступны: у вас нет соответствующего полномочия."
        />
      </div>
    );
  }
  if (labId === undefined) {
    return (
      <div className="vse-app vse-page">
        <h1>Операционный отчёт</h1>
        <StatusView state="not-found" title="Лаборатория не указана." />
      </div>
    );
  }

  const problem = isProblem(report.data) ? report.data : null;
  const view =
    problem === null && report.data !== undefined && !("code" in (report.data ?? {}))
      ? (report.data as OperationalView)
      : null;

  return (
    <div className="vse-app vse-page">
      <h1>Операционный отчёт</h1>
      <form
        className="vse-report-period"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget as HTMLFormElement);
          const next = new URLSearchParams();
          next.set("from", String(data.get("from") ?? from));
          next.set("to", String(data.get("to") ?? to));
          setParams(next);
        }}
      >
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="operational-from">С даты</label>
          </div>
          <input id="operational-from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="operational-to">По дату</label>
          </div>
          <input id="operational-to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit">Применить период</Button>
      </form>
      {problem !== null ? (
        <StatusView
          state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
          title={problem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить показатели."}
          detail={problem.detail}
          trace={problem.trace_id}
          onRetry={() => void report.refetch()}
        />
      ) : report.isLoading ? (
        <StatusView state="loading" title="Загрузка показателей…" />
      ) : view !== null ? (
        <div className="vse-report-metric-grid">
          <div className="vse-report-metric">
            <strong>{view.saved_examinations}</strong>
            Сохранённых ВСЭ
          </div>
          <div className="vse-report-metric">
            <strong>{view.product_identifications}</strong>
            Идентификаций продукции по наименованию и визуальным осмотром
          </div>
          <div className="vse-report-metric">
            <strong>{view.transport_inspections}</strong>
            Ветеринарно-санитарных оценок и идентификаций транспорта
          </div>
        </div>
      ) : null}
    </div>
  );
}
