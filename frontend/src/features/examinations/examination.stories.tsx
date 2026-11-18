/**
 * E04 examination stories: the composed form, the typed outcome block, the
 * sample selection, the readonly party facts, the journal rows and the
 * delete dialog. Significant states: default, busy/disabled, long data,
 * narrow — the stories keep the same components the pages render.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExaminationForm } from "./ExaminationForm";
import { OutcomeFields, outcomeText } from "./OutcomeFields";
import { PartyReadonlyFacts } from "./ExaminationSections";
import { ResearchFields } from "./ResearchFields";
import { PricingSection } from "./PricingPreview";
import { CheckSectionCard } from "../arrivals/CheckSectionCard";
import { SavedResearchResults } from "./SavedResearchResults";
import { SavedPricingTable } from "./SavedPricingTable";
import { Button } from "../../shared/ui/Button";
import { DeleteDialog } from "./DeleteDialog";
import { JournalRow } from "../../pages/ExaminationJournalPage";
import type { ExaminationJournalItem } from "../examinations/api";
import { emptyOutcome, emptyResearch, type ExaminationFormValues, type ResearchEntry } from "./formValues";
import { INDICATORS } from "./indicators";
import type { CollectionView } from "../samples/api";
import type { IncomingView } from "../arrivals/api";
import type { ExaminationFormView, ExaminationView, PricingSnapshotView } from "./api";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const ME = "77777777-7777-4777-8777-777777777777";
const OTHER = "88888888-8888-4888-8888-888888888888";
const TRICHINELLA_ID = "adf96c8a-a6d6-50c4-9ec9-86f058b329f1";
const ORGANOLEPTIC_ID = "c8d1e50e-bf49-5475-bb82-860f6fc47e74";
const TEMPERATURE_ID = "ec2fba68-e4d1-5c82-9591-92ee9da5293e";

const party: IncomingView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
      issuedOn: "2026-11-03",
      senderEnterprise:
        "КФХ Шайдуллин Азат Рашидович (422336, Республика Татарстан, Кайбицкий район, с. Молькеево)",
      senderEnterpriseNameSource: "SOURCE_XML",
      senderOwner: "Шайдуллин Азат Рашидович, ИНН: 210803077517",
      senderOwnerNameSource: "SOURCE_XML",
      receiverEnterprise:
        "Акционерное общество «Агропромышленный парк „Казань“» (420061, г. Казань, Аграрная ул., д. 2)",
      receiverEnterpriseNameSource: "SOURCE_XML",
      receiverOwner: "Хусаинова Зельфия Тимергалиевна, ИНН: 210302212275",
      receiverOwnerNameSource: "SOURCE_XML",
    },
  },
  classification: {
    productType: 1,
    product: { id: "p", name: "Мясо и мясопродукты" },
    subProduct: { id: "sp", name: "Говядина" },
    productItem: { id: "pi", name: "Говядина в четвертинах охлаждённая" },
    unit: { id: "u", name: "штука" },
  },
  documentary: { mass_kg: "140.500000", quantity: "5.000000", unit_id: "шт" },
  confirmation: {
    id: "c1000000-0000-4000-8000-000000000001",
    accepted_mass_kg: "140.500000",
    accepted_quantity: "5.000000",
    accepted_unit_id: "шт",
    returned_mass_kg: "0",
    returned_quantity: "0",
    confirmed_at: "2026-11-07T10:00:00Z",
  },
  queue: "WORK",
  examination_id: null,
  revision: 1,
  source_presence: "CURRENT_CONFIRMED",
};

const collection: CollectionView = {
  id: "44444444-4444-4444-8444-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  product_species_id: "33333333-3333-4333-8333-333333333333",
  classification_snapshot: { product: { id: "s", name: "говядина" } },
  collected_on: "2026-11-06",
  mass_kg: "12.6",
  collected_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  product_name: "Говядина",
  evsd_uuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
  collected_by_name: "Ветеринарный врач",
  created_at: "2026-11-06T10:00:00Z",
  disposal_id: null,
  revision: 1,
};

const savedCard: ExaminationView = {
  id: "e0000000-0000-4000-8000-000000000001",
  party_id: PARTY,
  laboratory_id: LAB,
  number: "№ 12/2026",
  stamp: "кл-1471",
  status: "WAITING",
  sent_to_lab: true,
  researches: [],
  invasive_findings: [],
  noncontagious_findings: [],
  pricing: { lines: [], total: "0.00", currency: "RUB", fair: false },
  sample_collection_id: collection.id,
  sample: {
    id: collection.id,
    collected_on: "2026-11-05",
    mass_kg: "0.800000",
    revision: 1,
  },
  outcome: null,
  direction: null,
  reason: null,
  created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  specialist_id: ME,
  specialist_name: "Кузнецова Алиса Викторовна",
  created_at: "2026-11-07T10:00:00Z",
  first_completed_at: null,
  revision: 1,
};

const formView: ExaminationFormView = {
  party_id: PARTY,
  laboratory_id: LAB,
  participants: {},
  product: { id: "p", name: "Мясо и мясопродукты" },
  sub_product: null,
  product_item: null,
  unit: null,
  product_type: 1,
  product_type_label: "Мясо и мясопродукты",
  accepted: { massKg: "140.500000", quantity: "5.000000", unitId: "шт", unitName: "штука" },
  required_research_ids: [],
  eligible_specialists: [
    { id: ME, fullName: "Кузнецова Алиса Викторовна" },
    { id: OTHER, fullName: "Сафина Лилия Рустамовна" },
  ],
  source_revision: "1f0e6d2a-1111-4222-8333-444444444444",
  reconciliation_revision: 1,
  revision: 1,
};

function withProviders(node: React.ReactElement): React.ReactElement {
  const client = new QueryClient();
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        {/* The canonical app theme context: every --app-* token used by the
            form styles is declared on .vse-app, so stories must render
            inside the same shell as the working page. */}
        <div className="vse-app">{node}</div>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const meta: Meta = {
  title: "E04/Карточка ВСЭ",
};
export default meta;

