/**
 * ReportMatrix (DR51 §2/§7): the READ-ONLY full section III table of a
 * preview or a saved snapshot. One printed table of 47 rows × 10 physical
 * columns; the client never recomputes — the cells show the payload's own
 * values, BLANK rows render empty cells and a calculated zero renders «0».
 * The two-level thead repeats the form exactly (the «Птица» group over the
 * two bird subcolumns and the printed column numbers 1–10); the preliminary
 * marking follows the snapshot's ``official`` flag, never the live state.
 */
import "./reports.css";
import { buildMatrix, displayCell, type MatrixModel } from "./matrix";

export interface ReportMatrixProps {
  payload: Record<string, unknown>;
  official: boolean;
}

const COLUMN_NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

function cellLabel(rowCode: string, column: string): string {
  return `Строка ${rowCode}, ${column}: значение системой не заполняется`;
}

export function ReportMatrix({ payload, official }: ReportMatrixProps): React.ReactElement {
  const model: MatrixModel = buildMatrix(payload);
  const columnCount = model.columns.length + 2;
  return (
    <section className="vse-report-block" aria-label="Матрица отчёта">
      {!official ? <p className="vse-report-preliminary">Предварительная форма</p> : null}
      <h2 className="vse-report-section-title">Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках</h2>
      <div className="vse-report-matrix" style={{ overflowX: "auto" }}>
        <table className="vse-report-table">
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="vse-report-col-name">
                Наименование показателей
              </th>
              <th scope="col" rowSpan={2} className="vse-report-col-code">
                № строки
              </th>
              {model.columns.map((column) =>
                column === "Птица: куры" ? (
                  <th key="birds" scope="colgroup" colSpan={2}>
                    Птица
                  </th>
                ) : column === "Птица: другие виды" ? null : (
                  <th key={column} scope="col" rowSpan={2}>
                    {column}
                  </th>
                ),
              )}
            </tr>
            <tr>
              {model.columns.map((column) =>
                column === "Птица: куры" ? (
                  <th key={column} scope="col" aria-label="Птица: куры">
                    куры
                  </th>
                ) : column === "Птица: другие виды" ? (
                  <th key={column} scope="col" aria-label="Птица: другие виды">
                    другие виды
                  </th>
                ) : null,
              )}
            </tr>
            <tr>
              {COLUMN_NUMBERS.slice(0, columnCount).map((number) => (
                <th key={number} scope="col" className="vse-report-col-number">
                  {number}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr key={row.code}>
                <th scope="row" className={row.automatic ? "vse-report-row-auto" : undefined}>
                  {row.name}
                </th>
                <td className="vse-report-row-code">{row.code}</td>
                {model.columns.map((column, index) => {
                  const value = displayCell(row, index);
                  return value === null ? (
                    <td key={index} className="vse-report-cell-blank" aria-label={cellLabel(row.code, column)} />
                  ) : (
                    <td key={index}>{value}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
