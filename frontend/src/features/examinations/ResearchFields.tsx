/**
 * ResearchFields (FT-VSE-03–05, E04, DR35 §9/§10): the typed VSE research cards.
 *
 * Universally mandatory indicators (organoleptic, identification, temperature)
 * are always present and cannot be removed. DR35 §9: the party's REQUIRED set
 * comes from the server read model — trichinelloscopy for the four pinned
 * GUID groups is a primary card without a remove control and never appears in
 * the «Добавить …» zone; the frontend never guesses by name. Optional
 * indicators appear only through an explicit «Добавить …» button (the compact
 * dashed mockup style) and leave through an accessible remove button. The
 * disease rows (invasive / noncontagious) keep the existing FindingsFields
 * logic; the collapsed state is a compact add-button without a heavy block.
 */
import { type ReactNode } from "react";
import type { ExaminationView } from "./api";
import { FormSection } from "../../shared/ui/FormSection";
import { INDICATORS, INVASIVE_DISEASES, NONCONTAGIOUS_DISEASES, indicator } from "./indicators";
import { evaluationLabel } from "./PricingPreview";
import {
  pricingNotes,
  type ExaminationFormValues,
  type FindingEntry,
  type ResearchEntry,
} from "./formValues";

/** ТЗ DR41-B §7: the typed evaluation of one performed result, taken from
 * the server preview — never derived from the local `performed` state. */
export interface ResearchEvaluation {
  status: string;
  /** The honest re-save hint of a legacy norm, when the server sent one. */
  hint?: string;
}

export interface ResearchFieldsProps {
  values: ExaminationFormValues;
  /** The saved card being edited (snapshot warnings use it). */
  view: ExaminationView | null;
  disabled: boolean;
  /** DR35 §9.3: the party's required indicator ids from the server read model. */
  requiredResearchIds: ReadonlySet<string>;
  /** ТЗ DR41-B §7.2: the per-indicator evaluation snapshot of the live
   * server preview (absent while the preview has not answered yet). */
  evaluations?: ReadonlyMap<string, ResearchEvaluation> | undefined;
  onChange: (values: ExaminationFormValues) => void;
  /** Rendered under the cards: server-side pricing warnings come here. */
  children?: ReactNode;
}

export function ResearchFields({
  values,
  view,
  disabled,
  requiredResearchIds,
  evaluations,
  onChange,
  children,
}: ResearchFieldsProps): React.ReactElement {
  const setEntry = (id: string, next: ResearchEntry): void => {
    onChange({ ...values, researches: { ...values.researches, [id]: next } });
  };
  const notes = pricingNotes(values, view);
  const isRequired = (id: string): boolean =>
    INDICATORS.find((def) => def.id === id)?.mandatory === true || requiredResearchIds.has(id);
  const addButtons = INDICATORS.filter(
    (def) =>
      !isRequired(def.id) &&
      values.researches[def.id] !== undefined &&
      values.researches[def.id].performed === false,
  );

  return (
    <FormSection
      icon="exam-research"
      title="Исследования ВСЭ"
      description="Результаты основных и дополнительных исследований ветеринарно-санитарной экспертизы."
    >
      <p className="vse-exam-note">
        Обязательные исследования нельзя пропустить; обязательность трихинеллоскопии определяет сервер по
        классификации партии.
      </p>
      <div className="vse-research-grid">
        {INDICATORS.map((def) => {
          const entry = values.researches[def.id];
          if (entry === undefined) return null;
          if (!entry.performed) return null;
          return (
            <ResearchCard
              key={def.id}
              id={def.id}
              name={def.name}
              addName={def.addName}
              kind={def.kind}
              unit={def.unit}
              options={def.options}
              required={isRequired(def.id)}
              entry={entry}
              evaluation={evaluations?.get(def.id)}
              disabled={disabled}
              onChange={(next) => setEntry(def.id, next)}
            />
          );
        })}
      </div>
      {addButtons.length > 0 ? (
        <div className="vse-research-addzone" aria-label="Дополнительные исследования">
          {addButtons.map((def) => (
            <button
              key={def.id}
              type="button"
              className="vse-research-add"
              disabled={disabled}
              aria-label={`Добавить ${def.addName}`}
              onClick={() => setEntry(def.id, { ...values.researches[def.id], performed: true })}
            >
              ＋ Добавить {def.addName}
            </button>
          ))}
        </div>
      ) : null}
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
        hint="Добавьте каждую обнаруженную болезнь и укажите орган или ткань."
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
    </FormSection>
  );
}

interface ResearchCardProps {
  id: string;
  name: string;
  addName: string;
  kind: string;
  unit?: string | undefined;
  options?: readonly { value: string; label: string; other?: boolean }[] | undefined;
  required: boolean;
  entry: ResearchEntry;
  evaluation?: ResearchEvaluation | undefined;
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
  required,
  entry,
  evaluation,
  disabled,
  onChange,
}: ResearchCardProps): React.ReactElement {
  // ТЗ DR41-B §7.2: the typed server evaluation is the only source of the
  // highlight; the text always travels with the colour. While the preview
  // has not answered yet the badge stays calm — no fabricated verdict.
  const evaluationStatus = evaluation?.status;
  const hasEvaluation = evaluationStatus === "IN_NORM" || evaluationStatus === "DEVIATION";
  const heading = (
    <header className="vse-research-head">
      <h4>
        {name}
        {required ? <span aria-hidden="true"> *</span> : null}
      </h4>
      {evaluationStatus !== undefined ? (
        <span className="vse-research-evaluation" data-evaluation={evaluationStatus}>
          {evaluationLabel(evaluationStatus)}
          {evaluation?.hint ? <span className="vse-research-hint"> · {evaluation.hint}</span> : null}
        </span>
      ) : null}
      {!required ? (
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
    <article
      className={required ? "vse-research primary" : "vse-research"}
      data-evaluation={evaluationStatus ?? undefined}
      data-evaluated={hasEvaluation ? "true" : undefined}
    >
      {heading}
      {kind === "BOOLEAN" ? (
        required ? (
          <select
            value={entry.value}
            disabled={disabled}
            aria-label={label}
            onChange={(event) => onChange({ ...entry, value: event.target.value })}
          >
            <option value="" disabled>
              Выберите результат
            </option>
            <option value="true">Соответствует</option>
            <option value="false">Не соответствует</option>
          </select>
        ) : (
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
        )
      ) : null}
      {kind === "DECIMAL" || kind === "TEXT" ? (
        <input
          type="text"
          inputMode={kind === "DECIMAL" ? "decimal" : undefined}
          // ТЗ DR42 §5.2: a text input with the decimal keyboard keeps the
          // intermediate typing («2,») on screen until blur/submit; the
          // comma is normalised to the dot wire form by the value model.
          autoComplete="off"
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
            {/* ТЗ DR42 §5.2: both dosimetry readings are decimal text inputs. */}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={entry.first}
              disabled={disabled}
              aria-label="Мощность дозы от партии, мкЗв/ч"
              onChange={(event) => onChange({ ...entry, first: event.target.value })}
            />
          </label>
          <label>
            Гамма-фон в помещении, мкЗв/ч
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
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
  hint?: string;
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
  hint,
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
      {items.length > 0 ? <h3 className="vse-findings-title">{title}</h3> : null}
      {items.length > 0 && hint !== undefined ? <p className="vse-findings-hint">{hint}</p> : null}
      {items.map((item, index) => (
        <div className={withLocation ? "vse-finding-row" : "vse-finding-row single"} key={index}>
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
