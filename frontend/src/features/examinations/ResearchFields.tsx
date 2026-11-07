/**
 * ResearchFields (FT-VSE-03–05, E04): the typed VSE research cards.
 *
 * Mandatory indicators (organoleptic, identification, temperature) are always
 * present and cannot be removed. Optional indicators appear only through an
 * explicit «Добавить …» button and leave through an accessible remove button.
 * «Иное (указать)» requires an explanation text, the disease rows (invasive /
 * noncontagious) belong to {@link FindingsFields}. No medical value is ever
 * invented: every control starts empty (UI-03).
 */
import { type ReactNode } from "react";
import type { ExaminationView } from "./api";
import { INDICATORS, INVASIVE_DISEASES, NONCONTAGIOUS_DISEASES, indicator } from "./indicators";
import {
  pricingNotes,
  type ExaminationFormValues,
  type FindingEntry,
  type ResearchEntry,
} from "./formValues";

export interface ResearchFieldsProps {
  values: ExaminationFormValues;
  /** The saved card being edited (snapshot warnings use it). */
  view: ExaminationView | null;
  disabled: boolean;
  onChange: (values: ExaminationFormValues) => void;
  /** Rendered under the cards: server-side pricing warnings come here. */
  children?: ReactNode;
}

export function ResearchFields({
  values,
  view,
  disabled,
  onChange,
  children,
}: ResearchFieldsProps): React.ReactElement {
  const setEntry = (id: string, next: ResearchEntry): void => {
    onChange({ ...values, researches: { ...values.researches, [id]: next } });
  };
  const notes = pricingNotes(values, view);

  return (
    <section className="vse-exam-block" aria-label="Исследования ВСЭ">
      <h3>Исследования ВСЭ</h3>
      <p className="vse-exam-note">
        Обязательные исследования нельзя пропустить (FT-VSE-03). Обязательность трихинеллоскопии для
        конкретной продукции проверяет сервер по справочнику Меркурия.
      </p>
      <div className="vse-research-grid">
        {INDICATORS.map((def) => {
          const entry = values.researches[def.id];
          if (entry === undefined) return null;
          if (!entry.performed) {
            if (def.mandatory) return null;
            return (
              <button
                key={def.id}
                type="button"
                className="vse-research-add"
                disabled={disabled}
                aria-label={`Добавить ${def.addName}`}
                onClick={() => setEntry(def.id, { ...entry, performed: true })}
              >
                ＋ Добавить {def.addName}
              </button>
            );
          }
          return (
            <ResearchCard
              key={def.id}
              id={def.id}
              name={def.name}
              addName={def.addName}
              kind={def.kind}
              unit={def.unit}
              options={def.options}
              mandatory={def.mandatory}
              entry={entry}
              disabled={disabled}
              onChange={(next) => setEntry(def.id, next)}
            />
          );
        })}
      </div>
      {notes.length > 0 ? (
        <ul className="vse-research-notes" aria-label="Особенности расчёта стоимости">
          {notes.map((note) => (
            <li key={note.id}>{`${note.name}: ${note.note}`}</li>
          ))}
        </ul>
      ) : null}
      {children}
      <FindingsFields
        title="Инвазионные болезни"
        items={values.invasive}
        diseases={INVASIVE_DISEASES}
        withLocation
        disabled={disabled}
        addLabel="Добавить инвазионные болезни"
        removePrefix="Удалить инвазионную болезнь"
        onChange={(next) => onChange({ ...values, invasive: next })}
      />
      <FindingsFields
        title="Незаразные болезни"
        items={values.noncontagious}
        diseases={NONCONTAGIOUS_DISEASES}
        withLocation={false}
        disabled={disabled}
        addLabel="Добавить незаразное заболевание"
        removePrefix="Удалить незаразное заболевание"
        onChange={(next) => onChange({ ...values, noncontagious: next })}
      />
    </section>
  );
}

interface ResearchCardProps {
  id: string;
  name: string;
  addName: string;
  kind: string;
  unit?: string | undefined;
  options?: readonly { value: string; label: string; other?: boolean }[] | undefined;
  mandatory: boolean;
  entry: ResearchEntry;
  disabled: boolean;
  onChange: (entry: ResearchEntry) => void;
}

