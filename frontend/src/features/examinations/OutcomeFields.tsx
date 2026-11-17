/**
 * OutcomeFields (FT-VSE-35–37, API-05, ТЗ DR42 §6): the outcome fields of the
 * «Итог экспертизы» block in the mockup grid (electronic-vse-journal.html).
 *
 * The result and the direction are the styled SelectDropdown (no browser
 * default select), the reason is a textarea. The business matrix mirrors the
 * server: Пригодно (FIT) allows only «В реализацию без ограничений» and clears
 * the reason; Непригодно (UNFIT) allows only утилизация/уничтожение and
 * requires a free-text reason. «Условно-пригодно» does not exist. Nothing is
 * ever prefilled — the medical outcome stays the doctor's explicit decision.
 */
import { SelectDropdown, type SelectOption } from "../../shared/ui/SelectDropdown";
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

const RESULT_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "Выберите результат" },
  { value: "FIT", label: OUTCOME_LABELS.FIT },
  { value: "UNFIT", label: OUTCOME_LABELS.UNFIT },
];

const DIRECTION_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "Выберите направление" },
  { value: "SALE", label: DIRECTION_LABELS.SALE },
  { value: "DISPOSAL", label: DIRECTION_LABELS.DISPOSAL },
  { value: "DESTRUCTION", label: DIRECTION_LABELS.DESTRUCTION },
];

export function OutcomeFields({
  value,
  disabled,
  variant = "form",
  idPrefix = "outcome",
  onChange,
}: OutcomeFieldsProps): React.ReactElement {
  const fit = value.outcome === "FIT";
  const unfit = value.outcome === "UNFIT";
  const directionOptions = fit
    ? DIRECTION_OPTIONS.filter((option) => option.value === "" || option.value === "SALE")
    : unfit
      ? DIRECTION_OPTIONS.filter((option) => option.value === "" || option.value !== "SALE")
      : DIRECTION_OPTIONS.filter((option) => option.value === "");
  return (
    <>
      <div className="vse-span4">
        <SelectDropdown
          id={`${idPrefix}-result`}
          label={variant === "late" ? "Результат специальной лаборатории" : "Результат ВСЭ *"}
          value={value.outcome}
          options={RESULT_OPTIONS}
          placeholder="Выберите результат"
          disabled={disabled}
          onChange={(next) =>
            onChange(
              next === "FIT"
                ? { outcome: "FIT", direction: "SALE", reason: "" }
                : next === "UNFIT"
                  ? {
                      outcome: "UNFIT",
                      direction:
                        value.direction === "" || value.direction === "SALE" ? "DISPOSAL" : value.direction,
                      reason: value.reason,
                    }
                  : { outcome: "", direction: "", reason: "" },
            )
          }
        />
      </div>
      <div className="vse-span4">
        <SelectDropdown
          id={`${idPrefix}-direction`}
          label="Направление по результатам ВСЭ *"
          value={value.direction}
          options={directionOptions}
          placeholder="Выберите направление"
          disabled={disabled || value.outcome === ""}
          onChange={(next) => onChange({ ...value, direction: next as OutcomeEntry["direction"] })}
        />
      </div>
      {unfit ? (
        <div className="vse-span12">
          <div className="app-field">
            {/* DR42 fix-loop: a label cannot nest another label — the heading is
                an explicit sibling <label htmlFor>, the textarea keeps its
                accessible name. */}
            <label className="app-field-heading" htmlFor={`${idPrefix}-reason`}>
              Причина направления *
            </label>
            <textarea
              id={`${idPrefix}-reason`}
              value={value.reason}
              disabled={disabled}
              maxLength={2000}
              onChange={(event) => onChange({ ...value, reason: event.target.value })}
            />
          </div>
        </div>
      ) : null}
      <p className="vse-exam-note vse-span12">
        {fit
          ? "Для пригодной продукции направление — реализация без ограничений, причина не сохраняется."
          : unfit
            ? "Для непригодной продукции доступны утилизация и уничтожение; причина обязательна."
            : "Итог не выбран: направление и причина останутся недоступными."}
      </p>
    </>
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
