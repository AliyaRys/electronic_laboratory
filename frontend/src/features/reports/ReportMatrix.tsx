/**
 * ReportMatrix (SC-081–088, API-08): the READ-ONLY matrix of a preview or a
 * saved snapshot. The client never recomputes — the cells show the payload's
 * own values; the two manual rows are marked «Не рассчитывается», empty
 * automatic cells show «—». The preliminary marking follows the snapshot's
 * ``official`` flag (INPUT-04), never the live state.
 */
import "./reports.css";
import { buildMatrix, displayCell, type MatrixModel } from "./matrix";

export interface ReportMatrixProps {
  payload: Record<string, unknown>;
  sourceCount: number;
  official: boolean;
  caption: string;
}

/** One table per printed column keeps a narrow screen readable without clipping. */
export function ReportMatrix({
  payload,
  sourceCount,
  official,
  caption,
}: ReportMatrixProps): React.ReactElement {
  const model: MatrixModel = buildMatrix(payload, sourceCount);
  return (
    <section className="vse-report-block" aria-label="Матрица отчёта">
      <h2>{caption}</h2>
      {!official ? <p className="vse-report-preliminary">Предварительная форма</p> : null}
      <div className="vse-report-matrix" style={{ overflowX: "auto" }}>
        <table className="vse-report-table">
          <thead>
            <tr>
              <th scope="col">Наименование показателя</th>
              <th scope="col">Код</th>
              {model.columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr key={row.code}>
                <th scope="row">{row.name}</th>
                <td>{row.automatic ? row.code : "—"}</td>
                {row.values.map((_, index) => (
                  <td key={index}>{displayCell(row, index)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="app-field-message">
        Источников в снимке: {sourceCount}. Матрица показана строго по сохранённому снимку и не
        пересчитывается при изменении или удалении исходных ВСЭ (SC-084, AT-18).
      </p>
      {model.versions.length > 0 ? <p className="app-field-message">{model.versions.join("; ")}.</p> : null}
    </section>
  );
}
