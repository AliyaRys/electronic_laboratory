/**
 * Working text field (UI-02). The error contract follows
 * ``components/auth/TextField.js``: the message is linked with
 * aria-describedby, marked aria-invalid, announced politely and cleared as soon
 * as the user corrects the input (no server round-trip needed to dismiss).
 */
import "./ui.css";
import { useId, useState } from "react";

export interface FieldProps {
  id?: string;
  label: string;
  type?: "text" | "password" | "email";
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  /** Optional input length limit (e.g. OTHER_REASON text ≤ 240, ТЗ DR8 §10). */
  maxLength?: number;
  /** Persistent validation/server error from the parent. */
  error?: string;
  hint?: string;
}

export function Field({
  id,
  label,
  type = "text",
  name,
  value,
  onChange,
  placeholder,
  autoComplete,
  required = false,
  disabled = false,
  maxLength,
  error = "",
  hint = "",
}: FieldProps): React.ReactElement {
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  // The error hides while the user is typing and re-appears only when the
  // parent supplies a different message (ошибка снимается при исправлении).
  const [dismissed, setDismissed] = useState(false);
  const [dismissedFor, setDismissedFor] = useState(error);
  const showError = error !== "" && !(dismissed && dismissedFor === error);

  const describedBy = [hint !== "" && hintId, showError && errorId].filter(Boolean).join(" ");

  return (
    <div className="app-field">
      <div className="app-field-heading">
        <label htmlFor={inputId}>{label}</label>
      </div>
      <input
        id={inputId}
        name={name ?? inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={showError ? "true" : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        onChange={(event) => {
          setDismissed(true);
          setDismissedFor(error);
          onChange(event.target.value);
        }}
      />
      {hint !== "" ? (
        <p className="app-field-message" id={hintId}>
          {hint}
        </p>
      ) : null}
      {showError ? (
        <p className="app-field-message app-field-error" id={errorId} aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );
}
