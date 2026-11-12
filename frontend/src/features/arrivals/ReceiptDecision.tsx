/**
 * ReceiptDecision (A02, CHK-F34/35/39/40): the three receipt decisions in the
 * fixed order, disabled with an explanation when the current grounds forbid
 * them, the return reason (a Mercury dictionary code; OTHER_REASON demands
 * its text) and the transaction flag. There is no separate «с актом»
 * decision — the act is derived (CHK-F44). The fair (ярмарка) flag belongs to
 * the invoice section of the composed screen.
 */
import { Field } from "../../shared/ui/Field";
import { DECISIONS, DECISION_LABELS, RETURN_REASON_CODES, type Decision } from "./api";

export interface ReceiptDecisionValue {
  decision: Decision | null;
  return_reason_code: string;
  return_reason_text: string;
  transaction_planned: boolean | null;
  transaction_type: "INTERNAL" | "EXTERNAL" | null;
}

export interface ReceiptDecisionProps {
  value: ReceiptDecisionValue;
  onChange: (next: ReceiptDecisionValue) => void;
  allowed: Decision[];
  disabled?: boolean;
  errors: Record<string, string>;
}

const DECISION_NOTES: Readonly<Record<Decision, string>> = Object.freeze({
  ACCEPT_ALL: "Вся доставленная партия принимается; недостача не является обратным грузом.",
  PARTIAL: "Реально принятая и возвращаемая части; принятое + возвращаемое = доставленное.",
  RETURN_ALL: "Вся прибывшая партия возвращается; акт этой ветки не формируется.",
});

export function ReceiptDecision({
  value,
  onChange,
  allowed,
  disabled = false,
  errors,
}: ReceiptDecisionProps): React.ReactElement {
  const decision = value.decision;
  const showReason = decision === "PARTIAL" || decision === "RETURN_ALL";
  const needsReasonText = showReason && value.return_reason_code === "OTHER_REASON";
  return (
    <fieldset className="vse-rec-decision" disabled={disabled}>
      <legend>Решение о приёмке</legend>
      <div className="vse-rec-decision-options" role="radiogroup" aria-label="Решение о приёмке">
        {DECISIONS.map((option) => {
          const allowedHere = allowed.includes(option);
          return (
            <div key={option} className="vse-rec-decision-option" data-decision={option}>
              <label>
                <input
                  type="radio"
                  name="decision"
                  value={option}
                  checked={decision === option}
                  disabled={disabled || !allowedHere}
                  onChange={() => onChange({ ...value, decision: option })}
                  aria-describedby={allowedHere ? undefined : `decision-note-${option}`}
                />
                <span>{DECISION_LABELS[option]}</span>
              </label>
              <span className="vse-rec-decision-note" id={`decision-note-${option}`}>
                {allowedHere ? DECISION_NOTES[option] : "Недоступно при отмеченных расхождениях."}
              </span>
            </div>
          );
        })}
      </div>
      {errors.decision !== undefined ? (
        <p className="app-field-message app-field-error" aria-live="polite">
          {errors.decision}
        </p>
      ) : null}

      {showReason ? (
        <div className="vse-rec-decision-reason">
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="return-reason-code">Причина возврата</label>
            </div>
            <select
              id="return-reason-code"
              value={value.return_reason_code}
              onChange={(event) => onChange({ ...value, return_reason_code: event.target.value })}
            >
              <option value="">Выберите код причины</option>
              {RETURN_REASON_CODES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            {errors.return_reason_code !== undefined ? (
              <p className="app-field-message app-field-error" aria-live="polite">
                {errors.return_reason_code}
              </p>
            ) : null}
          </div>
          {needsReasonText ? (
            <Field
              id="return-reason-text"
              label="Текст иной причины"
              value={value.return_reason_text}
              maxLength={240}
              onChange={(text) => onChange({ ...value, return_reason_text: text })}
              error={errors.return_reason_text}
            />
          ) : null}
        </div>
      ) : null}

      <fieldset className="vse-rec-transaction">
        <legend>По партии будет произведена транзакция</legend>
        <label className="vse-rec-mark">
          <input
            type="radio"
            name="transaction.planned"
            checked={value.transaction_planned === true}
            onChange={() => onChange({ ...value, transaction_planned: true })}
          />
          Да
        </label>
        <label className="vse-rec-mark">
          <input
            type="radio"
            name="transaction.planned"
            checked={value.transaction_planned === false}
            onChange={() => onChange({ ...value, transaction_planned: false, transaction_type: null })}
          />
          Нет
        </label>
        {value.transaction_planned === true ? (
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="transaction-type">Тип транзакции</label>
            </div>
            <select
              id="transaction-type"
              value={value.transaction_type ?? ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  transaction_type: (event.target.value === "" ? null : event.target.value) as
                    "INTERNAL" | "EXTERNAL" | null,
                })
              }
            >
              <option value="">Выберите тип</option>
              <option value="INTERNAL">Внутренняя</option>
              <option value="EXTERNAL">Внешняя</option>
            </select>
            {errors.transaction_type !== undefined ? (
              <p className="app-field-message app-field-error" aria-live="polite">
                {errors.transaction_type}
              </p>
            ) : null}
          </div>
        ) : null}
        {errors.transaction_planned !== undefined ? (
          <p className="app-field-message app-field-error" aria-live="polite">
            {errors.transaction_planned}
          </p>
        ) : null}
      </fieldset>
    </fieldset>
  );
}