const formRender = () =>
  withProviders(
    <ExaminationForm
      party={party}
      view={null}
      today="2026-11-07"
      availableCollections={[collection]}
      formView={formView}
      currentUserId={ME}
      onSaved={() => undefined}
      onCancel={() => undefined}
    />,
  );

export const ФормаНовая: StoryObj = {
  render: formRender,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

/** DR35 §11: every new card performs a NEW physical selection. */
export const ПробаНовыйОтбор: StoryObj = {
  render: formRender,
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story:
          "Решение владельца DR35: для каждой новой карточки выполняется только новый отбор пробы (REUSE исключён).",
      },
    },
  },
};

export const ФормаУзкийЭкран: StoryObj = {
  render: formRender,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

/** The research-only composition for typed research states (same components
 * as the page: ResearchFields inside its shared FormSection shell). */
function researchValues(performed: Record<string, Partial<ResearchEntry>>): ExaminationFormValues {
  const researches: ExaminationFormValues["researches"] = {};
  for (const def of INDICATORS) {
    researches[def.id] = emptyResearch({ performed: def.mandatory, ...performed[def.id] });
  }
  return {
    specialistId: ME,
    number: "",
    stamp: "",
    sentToLab: false,
    sample: { mode: "NEW", collectedOn: "2026-11-07", massKg: "0.8", collectionId: "", expectedRevision: "" },
    researches,
    invasive: [],
    noncontagious: [],
    outcome: emptyOutcome(),
  };
}

const researchRender = (
  values: ExaminationFormValues,
  requiredResearchIds: ReadonlySet<string> = new Set(),
  evaluations?: ReadonlyMap<string, import("./ResearchFields").ResearchEvaluation>,
) => (
  <ResearchFields
    values={values}
    view={null}
    disabled={false}
    requiredResearchIds={requiredResearchIds}
    evaluations={evaluations}
    onChange={() => undefined}
  />
);

const F18_ID = "c8d1e50e-bf49-5475-bb82-860f6fc47e74";
const F19_ID = "5410ca53-ffae-5a27-ab8d-51cb20fe4011";
const F22_ID = "6e126f72-4871-566b-809b-8765c562d2d6";
const F23_ID = "e6be5304-d6d2-5f49-86a3-8e1308b344d4";
const F24_ID = "72c55a55-4708-58d5-8d69-ec1c7ee2d1f9";

/** ТЗ DR41-B §9.4 п.10: the typed server evaluation highlight of the research
 * cards — fixed norm, deviation, unknown (with the honest legacy hint) and
 * the norm-free бактериоскопия. */
export const ОценкаНормВКарточках: StoryObj = {
  render: () =>
    researchRender(
      researchValues({
        [F22_ID]: { performed: true, value: "MATCH" },
        [F23_ID]: { performed: true, value: "рост не обнаружен" },
        [F24_ID]: { performed: true, value: "2.5" },
        [F19_ID]: { performed: true, value: "MISMATCH" },
      }),
      new Set(),
      new Map([
        [F18_ID, { status: "IN_NORM" }],
        [F22_ID, { status: "IN_NORM" }],
        [F19_ID, { status: "DEVIATION" }],
        [
          F24_ID,
          {
            status: "UNKNOWN",
            hint: "Норма сохранена в устаревшем целочисленном формате: пересохраните норму показателя в справочнике.",
          },
        ],
        [F23_ID, { status: "NOT_APPLICABLE" }],
      ]),
    ),
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story:
          "ТЗ DR41-B §7: подсветка карточек из typed evaluation серверного preview. Цвет всегда сопровождается текстом; итог врача FIT/UNFIT не подменяется.",
      },
    },
  },
};

