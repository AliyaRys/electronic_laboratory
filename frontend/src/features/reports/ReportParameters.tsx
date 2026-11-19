/**
 * ReportParameters (DR51 §5): two permanent date inputs and one primary
 * «Применить» button that applies the range AND requests the preview in a
 * single action (no popover, no separate preview button on this page; the
 * shared DateRangePopover component itself stays with its other screens).
 * Both dates are required, ``from <= to``; the parameters live in plain
 * component state — a failed command never clears them; changing an input
 * marks the shown preview stale until a new «Применить».
 */
import "./reports.css";
import { Button } from "../../shared/ui/Button";

export interface AppliedDateRange {
  from: string;
  to: string;
}

export interface ReportParametersProps {
  applied: AppliedDateRange;
  busy: boolean;
  disabled: boolean;
  /** True while a preview exists that is no longer consistent with the inputs. */
  stale: boolean;
  error: string;
  onChange: (range: AppliedDateRange) => void;
  onApply: (range: AppliedDateRange) => void;
}

function rangeError(from: string, to: string): string {
  if (from === "" || to === "") return "";
  if (from > to) return "Дата начала не может быть позже даты окончания.";
  return "";
}

export function ReportParameters({
  applied,
  busy,
  disabled,
  stale,
  error,
  onChange,
  onApply,
}: ReportParametersProps): React.ReactElement {
  const invalid = rangeError(applied.from, applied.to);
  const ready = applied.from !== "" && applied.to !== "" && invalid === "";
  return (
    <section className="vse-report-block" aria-label="Параметры отчёта">
      <h2>Параметры отчёта</h2>
      <form
        className="vse-report-period"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onApply({ ...applied });
        }}
      >
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="report-from">С даты</label>
          </div>
          <input
            id="report-from"
            type="date"
            name="from"
            value={applied.from}
            onChange={(event) => onChange({ ...applied, from: event.target.value })}
            aria-invalid={invalid !== "" ? true : undefined}
          />
        </div>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="report-to">По дату</label>
          </div>
          <input
            id="report-to"
            type="date"
            name="to"
            value={applied.to}
            onChange={(event) => onChange({ ...applied, to: event.target.value })}
            aria-invalid={invalid !== "" ? true : undefined}
          />
        </div>
        <Button type="submit" variant="primary" busyLabel="Формируем…" disabled={disabled || !ready}>
          {busy ? "Формируем…" : "Применить"}
        </Button>
      </form>
      {invalid !== "" ? (
        <p className="app-field-message" role="alert">
          {invalid}
        </p>
      ) : error !== "" ? (
        <p className="app-field-message" role="alert">
          {error}
        </p>
      ) : null}
      {stale ? (
        <p className="vse-report-warning" role="alert">
          Параметры изменены — предварительный просмотр больше не соответствует выбранным. Нажмите
          «Применить» заново.
        </p>
      ) : null}
    </section>
  );
}
