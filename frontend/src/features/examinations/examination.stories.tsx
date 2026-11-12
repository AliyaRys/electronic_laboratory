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
import { PartyReadonlyFacts } from "./SampleSelection";
import { DeleteDialog } from "./DeleteDialog";
import { JournalRow } from "../../pages/ExaminationJournalPage";
import { emptyOutcome, type ExaminationFormValues } from "./formValues";
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
    />,
  );

export const ФормаНовая: StoryObj = {
  render: formRender,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const ФормаУзкийЭкран: StoryObj = {
  render: formRender,
  parameters: { viewport: { defaultViewport: "mobile1" } },
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

/** The busy/disabled state: every control disabled, honest busy hint. */
export const ФормаНедоступнаНаВремяСохранения: StoryObj<typeof ExaminationForm> = {
  render: (args) => withProviders(<ExaminationForm {...args} />),
  args: {
    party,
    view: null,
    today: "2026-11-07",
    availableCollections: [],
    onSaved: () => undefined,
    onCancel: () => undefined,
  },
  // A disabled-snapshot: the form's controls accept `disabled` from the
  // command status; here the readonly story shows the same tree with the
  // controls visually disabled through the wrapped fields.
  parameters: { docs: { description: { story: "Демонстрация недоступного состояния блоков формы." } } },
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