export const ОценкаНормУзкийЭкран: StoryObj = {
  render: () =>
    researchRender(
      researchValues({
        [F22_ID]: { performed: true, value: "MATCH" },
        [F19_ID]: { performed: true, value: "MISMATCH" },
      }),
      new Set(),
      new Map([
        [F18_ID, { status: "IN_NORM" }],
        [F22_ID, { status: "IN_NORM" }],
        [F19_ID, { status: "DEVIATION" }],
      ]),
    ),
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

/** ТЗ DR41-B §9.4 п.10: while the preview loads the cards stay calm — no
 * fabricated verdict and no colour; the missing-configuration problem keeps
 * its honest StatusView wording. */
export const ОценкаНормЗагрузкаИОшибка: StoryObj = {
  render: () => (
    <div className="vse-app" style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <PricingSection state={{ status: "loading" }} disabled={false} onRetry={() => undefined} />
      <PricingSection
        state={{
          status: "missing",
          problem: {
            type: "about:blank",
            title: "Configuration missing",
            status: 422,
            detail:
              "Не настроена стоимость исследования «Микроскопия» (код VSE-F24) для выбранного вида продукции. Откройте справочник «Стоимость исследований» и настройте этот показатель.",
            code: "CONFIGURATION_MISSING",
            trace_id: "",
          },
        }}
        disabled={false}
        onRetry={() => undefined}
      />
    </div>
  ),
  parameters: { viewport: { defaultViewport: "desktop" } },
};

/** DR35: требуемые исследования приходят с сервера (required_research_ids)
 * и закрепляются за партией, а не выбираются на форме. */
export const ТрихинеллоскопияОбязательна: StoryObj = {
  render: () =>
    researchRender(researchValues({ [TRICHINELLA_ID]: { performed: true } }), new Set([TRICHINELLA_ID])),
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story:
          "Свинина/конина: трихинеллоскопия закреплена сервером (required_research_ids) и недоступна для снятия; condition остаётся в справочнике Меркурия.",
      },
    },
  },
};

