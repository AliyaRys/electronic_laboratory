/**
 * ReadonlyField (DR30 §6.5.5): a readonly fact rendered as the mockup's
 * readonly input/textarea — visually identical to the reference, while the
 * real non-editable control keeps the accessible output (label + value,
 * screen-reader readable, long values wrap). An empty value is honest «—».
 */
import "./ui.css";
import { useId } from "react";

export interface ReadonlyFieldProps {
  label: string;
  value: string;
  /** Long enterprise names/addresses use a non-resizable textarea (mockup). */
  multiline?: boolean;
}

export function ReadonlyField({ label, value, multiline = false }: ReadonlyFieldProps): React.ReactElement {
  const inputId = useId();
  const shown = value === "" ? "—" : value;
  return (
    <div className="app-readonly-field">
      <label htmlFor={inputId}>{label}</label>
      {multiline ? (
        <textarea id={inputId} rows={3} readOnly value={shown} />
      ) : (
        <input id={inputId} readOnly value={shown} />
      )}
    </div>
  );
}
