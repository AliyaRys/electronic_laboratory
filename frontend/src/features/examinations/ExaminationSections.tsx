/**
 * ExaminationSections (DR30): the readonly party facts re-composed into the
 * mockup sections of electronic-vse-journal.html. The data stays exactly the
 * confirmed party's facts (SC-033/034) — only the composition and the readonly
 * presentation follow the reference; empty values are honest «—» and no
 * mockup demo data is ever shown.
 */
import type { IncomingView } from "../arrivals/api";
import { FormSection } from "../../shared/ui/FormSection";
import { InfoField } from "../../shared/ui/InfoField";
import { ReadonlyField } from "../../shared/ui/ReadonlyField";

/** Section «Сведения об экспертизе»: the document facts of the party. */
export function ExaminationFactsSection({
  party,
  children,
}: {
  party: IncomingView;
  /** Editable form fields of this section (e.g. Номер ВСЭ *). */
  children?: React.ReactNode;
}): React.ReactElement {
  const fields = party.external.fields;
  return (
    <FormSection
      icon="check-document"
      title="Сведения об экспертизе"
      description="Регистрационные данные и ветеринарный сопроводительный документ."
    >
      <div className="vse-exam-grid">
        {children}
        <div className="vse-span6">
          <ReadonlyField label="UUID ВСД" value={fields.documentUuid ?? ""} />
        </div>
        <div className="vse-span6">
          <ReadonlyField label="Дата оформления ВСД" value={fields.issuedOn ?? ""} />
        </div>
      </div>
    </FormSection>
  );
}

/** One participant card of the mockup (title, предприятие, владелец продукции). */
export function ParticipantCard({
  title,
  enterprise,
  owner,
}: {
  title: string;
  enterprise: string;
  owner: string;
}): React.ReactElement {
  return (
    <article className="vse-participant vse-span6" aria-label={title}>
      <h3>{title}</h3>
      <ReadonlyField label="Название предприятия" value={enterprise} multiline />
      <ReadonlyField label="Владелец продукции" value={owner} />
    </article>
  );
}

/**
 * Section «Участники и продукция»: two participant cards, the classification
 * levels and the accepted volume; the editable stamp field is slotted in by
 * the form (children), because its value lives in the form state.
 */
export function ParticipantsSection({
  party,
  children,
}: {
  party: IncomingView;
  children: React.ReactNode;
}): React.ReactElement {
  const sender = party.external.fields;
  const classification = party.classification;
  return (
    <FormSection
      icon="exam-participants"
      title="Участники и продукция"
      description="Сведения об отправителе, получателе и классификация продукции."
    >
      <div className="vse-exam-grid">
        <ParticipantCard
          title="Сведения об отправителе"
          enterprise={sender.consignor ?? ""}
          owner={sender.consignorOwner ?? ""}
        />
        <ParticipantCard
          title="Сведения о получателе"
          enterprise={sender.consignee ?? ""}
          owner={sender.consigneeOwner ?? ""}
        />
        <div className="vse-span6">
          <ReadonlyField
            label="Тип продукции"
            value={classification.productType != null ? String(classification.productType) : ""}
          />
        </div>
        <div className="vse-span6">
          <ReadonlyField label="Продукция" value={classification.product?.name ?? ""} />
        </div>
        <div className="vse-span6">
          <ReadonlyField label="Вид продукции" value={classification.subProduct?.name ?? ""} />
        </div>
        <div className="vse-span6">
          <ReadonlyField label="Название продукции" value={classification.productItem?.name ?? ""} />
        </div>
        <div className="vse-span4">
          <ReadonlyField
            label="Принятый вес, кг"
            value={party.confirmation !== null ? String(party.confirmation.accepted_mass_kg) : ""}
          />
        </div>
        <div className="vse-span4">
          <ReadonlyField
            label="Принятое количество"
            value={
              party.confirmation !== null
                ? `${party.confirmation.accepted_quantity} ${party.confirmation.accepted_unit_id}`
                : ""
            }
          />
        </div>
        {children}
        <p className="vse-confirm-note vse-span12">Партия подтверждена внешним результатом</p>
      </div>
    </FormSection>
  );
}

/** The readonly party facts block (VSE-F01–15) shown on the view card page. */
export function PartyReadonlyFacts({
  party,
  headline = "Сведения об экспертизе",
}: {
  party: IncomingView;
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
