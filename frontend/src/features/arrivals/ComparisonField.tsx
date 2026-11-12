/**
 * ComparisonField (A02, CHK-F42/43): one compared field of the CHK list in the
 * mockup geometry — the Mercury value, two square 40×40 mark buttons with
 * preserved native radio semantics (a default is never a check, FT-ARR-03)
 * and, when the doctor marks a mismatch, the actual value and the reason that
 * the discrepancy act (CHK-F44) will carry. The accessible names are full
 * Russian phrases including the field name; the state is never colour-only.
 */
import "./reconciliation.css";
import { useId } from "react";
import { Field } from "../../shared/ui/Field";
import { Icon } from "../../shared/ui/Icon";

export interface ComparisonValue {
  matches: boolean | null;
  actual: string;
  reason: string;
}

export interface ComparisonFieldProps {
  fieldId: string;
  label: string;
  /** Canonical section key; informational, never drawn locally. */
  block: string;
  source: string;
  value: ComparisonValue;
  /** Optional placeholder of the mismatch «Фактическое значение» input. */
  actualPlaceholder?: string | undefined;
  onChange?: ((next: ComparisonValue) => void) | undefined;
  disabled?: boolean;
  error?: string;
  /** ТЗ DR17 §6: the placeholder of the «Фактическое значение» input. */
  actualPlaceholder?: string | undefined;
}

export function ComparisonField({
  fieldId,
  label,
  source,
  value,
  actualPlaceholder = "",
  onChange,
  disabled = false,
  error = "",
  actualPlaceholder = "",
}: ComparisonFieldProps): React.ReactElement {
  const change = onChange ?? (() => undefined);
  const mismatch = value.matches === false;
  const match = value.matches === true;
  const name = `checks.${fieldId}`;
  const generatedId = useId();
  const factId = `${name}-${generatedId}`;
  const marked = mismatch || match;
  // The single error message of the comparison card (§7.3): the mark group
  // references it through aria-describedby, and while the fact inputs are
  // open the reason input carries the same message through the shared Field
  // contract (aria-invalid + its own describedby under this stable id).
  const reasonErrorId = `${name}-reason-error`;
  return (
    <div
      className={`vse-rec-compare${match ? " match" : ""}${mismatch ? " mismatch" : ""}`}
      data-field-id={fieldId}
    >
      <span className="vse-rec-compare-name" id={`${factId}-label`}>
        {label}
      </span>
      <span className="vse-rec-mercury-value" title={source}>
        {source}
      </span>
      <div
        className="vse-rec-check-buttons"
        role="radiogroup"
        aria-label={`Отметка сравнения: ${label}`}
        aria-invalid={error !== "" ? "true" : undefined}
        aria-describedby={error !== "" ? (mismatch ? reasonErrorId : `${factId}-error`) : undefined}
      >
        <label className="vse-rec-check ok" title={`Совпадает: ${label}`}>
          <input
            type="radio"
            name={`${name}.matches`}
            value="matches"
            checked={match}
            disabled={disabled}
            aria-label={`Совпадает: ${label}`}
            onChange={() => change({ ...value, matches: true })}
          />
          <span className="vse-rec-check-face" aria-hidden="true">
            <Icon name="comparison-match" />
          </span>
        </label>
        <label className="vse-rec-check bad" title={`Не совпадает: ${label}`}>
          <input
            type="radio"
            name={`${name}.matches`}
            value="mismatch"
            checked={mismatch}
            disabled={disabled}
            aria-label={`Не совпадает: ${label}`}
            onChange={() => change({ ...value, matches: false })}
          />
          <span className="vse-rec-check-face" aria-hidden="true">
            <Icon name="comparison-mismatch" />
          </span>
        </label>
      </div>
      <span className="vse-visually-hidden" aria-live="polite">
        {marked ? (match ? `Поле «${label}»: совпадает.` : `Поле «${label}»: не совпадает.`) : ""}
      </span>
      {mismatch ? (
        <div className="vse-rec-facts">
          <Field
            label="Фактическое значение"
            name={`${name}.actual`}
            value={value.actual}
            placeholder={actualPlaceholder}
            disabled={disabled}
            placeholder={actualPlaceholder}
            onChange={(actual) => change({ ...value, actual })}
          />
          <Field
            label="Причина несоответствия"
            name={`${name}.reason`}
            id={`${name}-reason`}
            value={value.reason}
            disabled={disabled}
            error={error}
            onChange={(reason) => change({ ...value, reason })}
          />
        </div>
      ) : null}
      {error !== "" && !mismatch ? (
        <p className="app-field-message app-field-error" id={`${factId}-error`} aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Neutral reference value of the same card geometry (no fictitious marks). */
export function ReferenceField({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="vse-rec-compare reference">
      <span className="vse-rec-compare-name">{label}</span>
      <span className="vse-rec-mercury-value" title={value}>
        {value}
      </span>
    </div>
  );
}
