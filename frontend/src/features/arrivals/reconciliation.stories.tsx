/**
 * A02 component stories (aligned screen): every state of spec §13 rendered
 * with the SAME components the working page uses — no copied screen markup.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { MemoryRouter } from "react-router";
import { ReconciliationForm } from "./ReconciliationForm";
import { ComparisonField, ReferenceField, type ComparisonValue } from "./ComparisonField";
import { CheckSectionCard } from "./CheckSectionCard";
import { ReconciliationActions } from "./ReconciliationActions";
import { ReconciliationFeedback } from "./ReconciliationFeedback";
import { ReceiptDecision, type ReceiptDecisionValue } from "./ReceiptDecision";
import { ActPreview } from "./ActPreview";
import {
  comparedFields,
  type Decision,
  type IncomingView,
  type Problem,
  type ReconciliationView,
} from "./api";

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
      documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
      issuedOn: "2026-08-12T08:12:00",
      transportNumber: "А123ВС77",
      consignor: "ИП Усманов И.К. (Республика Татарстан, г. Казань, ул. Аграрная, 7)",
      consignee: "Лаборатория ВСЭ №1 г. Казань (ул. Аграрная, д. 2)",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Говядина в тушах охлажденная" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "486.5", quantity: "3", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
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

function checksFor(value: (field: string) => ComparisonValue): ReconciliationView["checks"] {
  const checks: ReconciliationView["checks"] = {};
  for (const field of comparedFields(party)) {
    const entry = value(field.fieldId);
    checks[field.fieldId] = {
      matches: entry.matches === true,
      ...(entry.actual !== "" ? { actual: entry.actual } : {}),
      ...(entry.reason !== "" ? { reason: entry.reason } : {}),
    };
  }
  return checks;
}

const allMatchedChecks = checksFor(() => mark(true));
const oneMismatchChecks = checksFor((field) =>
  field === "CHK-F21" ? mark(false, "452", "Недостача при доставке") : mark(true),
);

const emptyView: ReconciliationView = {
  id: "",
  party_id: PARTY,
  revision: 1,
  state: "OPEN",
  checks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "486.5", quantity: "3", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  accepted: { mass_kg: "486.5", quantity: "3", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  decision: null,
  return_reason: null,
  repeat: null,
  transaction: { planned: null, type: null },
  fair: false,
  services: [],
  actor_id: "",
  saved_at: "2026-11-07T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: null,
  errors: [],
  complete: false,
};

function formStory(
  initial: ReconciliationView,
  partyData: IncomingView = party,
): StoryObj<typeof ReconciliationForm> {
  return {
    render: (args) => (
      <MemoryRouter>
        <div style={{ maxWidth: 1180, padding: 16 }}>
          <ReconciliationForm {...args} />
        </div>
      </MemoryRouter>
    ),
    args: { party: partyData, initial, onSaved: () => undefined },
  };
}

const savedView: ReconciliationView = {
  ...emptyView,
  id: "c1e2d3a4-1111-4222-8333-444444444444",
  revision: 2,
};

/** 1. Начальная незаполненная сверка. */
export const Незаполненная = formStory(emptyView);

/** 2. Все сравнения совпадают. */
export const ВсеСовпадает = formStory({
  ...emptyView,
  checks: allMatchedChecks,
  inspection: { compartment: "COMPLIANT", jointCarriage: "NONE" },
});

/** 3. Одно расхождение с фактическим значением и причиной. */
export const ОдноРасхождение = formStory({
  ...emptyView,
  checks: oneMismatchChecks,
  act: {
    required: true,
    items: [{ field_id: "CHK-F21", source: "486.5", actual: "452", reason: "Недостача при доставке" }],
  },
});

/** 4. Несколько длинных значений. */
export const ДлинныеЗначения = formStory(
  {
    ...emptyView,
    checks: checksFor((field) =>
      field === "CHK-F05"
        ? mark(true)
        : field === "CHK-F16"
          ? mark(
              false,
              "Говядина в тушах охлажденная первого категории, без клейма на лопатках",
              "Отличие в наименовании",
            )
          : mark(true),
    ),
  },
  {
    ...party,
    external: {
      ...party.external,
      fields: {
        ...party.external.fields,
        consignor:
          "ИП Усманов Ильдар Камильевич, крестьянское хозяйство «Аграрная долина» (Республика Татарстан, г. Казань, ул. Аграрная, дом 7, корпус 2, помещение 15)",
        consignee:
          "Государственное бюджетное учреждение «Лаборатория ветеринарно-санитарной экспертизы №1 города Казани» (ул. Аграрная, д. 2)",
      },
    },
  },
);

