/**
 * SampleSelection (FT-VSE-16/32, API-06): the sample block of the form.
 *
 * NEW carries a positive mass prefilled with 0,8 кг and a date (never a future
 * day); REUSE reuses an available collection of the same party without
 * charging and is the DEFAULT when one exists; EDIT is a same-day correction
 * of the currently linked collection with its expected revision. The readonly
 * accepted volume of the party is shown next to the block (VSE-F13–15).
 */
import type { CollectionView } from "../samples/api";
import type { ExaminationView } from "./api";
import { DEFAULT_SAMPLE_MASS_KG, type ExaminationFormValues, type SampleEntry } from "./formValues";
import { InfoField } from "../../shared/ui/InfoField";

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
    <section className="vse-exam-block" aria-label="Проба">
      <h3>Проба</h3>
      <div className="vse-sample-modes">
        <label className="vse-comparison-mark">
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
        <label className="vse-comparison-mark">
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
          <label className="vse-comparison-mark">
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
          <p className="vse-exam-note">Повторное использование не начисляет отбор повторно (FT-SMP-03).</p>
        </div>
      )}
      {view !== null && view.sample_collection_id !== "" ? (
        <dl className="vse-exam-facts">
          <div>
            <dt>Связанная проба</dt>
            <dd>{view.sample_collection_id}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

/** The readonly party facts block (VSE-F01–15) shown on the form and view. */
export function PartyReadonlyFacts({
  party,
  headline = "Сведения об экспертизе",
}: {
  party: import("../arrivals/api").IncomingView;
  headline?: string;
}): React.ReactElement {
  const sender = party.external.fields;
  const classification = party.classification;
  return (
    <section className="vse-exam-block" aria-label={headline}>
      <h3>{headline}</h3>
      <dl className="vse-exam-facts">
        <div>
          <dt>UUID ВСД</dt>
          <dd>{party.external.fields.documentUuid ?? "—"}</dd>
        </div>
        <div>
          <dt>Дата оформления ВСД</dt>
          <dd>{party.external.fields.issuedOn ?? "—"}</dd>
        </div>
        <div>
          <dt>Отправитель — предприятие</dt>
          <dd>{sender.consignor ?? "—"}</dd>
        </div>
        <div>
          <dt>Отправитель — владелец</dt>
          <dd>{sender.consignorOwner ?? "—"}</dd>
        </div>
        <div>
          <dt>Получатель — предприятие</dt>
          <dd>{sender.consignee ?? "—"}</dd>
        </div>
        <div>
          <dt>Получатель — владелец</dt>
          <dd>{sender.consigneeOwner ?? "—"}</dd>
        </div>
        <div>
          <dt>Тип продукции</dt>
          <dd>{classification.productType ?? "—"}</dd>
        </div>
        <div>
          <dt>Продукция</dt>
          <dd>{classification.product?.name ?? "—"}</dd>
        </div>
        <div>
          <dt>Вид продукции</dt>
          <dd>{classification.subProduct?.name ?? "—"}</dd>
        </div>
        <div>
          <dt>Название продукции</dt>
          <dd>{classification.productItem?.name ?? "—"}</dd>
        </div>
        <div>
          <dt>Принятый вес, кг</dt>
          <dd>{party.confirmation?.accepted_mass_kg ?? "—"}</dd>
        </div>
        <div>
          <dt>Принятое количество</dt>
          <dd>
            {party.confirmation !== null
              ? `${party.confirmation.accepted_quantity} ${party.confirmation.accepted_unit_id}`
              : "—"}
          </dd>
        </div>
      </dl>
      <InfoField label="Статус приёмки" value="Партия подтверждена внешним результатом" />
    </section>
  );
}
