/**
 * ReportParameters (SC-080): the only report type is «5-вет, раздел III»,
 * the period is exactly one completed half-year of one laboratory. Changing
 * any parameter invalidates a previous preview on the page level (the page
 * clears codes and shows the warning); the parameters themselves live in
 * plain component state — a failed command never clears them.
 */
import "./reports.css";
import { Button } from "../../shared/ui/Button";

export interface ReportParametersProps {
  year: number;
  half: 1 | 2;
  busy: boolean;
  disabled: boolean;
  /** True while a preview exists that is no longer consistent with the inputs. */
  stale: boolean;
  onYear: (year: number) => void;
  onHalf: (half: 1 | 2) => void;
  onPreview: () => void;
}

export const REPORT_TYPE_LABEL = "5-вет, раздел III";

export function ReportParameters({
  year,
  half,
  busy,
  disabled,
  stale,
  onYear,
  onHalf,
  onPreview,
}: ReportParametersProps): React.ReactElement {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let value = currentYear; value >= currentYear - 10; value -= 1) years.push(value);
  return (
    <section className="vse-report-block" aria-label="Параметры отчёта">
      <h2>Параметры отчёта</h2>
      <p className="app-field-message">
        Тип отчёта: <strong>{REPORT_TYPE_LABEL}</strong>. Отчёт строится за одно завершённое полугодие одной
        лаборатории (SC-080) и сохраняется без пересчёта источников.
      </p>
      <form
        className="vse-report-params"
        onSubmit={(event) => {
          event.preventDefault();
          onPreview();
        }}
      >
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="report-year">Год</label>
          </div>
          <select
            id="report-year"
            value={year}
            disabled={disabled}
            onChange={(event) => onYear(Number(event.target.value))}
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="vse-report-half">
          <legend>Полугодие</legend>
          <label>
            <input
              type="radio"
              name="report-half"
              value="1"
              checked={half === 1}
              disabled={disabled}
              onChange={() => onHalf(1)}
            />
            I (январь—июнь)
          </label>
          <label>
            <input
              type="radio"
              name="report-half"
              value="2"
              checked={half === 2}
              disabled={disabled}
              onChange={() => onHalf(2)}
            />
            II (июль—декабрь)
          </label>
        </fieldset>
        <div>
          <Button type="submit" busyLabel="Считаем…" disabled={disabled}>
            {busy ? "Считаем…" : "Сформировать предварительный просмотр"}
          </Button>
        </div>
      </form>
      {stale ? (
        <p className="vse-report-warning" role="alert">
          Параметры изменены — предварительный просмотр и коды больше не соответствуют выбранным. Сформируйте
          просмотр заново.
        </p>
      ) : null}
    </section>
  );
}
