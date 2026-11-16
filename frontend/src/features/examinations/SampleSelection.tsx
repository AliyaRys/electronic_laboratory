/**
 * SampleSelection (FT-VSE-16/32, API-06): the sample block of the form.
 *
 * NEW carries a positive mass prefilled with 0,8 кг and a date (never a future
 * day); REUSE reuses an available collection of the same party without
 * charging and is the DEFAULT when one exists; EDIT is a same-day correction
 * of the currently linked collection with its expected revision. The readonly
 * accepted volume of the party is shown next to the block (VSE-F13–15).
 *
 * DR30: the section keeps its own shell (the working sample model is richer
 * than the static mockup); the mode entry is a segmented radio-group in the
 * mockup style — the active mode is carried by the checked radio glyph, the
 * teal border and an inset ring, never by color alone. The linked collection
 * UUID stays secondary technical information.
 */
import type { CollectionView } from "../samples/api";
import type { ExaminationView } from "./api";
import { FormSection } from "../../shared/ui/FormSection";
import { DEFAULT_SAMPLE_MASS_KG, type ExaminationFormValues, type SampleEntry } from "./formValues";

export interface SampleSelectionProps {
  values: ExaminationFormValues;
  view: ExaminationView | null;
  today: string;
  disabled: boolean;
  /** Available collection facts of the same party (active, not disposed). */
  availableCollections: CollectionView[];
  onChange: (values: ExaminationFormValues) => void;
}

export function SampleSelection({
  values,
  view,
  today,
  disabled,
  availableCollections,
  onChange,
}: SampleSelectionProps): React.ReactElement {
  const sample = values.sample;
  const setSample = (next: SampleEntry): void => onChange({ ...values, sample: next });
  const reuseAvailable = availableCollections.length > 0;

  return (
    <FormSection
      icon="exam-sample"
      title="Проба"
      description="Отбор, повторное использование или правка пробы этой партии."
    >
      <div className="vse-sample-modes" role="radiogroup" aria-label="Режим работы с пробой">
        <label className="vse-sample-mode">
          <input
            type="radio"
            name="sample-mode"
            checked={sample.mode === "NEW"}
            disabled={disabled}
            onChange={() =>
              setSample({
                ...sample,
                mode: "NEW",
                collectedOn: sample.collectedOn === "" ? today : sample.collectedOn,
                massKg: sample.massKg === "" ? DEFAULT_SAMPLE_MASS_KG : sample.massKg,
              })
            }
          />
          Новый отбор
        </label>
        <label className="vse-sample-mode">
          <input
            type="radio"
            name="sample-mode"
            checked={sample.mode === "REUSE"}
            disabled={disabled || !reuseAvailable}
            onChange={() => setSample({ ...sample, mode: "REUSE" })}
          />
          Использовать имеющуюся пробу
        </label>
        {view !== null && view.sample_collection_id !== "" ? (
          <label className="vse-sample-mode">
            <input
              type="radio"
              name="sample-mode"
              checked={sample.mode === "EDIT"}
              disabled={disabled}
              onChange={() =>
                setSample({
                  ...sample,
                  mode: "EDIT",
                  collectionId: view.sample_collection_id,
                })
              }
            />
            Исправить текущую пробу
          </label>
        ) : null}
      </div>
      {sample.mode !== "REUSE" ? (
        <div className="vse-sample-inputs">
          <label className="app-field">
            <span className="app-field-heading">
              <span>Дата отбора проб</span>
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
      ) : (
        <div className="vse-sample-inputs">
          <label className="app-field">
            <span className="app-field-heading">
              <span>Доступная проба</span>
            </span>
            <select
              value={sample.collectionId}
              disabled={disabled}
              aria-label="Доступная проба"
              onChange={(event) => setSample({ ...sample, collectionId: event.target.value })}
            >
              <option value="" disabled>
                Выберите пробу
              </option>
              {availableCollections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {`от ${collection.collected_on}, ${collection.mass_kg} кг`}
                </option>
              ))}
            </select>
          </label>
          <p className="vse-exam-note">Повторное использование не начисляет отбор повторно.</p>
        </div>
      )}
      {view !== null && view.sample_collection_id !== "" ? (
        <p className="vse-sample-secondary">{`Связанная проба: ${view.sample_collection_id}`}</p>
      ) : null}
    </FormSection>
  );
}