export const ДополнительныеИсследованияДобавлены: StoryObj = {
  render: () =>
    researchRender(
      researchValues({
        "adf96c8a-a6d6-50c4-9ec9-86f058b329f1": { performed: true },
        "6e126f72-4871-566b-809b-8765c562d2d6": { performed: true },
        "e6be5304-d6d2-5f49-86a3-8e1308b344d4": { performed: true, value: "стафилококк" },
        "fcca2571-990b-53bb-8b7b-9144643cb890": { performed: true, first: "0.12", last: "0.10" },
      }),
    ),
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const ИнвазионныеБолезниДобавлены: StoryObj = {
  render: () => {
    const values = researchValues({});
    values.invasive = [{ disease: "Цистицеркоз", location: "печень", otherText: "" }];
    values.noncontagious = [{ disease: "Пастереллёз", location: "", otherText: "" }];
    return withProviders(researchRender(values));
  },
};

export const ФормаДлинныеЗначения: StoryObj = {
  render: () =>
    withProviders(
      <ExaminationForm
        party={{
          ...party,
          external: {
            ...party.external,
            fields: {
              ...party.external.fields,
              consignor:
                "Общество с ограниченной ответственностью «Научно-производственное объединение по комплексной переработке мясного сырья и производству специализированных продуктов питания»",
            },
          },
        }}
        view={null}
        today="2026-11-07"
        availableCollections={[]}
        formView={formView}
        currentUserId={ME}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    ),
};

/** The WAITING card in the same-day edit: the outcome block honestly shows
 * that the conclusion is entered later, as a separate action. */
export const ОжиданиеПравкаБезИтога: StoryObj<typeof ExaminationForm> = {
  render: (args) => withProviders(<ExaminationForm {...args} />),
  args: {
    party,
    view: savedCard,
    today: "2026-11-07",
    availableCollections: [collection],
    formView,
    currentUserId: ME,
    onSaved: () => undefined,
    onCancel: () => undefined,
  },
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story: "Ожидающая карточка: итог не показан как завершённый; отдельное позднее действие.",
      },
    },
  },
};

/** The busy/disabled state of the sticky action panel: the same Button
 * component with the real busy captions of the create actions. */
export const ПанельДействийЗанята: StoryObj = {
  render: () => (
    <div className="vse-app">
      <div className="vse-exam-actions" style={{ position: "static" }}>
        <Button disabled onClick={() => undefined}>
          Отменить
        </Button>
        <Button variant="primary" busy busyLabel="Сохраняем ожидание…" onClick={() => undefined}>
          Отправить в ожидание результата
        </Button>
        <Button variant="primary" disabled onClick={() => undefined}>
          Завершить ВСЭ
        </Button>
      </div>
    </div>
  ),
  parameters: {
    docs: { description: { story: "busy/disabled состояния панели действий во время запроса." } },
  },
};

export const ИтогНеВыбран: StoryObj<typeof OutcomeFields> = {
  render: (args) => <OutcomeFields {...args} />,
  args: {
    value: emptyOutcome(),
    disabled: false,
    onChange: () => undefined,
  },
};

export const ИтогНепригодно: StoryObj<typeof OutcomeFields> = {
  render: (args) => <OutcomeFields {...args} />,
  args: {
    value: { outcome: "UNFIT", direction: "DISPOSAL", reason: "Посторонние включения в мышечной ткани" },
    disabled: false,
    onChange: () => undefined,
  },
};

export const ИтогНедоступен: StoryObj<typeof OutcomeFields> = {
  render: (args) => <OutcomeFields {...args} />,
  args: {
    value: emptyOutcome(),
    disabled: true,
    onChange: () => undefined,
  },
};

const partyRender = () => <PartyReadonlyFacts party={party} headline="Подтверждённая партия" />;

export const ПартияТолькоЧтение: StoryObj = {
  render: partyRender,
};

