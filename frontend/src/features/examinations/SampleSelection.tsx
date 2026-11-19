/**
 * SampleSelection (FT-VSE-16/32, API-06, DR35 §11; ТЗ DR55 §5.2): the unified
 * «Проба» block — the collection date, the mass and the sent-to-lab flag live
 * HERE, no longer in «Итог экспертизы». The values and the payload keep their
 * old wire names (`sample.collectedOn`, `sample.massKg`, `sentToLab`); the
 * WAITING rule, the edit-disabled checkbox and the server contract are not
 * touched. All state enters through explicit props — the component never
 * reaches into unrelated parts of the form.
 */
import type { ExaminationView } from "./api";
import { FormSection } from "../../shared/ui/FormSection";
import type { ExaminationFormValues, SampleEntry } from "./formValues";

export interface SampleSelectionProps {
  values: ExaminationFormValues;
  view: ExaminationView | null;
  /** The Europe/Moscow server day (`max` of the date input, SPEC-05). */
  today: string;
  /** The busy state of the whole form (all controls stay consistent). */
  disabled: boolean;
  /** The `sentToLab` flag is a separate form value, not part of `sample`. */
  sentToLab: boolean;
  onSentToLabChange: (checked: boolean) => void;
  onChange: (values: ExaminationFormValues) => void;
}

export function SampleSelection({
  values,
  view,
  today,
  disabled,
  sentToLab,
  onSentToLabChange,
  onChange,
}: SampleSelectionProps): React.ReactElement {
  const sample = values.sample;
  const setSample = (next: SampleEntry): void => onChange({ ...values, sample: next });
  const isEdit = view !== null && view.sample_collection_id !== "";
  // ТЗ §5.2: editing an already sent sample keeps the flag unreachable.
  const sentDisabled = disabled || (isEdit && (view?.sent_to_lab ?? false));

  return (
    <FormSection
      icon="exam-sample"
      title="Проба"
      description={isEdit ? "Правка пробы этой партии." : "Новый отбор пробы этой партии."}
    >
      {/* ТЗ DR55 §5.2 geometry: one grid, `align-items: end` so the checkbox
          line sits on the same bottom line as the two fields; up to 700px
          everything stacks in one column (Дата → Масса → чекбокс). */}
      <div className="vse-sample-inputs">
        <label className="app-field vse-sample-date">
          <span className="app-field-heading">
            <span>Дата отбора проб *</span>
          </span>
          <input
            type="date"
            max={today}
            value={sample.collectedOn}
            disabled={disabled}
            aria-label="Дата отбора проб"
            onChange={(event) => setSample({ ...sample, collectedOn: event.target.value })}
          />
        </label>
        <label className="app-field vse-sample-mass">
          <span className="app-field-heading">
            <span>Вес взятой пробы, кг *</span>
          </span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={sample.massKg}
            disabled={disabled}
            aria-label="Вес взятой пробы, кг"
            onChange={(event) => setSample({ ...sample, massKg: event.target.value })}
          />
        </label>
        <label className="vse-sent-flag">
          <input
            type="checkbox"
            checked={sentToLab}
            disabled={sentDisabled}
            onChange={(event) => onSentToLabChange(event.target.checked)}
          />
          Пробы отправлены на специальные лабораторные исследования
        </label>
      </div>
      {isEdit ? (
        <p className="vse-exam-note">Правка сохраняет тот же физический факт отбора по правилам ревизий.</p>
      ) : null}
    </FormSection>
  );
}
