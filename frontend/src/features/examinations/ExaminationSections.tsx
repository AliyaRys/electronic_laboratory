/**
 * ExaminationSections (DR30 composition, DR35 data rules): the readonly party
 * facts re-composed into the mockup sections of electronic-vse-journal.html.
 *
 * DR35 §5/§6/§7/§8: the data comes from the unified read model — «Предприятие»
 * and «Хозяйствующий субъект» in BOTH participant cards (never «Название
 * предприятия»/«Владелец продукции», never a swapped enterprise/owner), the
 * product type in Russian through the shared formatter, the accepted mass and
 * the ACCEPTED QUANTITY of the confirmed reconciliation formatted without a
 * JS number (no unit GUID is ever shown), and the obsolete
 * «Партия подтверждена внешним результатом» note is gone (§8).
 */
import type { IncomingView } from "../arrivals/api";
import { participantName } from "../arrivals/api";
import { formatDecimalDisplay, productTypeLabel } from "../../shared/lib/domain";
import { FormSection } from "../../shared/ui/FormSection";
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

/** One participant card of the mockup (title, Предприятие, Хозяйствующий субъект). */
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
      <ReadonlyField label="Предприятие" value={enterprise} multiline />
      <ReadonlyField label="Хозяйствующий субъект" value={owner} />
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
  participants,
  children,
}: {
  party: IncomingView;
  /** DR35 §5: the unified read-model participant names, when the form view is loaded. */
  participants?: Readonly<Record<string, { name: string | null; state: string } | undefined>> | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  const classification = party.classification;
  const name = (key: string, fallback: string): string => {
    const entry = participants?.[key];
    return entry !== undefined && entry.name !== null && entry.name.trim() !== "" ? entry.name : fallback;
  };
  const senderEnterprise = name("senderEnterprise", participantName(party, "sender", "enterprise").value);
  const senderOwner = name("senderOwner", participantName(party, "sender", "owner").value);
  const receiverEnterprise = name(
    "receiverEnterprise",
    participantName(party, "receiver", "enterprise").value,
  );
  const receiverOwner = name("receiverOwner", participantName(party, "receiver", "owner").value);
  const confirmation = party.confirmation;
  const productType = productTypeLabel(classification.productType);
  return (
    <FormSection
      icon="exam-participants"
      title="Участники и продукция"
      description="Сведения об отправителе, получателе и классификация продукции."
    >
      <div className="vse-exam-grid">
        <ParticipantCard title="Сведения об отправителе" enterprise={senderEnterprise} owner={senderOwner} />
        <ParticipantCard
          title="Сведения о получателе"
          enterprise={receiverEnterprise}
          owner={receiverOwner}
        />
        <div className="vse-span6">
          <ReadonlyField label="Тип продукции" value={productType} />
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
            value={confirmation !== null ? formatDecimalDisplay(confirmation.accepted_mass_kg) : ""}
          />
        </div>
        <div className="vse-span4">
          <ReadonlyField
            label="Принятое количество мест, шт."
            value={confirmation !== null ? formatDecimalDisplay(confirmation.accepted_quantity) : ""}
          />
        </div>
        {children}
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
  const classification = party.classification;
  const confirmation = party.confirmation;
  const senderEnterprise = participantName(party, "sender", "enterprise");
  const senderOwner = participantName(party, "sender", "owner");
  const receiverEnterprise = participantName(party, "receiver", "enterprise");
  const receiverOwner = participantName(party, "receiver", "owner");
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
          <dt>Отправитель — Предприятие</dt>
          <dd>{senderEnterprise.value}</dd>
        </div>
        <div>
          <dt>Отправитель — Хозяйствующий субъект</dt>
          <dd>{senderOwner.value}</dd>
        </div>
        <div>
          <dt>Получатель — Предприятие</dt>
          <dd>{receiverEnterprise.value}</dd>
        </div>
        <div>
          <dt>Получатель — Хозяйствующий субъект</dt>
          <dd>{receiverOwner.value}</dd>
        </div>
        <div>
          <dt>Тип продукции</dt>
          <dd>
            {typeof classification.productType === "number"
              ? productTypeLabel(classification.productType)
              : "Название типа продукции не получено"}
          </dd>
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
          <dd>{confirmation !== null ? formatDecimalDisplay(confirmation.accepted_mass_kg) : "—"}</dd>
        </div>
        <div>
          <dt>Принятое количество мест, шт.</dt>
          <dd>{confirmation !== null ? formatDecimalDisplay(confirmation.accepted_quantity) : "—"}</dd>
        </div>
      </dl>
      {/* DR35 §8: the confirm-note is deliberately gone — the ability to open
          the creation IS the confirmation sign; provenance stays in data. */}
    </section>
  );
}
