/**
 * ReportCodes (API-08): the seven manual header codes of the 5-вет form.
 * Leading zeroes are meaningful («001») — the inputs are plain text and the
 * values are only trimmed, never coerced. The codes live in the page state:
 * a failed save or a network error keeps every entered value untouched.
 */
import "./reports.css";
import { Field } from "../../shared/ui/Field";

export interface ReportCodesProps {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

export const CODE_FIELDS: readonly { key: string; label: string }[] = [
  { key: "okud", label: "ОКУД" },
  { key: "okpo", label: "ОКПО" },
  { key: "okved", label: "ОКВЭД" },
  { key: "oktmo", label: "ОКТМО" },
  { key: "okogu", label: "ОКОГУ" },
  { key: "okopf", label: "ОКОПФ" },
  { key: "okfs", label: "ОКФС" },
];

export function ReportCodes({
  values,
  onChange,
  errors = {},
  disabled = false,
}: ReportCodesProps): React.ReactElement {
  return (
    <section className="vse-report-block" aria-label="Коды шапки формы">
      <h2>Коды шапки формы</h2>
      <p className="app-field-message">
        Семь обязательных кодов вводятся вручную; ведущие нули сохраняются, пробелы обрезаются.
      </p>
      <div className="vse-report-codes">
        {CODE_FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            value={values[field.key] ?? ""}
            onChange={(value) => onChange(field.key, value)}
            error={errors[field.key]}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}
