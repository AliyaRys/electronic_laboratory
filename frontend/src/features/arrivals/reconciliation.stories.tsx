/**
 * A02 component stories: ComparisonField, ReceiptDecision, ActPreview and the
 * composed ReconciliationForm (complete, incomplete, forbidden decision,
 * long data and the narrow screen).
 */
import type { Meta, StoryObj } from "@storybook/react";
import { ReconciliationForm } from "./ReconciliationForm";
import { ComparisonField, type ComparisonValue } from "./ComparisonField";
import { ReceiptDecision, type ReceiptDecisionValue } from "./ReceiptDecision";
import { ActPreview } from "./ActPreview";
import { comparedFields, type Decision, type IncomingView, type ReconciliationView } from "./api";

const meta: Meta = {
  title: "A02/Сверка эВСД",
};
export default meta;

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
      documentNumber: "№ A-001234",
      transportNumber: "А123ВС77",
      consignor: "ООО «Мясопром»",
      consignee: "Убойный пункт Ленина, 5",
      productItem: "Отруба говяжьи",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Отруба говяжьи" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 1,
};

const mark = (matches: boolean | null, actual = "", reason = ""): ComparisonValue => ({
  matches,
  actual,
  reason,
});

const completeChecks: ReconciliationView["checks"] = {};
for (const field of comparedFields(party)) {
  completeChecks[field.fieldId] = { matches: true };
}
completeChecks["CHK-F21"] = { matches: false, actual: "100", reason: "Недостача при доставке" };

export const Сравнение: StoryObj<typeof ComparisonField> = {
  render: (args) => <ComparisonField {...args} />,
  args: {
    fieldId: "CHK-F21",
    label: "Вес, кг",
    block: "Идентификация продукции",
    source: "120.0",
    value: mark(false, "100", "Недостача при доставке"),
  },
};

export const РешениеПолноеПринятие: StoryObj<typeof ReceiptDecision> = {
  render: (args) => <ReceiptDecision {...args} />,
  args: {
    value: {
      decision: "ACCEPT_ALL",
      return_reason_code: "",
      return_reason_text: "",
      transaction_planned: false,
      transaction_type: null,
      fair: false,
    } satisfies ReceiptDecisionValue,
    allowed: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
    errors: {},
  },
};

export const РешениеЗапрещено: StoryObj<typeof ReceiptDecision> = {
  render: (args) => <ReceiptDecision {...args} />,
  args: {
    value: {
      decision: null,
      return_reason_code: "",
      return_reason_text: "",
      transaction_planned: null,
      transaction_type: null,
      fair: false,
    } satisfies ReceiptDecisionValue,
    allowed: ["RETURN_ALL"] as Decision[],
    errors: {},
  },
};

export const АктНесоответствия: StoryObj<typeof ActPreview> = {
  render: (args) => <ActPreview {...args} />,
  args: {
    decision: "ACCEPT_ALL",
    act: {
      required: true,
      items: [
        { field_id: "CHK-F21", source: "120.0", actual: "100", reason: "Недостача при доставке" },
        {
          field_id: "CHK-F10",
          source: "А123ВС77",
          actual: "В456МК77",
          reason: "Замена транспортного средства",
        },
      ],
    },
    problemItems: [],
  },
};

export const АктБезВозврата: StoryObj<typeof ActPreview> = {
  render: (args) => <ActPreview {...args} />,
  args: {
    decision: "RETURN_ALL",
    act: { required: false, items: [] },
    problemItems: [],
  },
};

const completeView: ReconciliationView = {
  id: "c1e2d3a4-1111-4222-8333-444444444444",
  party_id: PARTY,
  revision: 1,
  state: "OPEN",
  checks: completeChecks,
  inspection: { compartment: "COMPLIANT", jointCarriage: "NONE" },
  delivered: { mass_kg: "100", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  accepted: { mass_kg: "100", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  decision: "ACCEPT_ALL",
  return_reason: null,
  repeat: null,
  transaction: { planned: false, type: null },
  fair: false,
  services: [],
  actor_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  saved_at: "2026-11-07T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: {
    required: true,
    items: [{ field_id: "CHK-F21", source: "120.0", actual: "100", reason: "Недостача при доставке" }],
  },
  route: "EXAMINATION",
  errors: [],
  complete: true,
};

const emptyView: ReconciliationView = {
  ...completeView,
  id: "",
  checks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "0", quantity: "0", unit_id: "" },
  accepted: { mass_kg: "0", quantity: "0", unit_id: "" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "" },
  decision: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  complete: false,
};

export const ФормаНачатая: StoryObj<typeof ReconciliationForm> = {
  render: (args) => (
    <div style={{ maxWidth: 760, padding: 16 }}>
      <ReconciliationForm {...args} />
    </div>
  ),
  args: { party, initial: emptyView, onSaved: () => undefined },
};

export const ФормаЗаполненная: StoryObj<typeof ReconciliationForm> = {
  render: (args) => (
    <div style={{ maxWidth: 760, padding: 16 }}>
      <ReconciliationForm {...args} />
    </div>
  ),
  args: { party, initial: completeView, onSaved: () => undefined },
};

export const ФормаУзкийЭкран: StoryObj<typeof ReconciliationForm> = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
  render: (args) => (
    <div style={{ maxWidth: 390, padding: 8 }}>
      <ReconciliationForm {...args} />
    </div>
  ),
  args: { party, initial: emptyView, onSaved: () => undefined },
};