/** 5. Нет сведений ранее проведённой ВСЭ. */
export const БезПрежнейВСЭ = formStory(emptyView);

/** 6. Есть ранее проведённая ВСЭ и требуется повторная. */
export const СПрежнейВСЭ = formStory(
  { ...emptyView, repeat: { required: true, reason: "Повторный осмотр партии", actNumber: "АКТ-9" } },
  {
    ...party,
    external: {
      ...party.external,
      fields: {
        ...party.external.fields,
        previousNumber: "ВСЭ № 902",
        previousPerformedOn: "2026-08-12 07:55",
        previousOrganization: "Лаборатория ВСЭ №2 г. Казань",
        previousResult: "Пригодно",
        previousStamp: "111943",
        previousConclusion:
          "По результатам ветеринарно-санитарной экспертизы туши и внутренние органы признаны пригодными для пищевых целей. Органолептические показатели соответствуют требованиям, патологические изменения и признаки инвазионных заболеваний не выявлены.",
      },
    },
  },
);

/** 7. Полное гашение доступно. */
export const ПолноеГашение = formStory({
  ...savedView,
  checks: allMatchedChecks,
  inspection: { compartment: "COMPLIANT", jointCarriage: "NONE" },
  decision: "ACCEPT_ALL",
  complete: true,
});