export const ПартияУзкийЭкран: StoryObj = {
  render: partyRender,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

// ТЗ DR45 §1: the journal rows carry the scoped read model fields.
const journalItem = (
  examinationId: string,
  overrides: Partial<ExaminationJournalItem> = {},
): ExaminationJournalItem => ({
  examination_id: examinationId,
  party_id: PARTY,
  laboratory_id: LAB,
  number: "ВСЭ-001",
  stamp: "Клеймо-1",
  status: "COMPLETED",
  created_at: "2026-11-07T07:00:00Z",
  first_completed_at: "2026-11-07T10:00:00Z",
  outcome: "FIT",
  specialist_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  specialist_name: "Ветеринарный врач",
  evsd_uuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
  consignor_name: "ООО «Мясопром»",
  ...overrides,
});

const waitingRow = journalItem("e0000000-0000-4000-8000-000000000001", {
  status: "WAITING",
  outcome: null,
  first_completed_at: null,
  consignor_name: null,
  specialist_name: null,
});
const completedRow = journalItem("e0000000-0000-4000-8000-000000000002");

const waitingRender = () => <JournalRow labId={LAB} view={waitingRow} />;

export const ЖурналОжидание: StoryObj = {
  render: waitingRender,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const ЖурналЗавершено: StoryObj = {
  render: () => <JournalRow labId={LAB} view={completedRow} />,
};

export const ЖурналУзкийЭкран: StoryObj = {
  render: waitingRender,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

/** ТЗ DR47 §2.3.4: the unknown completed outcome keeps a neutral badge. */
const unknownOutcomeRow = journalItem("e0000000-0000-4000-8000-000000000003", { outcome: null });

export const ЖурналИтогНеУказан: StoryObj = {
  render: () => <JournalRow labId={LAB} view={unknownOutcomeRow} />,
};

export const ДиалогУдаления: StoryObj<typeof DeleteDialog> = {
  render: (args) => withProviders(<DeleteDialog {...args} />),
  args: {
    view: savedCard,
    open: true,
    onClose: () => undefined,
    onDeleted: () => undefined,
  },
};

const pricingSnapshot: PricingSnapshotView = {
  lines: [
    {
      service_code: "liver",
      name: "Исследование на гельминтозы (печень)",
      quantity: "4.000000",
      unit_id: "place",
      unit_price: "100.00",
      amount: "400.00",
    },
    {
      service_code: "muscle",
      name: "Исследование мышечной ткани",
      quantity: "4.000000",
      unit_id: "place",
      unit_price: "100.00",
      amount: "400.00",
    },
  ],
  total: "1200.00",
  currency: "RUB",
  fair: false,
};

/** DR35 §13: the live pricing section renders the server snapshot verbatim —
 * money is never computed in the browser. */
export const ПредварительныйРасчёт: StoryObj = {
  render: () => (
    <div className="vse-app" style={{ maxWidth: 640 }}>
      <PricingSection
        state={{ status: "success", snapshot: pricingSnapshot }}
        disabled={false}
        onRetry={() => undefined}
      />
    </div>
  ),
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story:
          "Предварительный расчёт стоимости: те же строки и итог, что сохранит финальная оценка (тот же evaluate_and_price).",
      },
    },
  },
};

/** DR43: the fair (ярмарка) preview — the SERVER zeros, never fabricated. */
export const ПредварительныйРасчётЯрмарка: StoryObj = {
  render: () => (
    <div className="vse-app" style={{ maxWidth: 640 }}>
      <CheckSectionCard
        sectionKey="invoice"
        title="Расчёт стоимости услуг"
        description="Услуги по сверке партии и транспорта, их количество, тарифы и итоговая сумма."
      >
        <PricingSection
          state={{
            status: "success",
            snapshot: {
              ...pricingSnapshot,
              fair: true,
              total: "0.00",
              lines: pricingSnapshot.lines.map((line) => ({ ...line, unit_price: "0.00", amount: "0.00" })),
            },
          }}
          disabled={false}
          onRetry={() => undefined}
        />
      </CheckSectionCard>
    </div>
  ),
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story:
          "Режим ярмарки: строки и итог — 0 ₽; отметка отражает fair-флаг серверного preview и не переключается вручную в карточке.",
      },
    },
  },
};