function ResearchCard({
  id,
  name,
  addName,
  kind,
  unit,
  options,
  mandatory,
  entry,
  disabled,
  onChange,
}: ResearchCardProps): React.ReactElement {
  const heading = (
    <header className="vse-research-head">
      <h4>
        {name}
        {mandatory ? <span aria-hidden="true"> *</span> : null}
      </h4>
      {!mandatory ? (
        <button
          type="button"
          className="vse-research-remove"
          disabled={disabled}
          aria-label={`Удалить ${addName}`}
          onClick={() => onChange({ ...entry, performed: false })}
        >
          ×
        </button>
      ) : null}
    </header>
  );
  const label = name + (unit !== undefined ? `, ${unit}` : "");
  return (
    <article className="vse-research">
      {heading}
      {kind === "BOOLEAN" ? (
        <div className="vse-research-marks" role="radiogroup" aria-label={label}>
          <label className="vse-comparison-mark">
            <input
              type="radio"
              name={`research-${id}`}
              checked={entry.value === "true"}
              disabled={disabled}
              onChange={() => onChange({ ...entry, value: "true" })}
            />
            Не обнаружено
          </label>
          <label className="vse-comparison-mark">
            <input
              type="radio"
              name={`research-${id}`}
              checked={entry.value === "false"}
              disabled={disabled}
              onChange={() => onChange({ ...entry, value: "false" })}
            />
            Обнаружено
          </label>
        </div>
      ) : null}
      {kind === "INTEGER" || kind === "DECIMAL" || kind === "TEXT" ? (
        <input
          type={kind === "TEXT" ? "text" : "number"}
          inputMode={kind === "TEXT" ? undefined : "decimal"}
          step={kind === "INTEGER" ? 1 : "any"}
          min={kind === "INTEGER" ? 0 : undefined}
          value={entry.value}
          disabled={disabled}
          aria-label={label}
          placeholder={kind === "TEXT" ? "Введите результат" : undefined}
          onChange={(event) => onChange({ ...entry, value: event.target.value })}
        />
      ) : null}
      {kind === "ENUM" && options !== undefined ? (
        <>
          <select
            value={entry.value}
            disabled={disabled}
            aria-label={label}
            onChange={(event) => onChange({ ...entry, value: event.target.value })}
          >
            <option value="" disabled>
              Выберите результат
            </option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {options.some((option) => option.other && option.value === entry.value) ? (
            <input
              type="text"
              value={entry.otherText}
              disabled={disabled}
              aria-label={`${label}: пояснение`}
              placeholder="Поясните результат"
              onChange={(event) => onChange({ ...entry, otherText: event.target.value })}
            />
          ) : null}
        </>
      ) : null}
      {kind === "DOSIMETRY" ? (
        <div className="vse-dose-grid">
          <label>
            Мощность дозы от партии, мкЗв/ч
            <input
              type="number"
              step="any"
              min={0}
              value={entry.first}
              disabled={disabled}
              aria-label="Мощность дозы от партии, мкЗв/ч"
              onChange={(event) => onChange({ ...entry, first: event.target.value })}
            />
          </label>
          <label>
            Гамма-фон в помещении, мкЗв/ч
            <input
              type="number"
              step="any"
              min={0}
              value={entry.last}
              disabled={disabled}
              aria-label="Гамма-фон в помещении, мкЗв/ч"
              onChange={(event) => onChange({ ...entry, last: event.target.value })}
            />
          </label>
        </div>
      ) : null}
    </article>
  );
}

interface FindingsFieldsProps {
  title: string;
  items: FindingEntry[];
  diseases?: readonly string[] | undefined;
  withLocation: boolean;
  disabled: boolean;
  addLabel: string;
  removePrefix: string;
  onChange: (items: FindingEntry[]) => void;
}

export function FindingsFields({
  title,
  items,
  diseases = [],
  withLocation,
  disabled,
  addLabel,
  removePrefix,
  onChange,
}: FindingsFieldsProps): React.ReactElement {
  const set = (index: number, next: FindingEntry): void => {
    const copy = items.slice();
    copy[index] = next;
    onChange(copy);
  };
  return (
    <div className="vse-findings">
      <p className="vse-exam-note">{title}</p>
      {items.map((item, index) => (
        <div className="vse-finding-row" key={index}>
          <select
            value={item.disease}
            disabled={disabled}
            aria-label={`${title}: наименование болезни`}
            onChange={(event) => set(index, { ...item, disease: event.target.value })}
          >
            <option value="" disabled>
              Выберите болезнь
            </option>
            {diseases.map((disease) => (
              <option key={disease} value={disease}>
                {disease}
              </option>
            ))}
          </select>
          {withLocation ? (
            <input
              type="text"
              value={item.location}
              disabled={disabled}
              aria-label={`${title}: место обнаружения`}
              placeholder="Например, печень"
              onChange={(event) => set(index, { ...item, location: event.target.value })}
            />
          ) : null}
          <button
            type="button"
            className="vse-research-remove"
            disabled={disabled}
            aria-label={`${removePrefix} ${index + 1}`}
            onClick={() => onChange(items.filter((_, taken) => taken !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="vse-research-add"
        disabled={disabled}
        aria-label={addLabel}
        onClick={() => onChange([...items, { disease: "", location: "", otherText: "" }])}
      >
        ＋ {addLabel}
      </button>
    </div>
  );
}

/** Exposed for tests that reference a definition by id. */
export { indicator as indicatorById };
