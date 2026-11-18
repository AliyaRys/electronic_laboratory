/**
 * ReportParameters (SC-080, DR48 §3.4): the only report type is «5-вет,
 * раздел III» and the period is any valid inclusive calendar range of one
 * laboratory, chosen with the shared date-range popover. Changing the applied
 * range invalidates a previous preview on the page level (the page clears the
 * codes and shows the warning); the parameters live in plain component state —
 * a failed command never clears them. Without both applied bounds the preview
 * command is never sent.
 */
import "./reports.css";
import { Button } from "../../shared/ui/Button";
import {
  DateRangePopover,
  appliedRangeLabel,
  dateRangeError,
  type AppliedDateRange,
} from "../../shared/ui/DateRangePopover";

export interface ReportParametersProps {
  applied: AppliedDateRange;
  busy: boolean;
  disabled: boolean;
  /** True while a preview exists that is no longer consistent with the inputs. */
  stale: boolean;
  onApply: (range: AppliedDateRange) => void;
  onReset: () => void;
  onPreview: () => void;
}

export const REPORT_TYPE_LABEL = "5-вет, раздел III";

export function ReportParameters({
  applied,
  busy,
  disabled,
  stale,
  onApply,
  onReset,
  onPreview,
}: ReportParametersProps): React.ReactElement {
  // Both bounds must be applied and ordered before the preview may run.
  const ready = dateRangeError(applied.from, applied.to) === "";
  return (
    <section className="vse-report-block" aria-label="Параметры отчёта">
      <h2>Параметры отчёта</h2>
      <form
        className="vse-report-params"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onPreview();
        }}
      >
        <DateRangePopover
          caption="Период отчёта"
          applied={applied}
          onApply={onApply}
          onReset={onReset}
          emptyLabel="Выберите период"
          disabled={disabled}
          idPrefix="report-period"
        />
        <div>
          <Button type="submit" busyLabel="Считаем…" disabled={disabled || !ready}>
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
      {applied.from !== "" && applied.to !== "" ? (
        <p className="app-field-message" data-testid="applied-period">
          Период: {appliedRangeLabel(applied)}
        </p>
      ) : null}
    </section>
  );
}
