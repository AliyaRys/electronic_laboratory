/**
 * DocumentComparisonField (ТЗ DR40 §7.2): ONE comparison card for ONE whole
 * accompanying document of the эВСД — the typed read model from the backend
 * (type label, series+number, creation date) with a single
 * «Соответствует»/«Не соответствует» pair for the whole document (never one
 * pair per field). On a mismatch the card reveals ONLY the reason field
 * (ТЗ DR53 Task 2): the fabricated duplicate «Фактическое значение» block is
 * gone from the source and the mismatch payload never carries a fabricated
 * `actual` — the act keeps the stable source description + reason. Accessible
 * names are full Russian phrases; long values wrap and never break the grid.
 */
import "./reconciliation.css";
import { useId } from "react";
import { Field } from "../../shared/ui/Field";
import { Icon } from "../../shared/ui/Icon";
import { formatRuDate, seriesAndNumberLabel, type AccompanyingDocument } from "./api";

export interface DocumentComparisonValue {
  matches: boolean | null;
  reason: string;
}

export interface DocumentComparisonFieldProps {
  documentKey: string;
  document: AccompanyingDocument;
  value: DocumentComparisonValue;
  onChange: (next: DocumentComparisonValue) => void;
  error?: string;
}

export function DocumentComparisonField({
  documentKey,
  document,
  value,
  onChange,
  error = "",
}: DocumentComparisonFieldProps): React.ReactElement {
  const change = onChange ?? (() => undefined);
  const mismatch = value.matches === false;
  const match = value.matches === true;
  const name = `documents.${documentKey}`;
  const generatedId = useId();
  const cardId = `${name}-${generatedId}`;
  const label = document.typeLabel || "Тип не указан";
  const seriesAndNumber = seriesAndNumberLabel(document.series, document.number);
  const createdOn = document.createdOn ? formatRuDate(document.createdOn) : "—";
  const reasonErrorId = `${name}-reason-error`;
  return (
    <div
      className={`vse-rec-document-card${match ? " match" : ""}${mismatch ? " mismatch" : ""}`}
      data-document-key={documentKey}
    >
      <div className="vse-rec-document-head">
        <span className="vse-rec-document-name">{label}</span>
        <div
          className="vse-rec-check-buttons"
          role="radiogroup"
          aria-label={`Отметка сравнения: ${label}`}
          aria-invalid={error !== "" ? "true" : undefined}
          aria-describedby={error !== "" ? (mismatch ? reasonErrorId : `${cardId}-error`) : undefined}
        >
          <label className="vse-rec-check ok" title={`Соответствует: ${label}`}>
            <input
              type="radio"
              name={`${name}.matches`}
              value="matches"
              checked={match}
              aria-label={`Соответствует: ${label}`}
              onChange={() => change({ ...value, matches: true })}
            />
            <span className="vse-rec-check-face" aria-hidden="true">
              <Icon name="comparison-match" />
            </span>
          </label>
          <label className="vse-rec-check bad" title={`Не соответствует: ${label}`}>
            <input
              type="radio"
              name={`${name}.matches`}
              value="mismatch"
              checked={mismatch}
              aria-label={`Не соответствует: ${label}`}
              onChange={() => change({ ...value, matches: false })}
            />
            <span className="vse-rec-check-face" aria-hidden="true">
              <Icon name="comparison-mismatch" />
            </span>
          </label>
        </div>
      </div>
      <span className="vse-visually-hidden" aria-live="polite">
        {match || mismatch
          ? match
            ? `Документ «${label}»: соответствует.`
            : `Документ «${label}»: не соответствует.`
          : ""}
      </span>
      <dl className="vse-rec-document-facts">
        <div className="vse-rec-document-fact">
          <dt>Тип сопроводительного документа</dt>
          <dd title={label}>{label}</dd>
        </div>
        <div className="vse-rec-document-fact">
          <dt>Серия и номер</dt>
          <dd title={seriesAndNumber}>{seriesAndNumber}</dd>
        </div>
        <div className="vse-rec-document-fact">
          <dt>Дата создания</dt>
          <dd>{createdOn}</dd>
        </div>
      </dl>
      {mismatch ? (
        <div className="vse-rec-document-reason">
          {/* ТЗ DR53 Task 2: the mismatch reveals ONLY the reason field; the
              duplicate «Фактическое значение» block was removed at the source
              (never hidden with CSS) — the document facts stay printed once. */}
          <Field
            label="Причина несоответствия"
            name={`${name}.reason`}
            id={`${name}-reason`}
            value={value.reason}
            error={error}
            onChange={(reason) => change({ ...value, reason })}
          />
        </div>
      ) : null}
      {error !== "" && !mismatch ? (
        <p className="app-field-message app-field-error" id={`${cardId}-error`} aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );
}
