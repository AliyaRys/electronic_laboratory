/**
 * OperationalReportPage (R03, API-08, SC-076–079): the operational indicators
 * of one laboratory over a chosen period. The period lives in the URL and
 * drives ONLY the three indicators — the sample balances are the CURRENT
 * live remainders (R01 semantics) and never depend on the period filter.
 * HEAD/ANALYST only (AT-20); VET/ADMIN get the honest forbidden state.
 */
import "./../features/reports/reports.css";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams, useParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { useMe } from "../shared/api/me";
import { StatusView } from "../shared/ui/StatusView";
import { Button } from "../shared/ui/Button";
import {
  fetchOperational,
  operationalKey,
  REPORT_ROLES,
  type OperationalView,
} from "../features/reports/api";

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
  const role = me.user?.role ?? null;
  const allowed = role !== null && REPORT_ROLES.has(role);

  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const defaultTo = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);
  const from = params.get("from") ?? defaultFrom;
  const to = params.get("to") ?? defaultTo;

  const report = useQuery({
    queryKey: operationalKey(labId ?? "", from, to),
    queryFn: ({ signal }) => fetchOperational(labId ?? "", from, to, signal),
    enabled: labId !== undefined && allowed && role !== null,
  });

  if (me.user !== null && !allowed) {
    return (
      <div className="vse-app vse-page">
        <h1>Операционный отчёт</h1>
        <StatusView state="forbidden" title="Раздел доступен только заведующему и аналитику." />
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
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/reports`}>← Отчёты</Link>
      </nav>
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
        <>
          <div className="vse-report-metric-grid">
            <div className="vse-report-metric">
              <strong>{view.processed_parties}</strong>
              Обработанных партий (SC-078: внутренние транзакции исключены)
            </div>
            <div className="vse-report-metric">
              <strong>{view.product_identifications}</strong>
              Идентификаций продукции (по завершённым услугам, SC-077)
            </div>
            <div className="vse-report-metric">
              <strong>{view.transport_inspections}</strong>
              Осмотров транспорта (по завершённым услугам, SC-077)
            </div>
          </div>
          <section className="vse-report-block" aria-label="Текущие остатки проб">
            <h2>Текущие остатки проб (SC-079)</h2>
            <p className="app-field-message">
              Остатки — текущие живые суммы по видам продукции; фильтр периода на них не влияет (R01).
            </p>
            {view.current_sample_balances.length === 0 ? (
              <StatusView state="empty" title="Положительных остатков нет." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="vse-report-table">
                  <thead>
                    <tr>
                      <th scope="col">Вид продукции (идентификатор)</th>
                      <th scope="col">Остаток, кг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.current_sample_balances.map((balance) => (
                      <tr key={balance.product_species_id}>
                        <th scope="row">{balance.product_species_id}</th>
                        <td>{balance.mass_kg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