/** DR43: the network error of the live preview with an explicit retry. */
export const ПредварительныйРасчётОшибкаСети: StoryObj = {
  render: () => (
    <div className="vse-app" style={{ maxWidth: 640 }}>
      <CheckSectionCard
        sectionKey="invoice"
        title="Расчёт стоимости услуг"
        description="Услуги по сверке партии и транспорта, их количество, тарифы и итоговая сумма."
      >
        <PricingSection
          state={{
            status: "error",
            problem: {
              type: "about:blank",
              title: "Network error",
              status: 0,
              detail: "Сеть недоступна.",
              code: "NETWORK_ERROR",
              trace_id: "",
            },
          }}
          disabled={false}
          onRetry={() => undefined}
        />
      </CheckSectionCard>
    </div>
  ),
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const ПредварительныйРасчётУзкийЭкран: StoryObj = {
  render: () => (
    <div className="vse-app" style={{ maxWidth: 420 }}>
      <PricingSection
        state={{ status: "success", snapshot: pricingSnapshot }}
        disabled={false}
        onRetry={() => undefined}
      />
    </div>
  ),
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

/** The readonly outcome text helper (used by the view page). */
export const ИтогТекст: StoryObj = {
  render: () => (
    <dl>
      <dt>Пригодно</dt>
      <dd>{outcomeText("FIT", "SALE")}</dd>
      <dt>Непригодно</dt>
      <dd>{outcomeText("UNFIT", "DESTRUCTION")}</dd>
    </dl>
  ),
};

// --- ТЗ DR44 Task 5: readonly saved-card components ---------------------------------

const savedSnapshot: PricingSnapshotView = {
  lines: [
    {
      service_code: TEMPERATURE_ID,
      name: "Температура в толще мышц",
      quantity: "1",
      unit_id: "service",
      unit_price: "5.00",
      amount: "5.00",
      method_snapshot: { rule: { type: "interval", lower: "0", upper: "10" } },
      evaluation: { status: "IN_NORM" },
    },
    {
      service_code: "liver",
      name: "Исследование на гельминтозы (печень)",
      quantity: "4.000000",
      unit_id: "place",
      unit_price: "100.00",
      amount: "400.00",
    },
  ],
  total: "405.00",
  currency: "RUB",
  fair: false,
};

const savedResearches = (view: Partial<ExaminationView> = {}): ExaminationView => ({
  ...savedCard,
  status: "COMPLETED",
  outcome: "FIT",
  direction: "SALE",
  first_completed_at: "2026-11-07T11:00:00Z",
  researches: [
    { indicatorId: ORGANOLEPTIC_ID, kind: "ENUM", value: "MATCH" },
    { indicatorId: TEMPERATURE_ID, kind: "DECIMAL", value: "4.5" },
    { indicatorId: "00000000-0000-0000-0000-00000000dead", kind: "DECIMAL", value: "7" },
  ],
  ...view,
});

/** ТЗ DR44 §4.2: the saved researches — known names, frozen evaluation, the
 * honest legacy fallback for an unknown indicator. */
export const СохранённыеИсследования: StoryObj = {
  render: () => <SavedResearchResults view={savedResearches()} />,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const СохранённыеИсследованияУзкийЭкран: StoryObj = {
  render: () => <SavedResearchResults view={savedResearches()} />,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

export const СохранённыйРасчёт: StoryObj = {
  name: "Сохранённый расчёт · четыре столбца (ТЗ DR46 §3.4)",
  render: () => <SavedPricingTable snapshot={savedSnapshot} />,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const СохранённыйРасчётДлинноеИсследование: StoryObj = {
  name: "Сохранённый расчёт · длинное название",
  render: () => (
    <SavedPricingTable
      snapshot={{
        ...savedSnapshot,
        lines: [
          ...savedSnapshot.lines.slice(0, 1),
          {
            service_code: "ANTIBIOTICS",
            name: "Определение антибиотиков и сульфаниламидных препаратов в пробах мясной продукции методом жидкостной хроматографии",
            quantity: "2",
            unit_id: "sample",
            unit_price: "120.00",
            amount: "240.00",
            method_snapshot: null,
            evaluation: { status: "IN_NORM" },
          },
          ...savedSnapshot.lines.slice(1),
        ],
        total: "645.00",
      }}
    />
  ),
};

export const СохранённыйРасчётМобильный: StoryObj = {
  name: "Сохранённый расчёт · 390 px (скролл внутри таблицы)",
  render: () => <SavedPricingTable snapshot={savedSnapshot} />,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

export const СохранённыйРасчётЯрмарка: StoryObj = {
  render: () => <SavedPricingTable snapshot={{ ...savedSnapshot, total: "0.00", fair: true }} />,
};

export const СохранённыйРасчётОтсутствует: StoryObj = {
  render: () => <SavedPricingTable snapshot={null} />,
};

export type FormValuesStory = ExaminationFormValues;
