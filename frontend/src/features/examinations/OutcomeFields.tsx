/**
 * OutcomeFields (FT-VSE-35–37, API-05): the outcome block.
 *
 * The matrix mirrors the server: Пригодно (FIT) allows only «В реализацию без
 * ограничений» and clears the reason; Непригодно (UNFIT) allows only
 * утилизация/уничтожение and requires a free-text reason. «Условно-пригодно»
 * does not exist. Nothing is ever prefilled — the medical outcome stays the
 * doctor's explicit decision (no auto outcome).
 */
import type { OutcomeEntry } from "./formValues";

export const OUTCOME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  FIT: "Пригодно",
  UNFIT: "Непригодно",
});
export const DIRECTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  SALE: "В реализацию без ограничений",
  DISPOSAL: "На утилизацию",
  DESTRUCTION: "На уничтожение",
});

export interface OutcomeFieldsProps {
  value: OutcomeEntry;
  disabled: boolean;
  /** «late» is the WAITING completion: same fields, no reason clearing quirk. */
  variant?: "form" | "late" | undefined;
  idPrefix?: string;
  onChange: (value: OutcomeEntry) => void;
}

export function OutcomeFields({
  value,
  disabled,
  variant = "form",
  idPrefix = "outcome",
  onChange,
}: OutcomeFieldsProps): React.ReactElement {
  const fit = value.outcome === "FIT";
  const unfit = value.outcome === "UNFIT";
  return (
    <fieldset className="vse-outcome" aria-label="Итог экспертизы">
      <legend>
        {variant === "late" ? "Итог специальной лаборатории" : "Итог экспертизы"}
        {variant !== "late" ? <span aria-hidden="true"> *</span> : null}
      </legend>
      <div className="vse-research-marks" role="radiogroup" aria-label="Результат ВСЭ">
        <label className="vse-comparison-mark">
          <input
            type="radio"
            name={`${idPrefix}-outcome`}
            checked={fit}
            disabled={disabled}
            onChange={() => onChange({ outcome: "FIT", direction: "SALE", reason: "" })}
          />
          Пригодно
        </label>
        <label className="vse-comparison-mark">
          <input
            type="radio"
            name={`${idPrefix}-outcome`}
            checked={unfit}
            disabled={disabled}
            onChange={() =>
              onChange({
                outcome: "UNFIT",
                direction:
                  value.direction === "" || value.direction === "SALE" ? "DISPOSAL" : value.direction,
                reason: value.reason,
              })
            }
          />
          Непригодно
        </label>
      </div>
      <div className="vse-outcome-fields">
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor={`${idPrefix}-direction`}>Направление по результатам ВСЭ *</label>
          </div>
          <select
            id={`${idPrefix}-direction`}
            value={value.direction}
            disabled={disabled || value.outcome === ""}
            onChange={(event) =>
              onChange({
                ...value,
                direction: event.target.value as OutcomeEntry["direction"],
              })
            }
          >
            <option value="" disabled>
              Выберите направление
            </option>
            {fit ? <option value="SALE">{DIRECTION_LABELS.SALE}</option> : null}
            {unfit ? (
              <>
                <option value="DISPOSAL">{DIRECTION_LABELS.DISPOSAL}</option>
                <option value="DESTRUCTION">{DIRECTION_LABELS.DESTRUCTION}</option>
              </>
            ) : null}
          </select>
        </div>
        {unfit ? (
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor={`${idPrefix}-reason`}>Причина направления *</label>
            </div>
            <textarea
              id={`${idPrefix}-reason`}
              value={value.reason}
              disabled={disabled}
              maxLength={2000}
              onChange={(event) => onChange({ ...value, reason: event.target.value })}
            />
          </div>
        ) : null}
        <p className="vse-exam-note">
          {fit
            ? "Для пригодной продукции направление — реализация без ограничений, причина не сохраняется."
            : unfit
              ? "Для непригодной продукции доступны утилизация и уничтожение; причина обязательна."
              : "Итог не выбран: направление и причина останутся недоступными."}
        </p>
      </div>
    </fieldset>
  );
}

/** The Russian label of a stored outcome/direction (readonly view). */
export function outcomeText(outcome: string | null, direction: string | null): string {
  const parts: string[] = [];
  if (outcome !== null && outcome in OUTCOME_LABELS) parts.push(OUTCOME_LABELS[outcome] ?? outcome);
  if (direction !== null && direction in DIRECTION_LABELS) {
    parts.push(DIRECTION_LABELS[direction] ?? direction);
  }
  return parts.join(" · ");
}
