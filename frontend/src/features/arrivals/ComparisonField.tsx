/**
 * ComparisonField (A02, CHK-F42/43): one compared field of the CHK list —
 * the source value, the explicit mark (a default is never a check,
 * FT-ARR-03) and, when the doctor marks a mismatch, the actual value and the
 * reason that the discrepancy act (CHK-F44) will carry.
 */
import { Field } from "../../shared/ui/Field";

export interface ComparisonValue {
  matches: boolean | null;
  actual: string;
  reason: string;
}

export interface ComparisonFieldProps {
  fieldId: string;
  label: string;
  block: string;
  source: string;
  value: ComparisonValue;
  onChange: (next: ComparisonValue) => void;
  disabled?: boolean;
  error?: string;
}

export function ComparisonField({
  fieldId,
  label,
  block,
  source,
  value,
  onChange,
  disabled = false,
  error = "",
}: ComparisonFieldProps): React.ReactElement {
  const mismatch = value.matches === false;
  const name = `checks.${fieldId}`;
  return (
    <div className="app-field vse-comparison" data-field-id={fieldId}>
      <div className="app-field-heading">
        <span className="vse-comparison-label">{label}</span>
      </div>
      <p className="vse-comparison-source">
        <span className="vse-comparison-source-label">Исходное значение: </span>
        <span>{source}</span>
      </p>
      <div className="vse-comparison-marks" role="radiogroup" aria-label={`Отметка сравнения: ${label}`}>
        <label className="vse-comparison-mark">
          <input
            type="radio"
            name={`${name}.matches`}
            value="matches"
            checked={value.matches === true}
            disabled={disabled}
            onChange={() => onChange({ ...value, matches: true })}
          />
          Совпадает
        </label>
        <label className="vse-comparison-mark">
          <input
            type="radio"
            name={`${name}.matches`}
            value="mismatch"
            checked={mismatch}
            disabled={disabled}
            onChange={() => onChange({ ...value, matches: false })}
          />
          Не совпадает
        </label>
      </div>
      {mismatch ? (
        <div className="vse-comparison-facts">
          <Field
            label="Фактическое значение"
            name={`${name}.actual`}
            value={value.actual}
            disabled={disabled}
            onChange={(actual) => onChange({ ...value, actual })}
          />
          <Field
            label="Причина несоответствия"
            name={`${name}.reason`}
            value={value.reason}
            disabled={disabled}
            onChange={(reason) => onChange({ ...value, reason })}
          />
        </div>
      ) : null}
      {error !== "" ? (
        <p className="app-field-message app-field-error" aria-live="polite">
          {error}
        </p>
      ) : null}
      <span className="vse-comparison-block" aria-hidden="true">
        {block} · {fieldId}
      </span>
    </div>
  );
}
