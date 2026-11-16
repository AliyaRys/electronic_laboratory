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
import { Button } from "../../shared/ui/Button";
import { DeleteDialog } from "./DeleteDialog";
import { JournalRow } from "../../pages/ExaminationJournalPage";
import { emptyOutcome, emptyResearch, type ExaminationFormValues, type ResearchEntry } from "./formValues";
import { INDICATORS } from "./indicators";
import type { CollectionView } from "../samples/api";
import type { IncomingView } from "../arrivals/api";
import type { ExaminationView } from "./api";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

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
      consignor: "КФХ Шайдуллин Азат Рашидович (422336, Республика Татарстан, Кайбицкий район, с. Молькеево)",
      consignorOwner: "Шайдуллин Азат Рашидович, ИНН: 210803077517",
      consignee:
        "Акционерное общество «Агропромышленный парк „Казань“» (420061, г. Казань, Аграрная ул., д. 2)",
      consigneeOwner: "Хусаинова Зельфия Тимергалиевна, ИНН: 210302212275",
    },
  },
  classification: {
    product: { id: "p", name: "Мясо и мясопродукты" },
    subProduct: { id: "sp", name: "Говядина" },
    productItem: { id: "pi", name: "Говядина в четвертинах охлаждённая" },
    unit: { id: "u", name: "штука" },
  },
  documentary: { mass_kg: "140.5", quantity: "2", unit_id: "шт" },
  confirmation: {
    id: "c1000000-0000-4000-8000-000000000001",
    accepted_mass_kg: "140.5",
    accepted_quantity: "2",
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
  outcome: null,
  direction: null,
  reason: null,
  created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  created_at: "2026-11-07T10:00:00Z",
  first_completed_at: null,
  revision: 1,
};

function withProviders(node: React.ReactElement): React.ReactElement {
  const client = new QueryClient();
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
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
      onSaved={() => undefined}
      onCancel={() => undefined}
      specialistName="Кузнецова Алиса Викторовна"
    />,
  );

export const ФормаНовая: StoryObj = {
  render: formRender,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

/** REUSE is the default sample entry whenever an available collection exists. */
export const ПробаПовторноеИспользование: StoryObj = {
  render: formRender,
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story:
          "По умолчанию выбран режим «Использовать имеющуюся пробу» (REUSE) с доступной пробой той же партии.",
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

const researchRender = (values: ExaminationFormValues) => (
  <ResearchFields values={values} view={null} disabled={false} onChange={() => undefined} />
);

export const ТрихинеллоскопияОбязательна: StoryObj = {
  render: () =>
    researchRender(researchValues({ "adf96c8a-a6d6-50c4-9ec9-86f058b329f1": { performed: true } })),
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story:
          "Свинина/конина: трихинеллоскопия добавлена в composition (условие обязательности остаётся на сервере по справочнику Меркурия).",
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
    onSaved: () => undefined,
    onCancel: () => undefined,
    specialistName: "Кузнецова Алиса Викторовна",
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

const waitingRow = { ...party, examination_id: "e0000000-0000-4000-8000-000000000001" };
const completedRow = { ...party, examination_id: "e0000000-0000-4000-8000-000000000002" };

const waitingRender = () => <JournalRow labId={LAB} view={waitingRow} status="WAITING" />;

export const ЖурналОжидание: StoryObj = {
  render: waitingRender,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const ЖурналЗавершено: StoryObj = {
  render: () => <JournalRow labId={LAB} view={completedRow} status="COMPLETED" />,
};

export const ЖурналУзкийЭкран: StoryObj = {
  render: waitingRender,
  parameters: { viewport: { defaultViewport: "mobile1" } },
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

export type FormValuesStory = ExaminationFormValues;