/** 8. Частичное гашение с возвратом части партии. */
export const ЧастичноеГашение = formStory({
  ...savedView,
  checks: checksFor((field) =>
    field === "CHK-F21" ? mark(false, "452", "Недостача при доставке") : mark(true),
  ),
  accepted: { mass_kg: "452", quantity: "3", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  returned: { mass_kg: "34.5", quantity: "0", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  decision: "PARTIAL",
  return_reason: { code: "QUANTITY_DISCREPANCY", text: null },
  complete: true,
  act: {
    required: true,
    items: [{ field_id: "CHK-F21", source: "486.5", actual: "452", reason: "Недостача при доставке" }],
  },
});

/** 9. Только полный возврат доступен. */
export const ТолькоВозврат = formStory({
  ...emptyView,
  checks: checksFor((field) =>
    field === "CHK-F07" ? mark(false, "Другой получатель", "Ошибка адресата") : mark(null),
  ),
  allowed_decisions: ["RETURN_ALL"],
});

/** 10. Ярмарка. */
export const Ярмарка = formStory({
  ...savedView,
  checks: allMatchedChecks,
  decision: "ACCEPT_ALL",
  fair: true,
  complete: true,
});

/** 11. Акт несоответствия (в секции результатов). */
export const АктНесоответствия = formStory({
  ...savedView,
  checks: oneMismatchChecks,
  act: {
    required: true,
    items: [
      { field_id: "CHK-F21", source: "486.5", actual: "452", reason: "Недостача при доставке" },
      {
        field_id: "CHK-F10",
        source: "А123ВС77",
        actual: "В456МК77",
        reason: "Замена транспортного средства",
      },
    ],
  },
});

/** 12. Ошибки проверки полей (компонентный показ). */
export const ОшибкиПолей: StoryObj = {
  render: () => (
    <div style={{ maxWidth: 1180, padding: 16 }}>
      <CheckSectionCard
        sectionKey="product"
        title="Идентификация продукции по наименованию и визуальным осмотром"
        description="Классификация, наименование, объём и ветеринарные характеристики партии."
      >
        <div className="vse-rec-compare-grid">
          <ComparisonField
            fieldId="CHK-F21"
            label="Вес, кг"
            block="product"
            source="486.5"
            value={mark(false, "abc", "")}
            error="Вес — неотрицательное десятичное число."
          />
        </div>
      </CheckSectionCard>
    </div>
  ),
};

/** 13. Сохранение/busy: панель действий и недоступное поле. */
export const Сохранение: StoryObj = {
  render: () => (
    <MemoryRouter>
      <div style={{ maxWidth: 1180, padding: 16 }}>
        <ReconciliationActions
          laboratoryId={LAB}
          busy
          complete={false}
          chosenDecision="Полное гашение"
          canMarkAll
          onMarkAll={() => undefined}
        />
      </div>
    </MemoryRouter>
  ),
};

/** 14. Сетевая ошибка с сохранённым вводом и повтором. */
const networkProblem: Problem = {
  type: "about:blank",
  code: "NETWORK_ERROR",
  title: "Network error",
  status: 0,
  detail: "Сеть недоступна. Введённые данные сохранены в форме.",
  trace_id: "trace-net-1",
};
export const СетеваяОшибка: StoryObj = {
  render: () => (
    <div style={{ maxWidth: 1180, padding: 16 }}>
      <ReconciliationFeedback
        problem={networkProblem}
        onRefresh={() => undefined}
        onRetry={() => undefined}
      />
    </div>
  ),
};

/** 15. Conflict/revision changed с безопасным обновлением. */
const conflictProblem: Problem = {
  type: "about:blank",
  code: "REVISION_CONFLICT",
  title: "Revision conflict",
  status: 409,
  detail: "Сверка изменена другим пользователем. Обновите данные и повторите сохранение.",
  trace_id: "trace-conflict-1",
};
export const КонфликтВерсии: StoryObj = {
  render: () => (
    <div style={{ maxWidth: 1180, padding: 16 }}>
      <ReconciliationFeedback
        problem={conflictProblem}
        onRefresh={() => undefined}
        onRetry={() => undefined}
      />
    </div>
  ),
};

/** 16. Узкий экран 390 px. */
export const УзкийЭкран: StoryObj<typeof ReconciliationForm> = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
  ...formStory(emptyView),
  render: (args) => (
    <MemoryRouter>
      <div style={{ maxWidth: 390, padding: 8 }}>
        <ReconciliationForm {...args} />
      </div>
    </MemoryRouter>
  ),
};

/** 17. Диалог финального подтверждения гашения — смотри W03/Гашение эВСД. */
export const ДиалогПодтверждения = {
  parameters: {
    docs: {
      description: {
        component:
          "Preview и открытый диалог финального подтверждения показаны в разделе W03/Гашение эВСД (receipt-operation.stories) на фиктивном транспорте.",
      },
    },
  },
  render: () => null,
};

/* --- справочные значения и сравнения ---------------------------------------- */

export const СравнениеСовпадает: StoryObj<typeof ComparisonField> = {
  render: (args) => <ComparisonField {...args} />,
  args: {
    fieldId: "CHK-F21",
    label: "Вес, кг",
    block: "product",
    source: "486.5",
    value: mark(true),
  },
};

export const СравнениеРасхождение: StoryObj<typeof ComparisonField> = {
  render: (args) => <ComparisonField {...args} />,
  args: {
    fieldId: "CHK-F21",
    label: "Вес, кг",
    block: "product",
    source: "486.5",
    value: mark(false, "452", "Недостача при доставке"),
  },
};

export const СправочноеЗначение: StoryObj<typeof ReferenceField> = {
  render: (args) => <ReferenceField {...args} />,
  args: { label: "UUID ВСД", value: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac" },
};

const decisionBase: ReceiptDecisionValue = {
  decision: null,
  return_reason_code: "",
  return_reason_text: "",
  transaction_planned: false,
  transaction_type: null,
};

export const РешениеПолноеПринятие: StoryObj<typeof ReceiptDecision> = {
  render: (args) => <ReceiptDecision {...args} />,
  args: {
    value: { ...decisionBase, decision: "ACCEPT_ALL" },
    allowed: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"] as Decision[],
    errors: {},
  },
};

export const РешениеЗапрещено: StoryObj<typeof ReceiptDecision> = {
  render: (args) => <ReceiptDecision {...args} />,
  args: {
    value: decisionBase,
    allowed: ["RETURN_ALL"] as Decision[],
    errors: {},
  },
};

export const АктНесоответствияПлата: StoryObj<typeof ActPreview> = {
  render: (args) => <ActPreview {...args} />,
  args: {
    decision: "ACCEPT_ALL",
    act: {
      required: true,
      items: [
        { field_id: "CHK-F21", source: "486.5", actual: "452", reason: "Недостача при доставке" },
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
