/**
 * SampleSelection (FT-VSE-16/32, API-06, DR35 §11): the sample block.
 *
 * The owner decision DR35 supersedes O-04/FT-SMP-03 for the create flow: every
 * new card performs a NEW physical selection. The «Использовать имеющуюся
 * пробу» mode is gone — no radio group is shown when only one mode exists.
 * The weight keeps the 0,8 кг default; the collection date lives in the
 * «Итог экспертизы» section (the same single sample date, never a second one).
 * For a saved card the mode is EDIT by definition of the card state: the same
 * physical fact is corrected under revision rules, never re-selected.
 */
import type { ExaminationView } from "./api";
import { FormSection } from "../../shared/ui/FormSection";
import type { ExaminationFormValues, SampleEntry } from "./formValues";

export interface SampleSelectionProps {
  values: ExaminationFormValues;
  view: ExaminationView | null;
  disabled: boolean;
  onChange: (values: ExaminationFormValues) => void;
}

export function SampleSelection({
  values,
  view,
  disabled,
  onChange,
}: SampleSelectionProps): React.ReactElement {
  const sample = values.sample;
  const setSample = (next: SampleEntry): void => onChange({ ...values, sample: next });
  const isEdit = view !== null && view.sample_collection_id !== "";

  return (
    <FormSection
      icon="exam-sample"
      title="Проба"
      description={isEdit ? "Правка пробы этой партии." : "Новый отбор пробы этой партии."}
    >
      <div className="vse-sample-inputs">
        <label className="app-field">
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
      </div>
      {sample.mode === "NEW" && sample.collectedOn === "" ? (
        <p className="vse-exam-note">Дата отбора указывается в секции «Итог экспертизы».</p>
      ) : null}
      {isEdit ? (
        <p className="vse-exam-note">Правка сохраняет тот же физический факт отбора по правилам ревизий.</p>
      ) : null}
    </FormSection>
  );
}
