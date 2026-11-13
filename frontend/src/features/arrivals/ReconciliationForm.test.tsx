/**
 * A02 unit tests (aligned screen): ComparisonField, ReceiptDecision,
 * ActPreview and the composed ReconciliationForm — the canonical section
 * order and titles, the icon-button marks with preserved radio semantics,
 * «Все соответствует» over genuinely compared fields, the derived act plate,
 * dirty navigation protection and the fact that a failed save never loses
 * the entered input.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ComparisonField, ReferenceField, type ComparisonValue } from "./ComparisonField";
import { ReceiptDecision, type ReceiptDecisionValue } from "./ReceiptDecision";
import { ActPreview } from "./ActPreview";
import { ReconciliationActions } from "./ReconciliationActions";
import { ReconciliationForm, type ReconciliationFormProps } from "./ReconciliationForm";
import { comparedFields, computeAllowedDecisions } from "./api";
import type { IncomingView, ReconciliationView } from "./api";
import { useDirtyStore } from "../../entities/session/context";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const party: IncomingView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "CONFIRMED",
    fields: {
      documentUuid: "1f0e6d2a-1111-4222-8333-444444444444",
      issuedOn: "2026-11-03",
      statusLabel: "Оформлен",
      purpose: "реализация в пищу людям",
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
  source_presence: "CURRENT_CONFIRMED",
};

/** The same document with a previous-ВСЭ record in the source projection. */
const partyWithPrevious: IncomingView = {
  ...party,
  external: {
    ...party.external,
    fields: {
      ...party.external.fields,
      previousNumber: "ПВС-1",
      previousPerformedOn: "2026-11-01",
      previousOrganization: "ГБУ Ветснаб",
      previousResult: "Отрицательно",
      previousConclusion: "Пригодно",
    },
  },
};

const emptyView: ReconciliationView = {
  id: "",
  party_id: PARTY,
  revision: 1,
  state: "OPEN",
  checks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "0", quantity: "0", unit_id: "" },
  accepted: { mass_kg: "0", quantity: "0", unit_id: "" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "" },
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

afterEach(() => {
  useDirtyStore.getState().setDirty(false);
});

/** Captured PUT payloads of the DR8/repeat test suites. */
interface SavedPayload {
  delivered: { unit_id: string };
  accepted: { unit_id: string };
  returned: { unit_id: string };
  returnReason?: { code: string; text?: string } | null;
}
const savedPayloads: SavedPayload[] = [];

describe("ComparisonField", () => {
  it("marks a mismatch and reveals the actual/reason inputs", async () => {
    const onChange = vi.fn();
    render(
      <ComparisonField
        fieldId="CHK-F21"
        label="Вес, кг"
        block="product"
        source="120.0"
        value={{ matches: null, actual: "", reason: "" }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByLabelText("Фактическое значение")).toBeNull();
    // The icon-button mark keeps the full Russian accessible name with the
    // field name and the native radio semantics.
    await userEvent.click(screen.getByRole("radio", { name: "Не совпадает: Вес, кг" }));
    expect(onChange).toHaveBeenCalledWith({ matches: false, actual: "", reason: "" });
  });

  it("keeps the explicit mark state (a default is never a check)", () => {
    const value: ComparisonValue = { matches: true, actual: "", reason: "" };
    render(
      <ComparisonField
        fieldId="CHK-F07"
        label="Получатель"
        block="participants"
        source="Убойный пункт"
        value={value}
        onChange={vi.fn()}
      />,
    );
    expect((screen.getByRole("radio", { name: "Совпадает: Получатель" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByText("Убойный пункт")).toBeInTheDocument();
  });

  it("shows the state text for a screen reader, never colour only", async () => {
    render(
      <ComparisonField
        fieldId="CHK-F10"
        label="Номер ТС"
        block="transport"
        source="А123ВС77"
        value={{ matches: false, actual: "В456МК77", reason: "Замена ТС" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Поле «Номер ТС»: не совпадает/)).toBeInTheDocument();
  });

  it("disables both marks in the busy state", () => {
    render(
      <ComparisonField
        fieldId="CHK-F10"
        label="Номер ТС"
        block="transport"
        source="А123ВС77"
        value={{ matches: null, actual: "", reason: "" }}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("radio", { name: "Совпадает: Номер ТС" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Не совпадает: Номер ТС" })).toBeDisabled();
  });
});

describe("ReferenceField", () => {
  it("renders a neutral value card without fictitious marks", () => {
    render(<ReferenceField label="UUID ВСД" value="1f0e6d2a-1111-4222-8333-444444444444" />);
    expect(screen.getByText("1f0e6d2a-1111-4222-8333-444444444444")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("ReceiptDecision", () => {
  const base: ReceiptDecisionValue = {
    decision: null,
    return_reason_code: "",
    return_reason_text: "",
    transaction_planned: false,
    transaction_type: null,
  };

  it("shows the three decisions in the fixed order and disables forbidden ones", () => {
    const { container } = render(
      <ReceiptDecision value={base} allowed={["RETURN_ALL"]} onChange={vi.fn()} errors={{}} />,
    );
    const options = [...container.querySelectorAll<HTMLInputElement>('input[name="decision"]')];
    expect(options.map((input) => input.value)).toEqual(["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"]);
    expect(options[0]).toBeDisabled();
    expect(options[2]).toBeEnabled();
    const unavailable = screen.getAllByText(/Недоступно при отмеченных расхождениях/);
    expect(unavailable.length).toBeGreaterThanOrEqual(1);
    expect(unavailable[0]).toHaveAttribute("id", "decision-note-ACCEPT_ALL");
  });

  it("asks for the OTHER_REASON text", async () => {
    render(
      <ReceiptDecision
        value={{ ...base, decision: "RETURN_ALL", return_reason_code: "OTHER_REASON" }}
        allowed={["RETURN_ALL"]}
        onChange={vi.fn()}
        errors={{}}
      />,
    );
    expect(screen.getByLabelText("Текст иной причины")).toBeInTheDocument();
  });

  it("clears the transaction type when the flag is «Нет»", async () => {
    const onChange = vi.fn();
    render(
      <ReceiptDecision
        value={{ ...base, transaction_planned: true, transaction_type: "INTERNAL" }}
        allowed={["ACCEPT_ALL"]}
        onChange={onChange}
        errors={{}}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Нет" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ transaction_planned: false, transaction_type: null }),
    );
  });
});

describe("ActPreview", () => {
  it("lists the derived discrepancy rows", () => {
    render(
      <ActPreview
        decision="ACCEPT_ALL"
        problemItems={[]}
        act={{
          required: true,
          items: [{ field_id: "CHK-F21", source: "120.0", actual: "100", reason: "Недостача при доставке" }],
        }}
      />,
    );
    expect(screen.getByText("Будет сформирован акт несоответствия")).toBeInTheDocument();
    expect(screen.getByText("Недостача при доставке")).toBeInTheDocument();
  });

  it("never promises the act branch for RETURN_ALL", () => {
    render(
      <ActPreview
        decision="RETURN_ALL"
        problemItems={[]}
        act={{
          required: false,
          items: [{ field_id: "CHK-F21", source: "120.0", actual: "100", reason: "Недостача при доставке" }],
        }}
      />,
    );
    expect(screen.getByText(/акт несоответствия этой ветки не формируется/)).toBeInTheDocument();
  });

  it("renders server validation errors with the CHK id", () => {
    render(
      <ActPreview
        decision={null}
        act={null}
        problemItems={[
          {
            path: "checks.CHK-F07",
            field_id: "CHK-F07",
            message: "Сравнение не отмечено.",
          },
        ]}
      />,
    );
    expect(screen.getByText(/CHK-F07/)).toBeInTheDocument();
  });
});

describe("ReconciliationActions", () => {
  it("marks every compared field only through the explicit action", async () => {
    const onMarkAll = vi.fn();
    render(
      <MemoryRouter>
        <ReconciliationActions
          laboratoryId={LAB}
          busy={false}
          complete={false}
          canMarkAll
          onMarkAll={onMarkAll}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Все соответствует" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Отмена" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Погасить" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Все соответствует" }));
    expect(onMarkAll).toHaveBeenCalledTimes(1);
  });

  it("keeps the button size while busy and blocks a repeat submit", () => {
    render(
      <MemoryRouter>
        <ReconciliationActions laboratoryId={LAB} busy complete={false} canMarkAll onMarkAll={vi.fn()} />
      </MemoryRouter>,
    );
    const save = screen.getByRole("button", { name: "Сохранение…" });
    expect(save).toBeDisabled();
    expect(save.getAttribute("class")).toContain("app-button");
  });
});

function renderForm(props: Partial<ReconciliationFormProps> = {}, onSaved = vi.fn()): void {
  const client = new QueryClient();
  client.setQueryData([LAB, PARTY, "reconciliation"], emptyView);
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReconciliationForm
          party={props.party ?? party}
          initial={props.initial ?? emptyView}
          onSaved={onSaved}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ReconciliationForm", () => {
  it("renders the sections in the fixed order with the canonical user-facing titles", () => {
    renderForm();
    const headings = [...screen.getAllByRole("heading", { level: 2 })].map((h) => h.textContent);
    expect(headings).toEqual([
      "Документ",
      "Участники перевозки",
      "Ветеринарно-санитарная оценка и идентификация транспорта",
      "Идентификация продукции по наименованию и визуальным осмотром",
      "Сопроводительные документы",
      "Ранее проведённая ВСЭ",
      "Результаты сверки",
      "Расчёт стоимости услуг",
    ]);
    expect(screen.getAllByText("А123ВС77").length).toBeGreaterThan(0);
    // The UUID shown is the document identity; the blank issueNumber is never
    // passed off as a UUID (ТЗ DR5 §6).
    expect(screen.getByText("1f0e6d2a-1111-4222-8333-444444444444")).toBeInTheDocument();
  });

  it("binds every section to its heading through aria-labelledby", () => {
    renderForm();
    for (const heading of screen.getAllByRole("heading", { level: 2 })) {
      const section = heading.closest("section");
      expect(section).not.toBeNull();
      expect(section?.getAttribute("aria-labelledby")).toBe(heading.id);
    }
  });

  it("renders the document facts as neutral reference cards", () => {
    renderForm();
    expect(screen.getByText("UUID ВСД")).toBeInTheDocument();
    expect(screen.getByText("1f0e6d2a-1111-4222-8333-444444444444")).toBeInTheDocument();
    expect(screen.getByText("Дата оформления ВСД")).toBeInTheDocument();
    expect(screen.getByText("03.11.2026")).toBeInTheDocument();
    expect(screen.getByText("Статус эВСД")).toBeInTheDocument();
    expect(screen.getByText("Оформлен")).toBeInTheDocument();
    expect(screen.getByText("Назначение груза")).toBeInTheDocument();
    expect(screen.getByText("реализация в пищу людям")).toBeInTheDocument();
  });

  it("shows the honest fallback when the purpose is not in the dictionary", () => {
    renderForm({
      party: {
        ...party,
        external: {
          ...party.external,
          fields: { ...party.external.fields, purpose: "Назначение не найдено в справочнике" },
        },
      },
    });
    expect(screen.getByText("Назначение не найдено в справочнике")).toBeInTheDocument();
    // The raw GUID is never shown as the purpose value.
    expect(document.body.textContent).not.toContain("0778b8cb");
  });

  it("keeps a very long purpose name without horizontal overflow", () => {
    renderForm({
      party: {
        ...party,
        external: {
          ...party.external,
          fields: {
            ...party.external.fields,
            purpose:
              "реализация в пищу людям, включая переработку и хранение на предприятиях торговли очень длинное название назначения груза для проверки переноса строк",
          },
        },
      },
    });
    expect(screen.getByText(/очень длинное название назначения/)).toBeInTheDocument();
    expect(document.documentElement.scrollWidth <= window.innerWidth + 1).toBe(true);
  });

  it("marks a mismatch and keeps the mutual exclusion inside one field", async () => {
    renderForm();
    const weight = screen.getByRole("radio", { name: "Не совпадает: Вес, кг" });
    await userEvent.click(weight);
    expect(weight).toBeChecked();
    expect(screen.getByRole("radio", { name: "Совпадает: Вес, кг" })).not.toBeChecked();
    expect(screen.getByLabelText("Фактическое значение")).toBeInTheDocument();
  });

  it("wires the comparison error to the reason input and focuses it on submit (§7.3)", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Не совпадает: Вес, кг" }));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    const reason = screen.getByLabelText("Причина несоответствия");
    expect(reason).toHaveAttribute("aria-invalid", "true");
    const describedBy = reason.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("-reason-error");
    const message = document.getElementById(
      describedBy.split(" ").find((id) => id.endsWith("-reason-error")) ?? "",
    );
    expect(message?.textContent).toContain("причину несоответствия");
    // The mark group of the same card references the message as well.
    const group = screen.getByRole("radiogroup", { name: "Отметка сравнения: Вес, кг" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group.getAttribute("aria-describedby")).toContain("-reason-error");
    // Submit returns the focus to the invalid reason input.
    await waitFor(() => expect(reason).toHaveFocus());
  });

  it("marks all compared fields with «Все соответствует»", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: /Все соответствует/ }));
    // Only the genuinely compared fields (CHK-F05..F21 here) get the mark;
    // the transport observations, decisions and the fair flag are untouched.
    const matchRadios = document.querySelectorAll<HTMLInputElement>('input[type="radio"][value="matches"]');
    expect(matchRadios.length).toBe(7);
    for (const radio of matchRadios) {
      expect(radio.checked).toBe(true);
    }
    // The transport observations stay unanswered.
    expect((screen.getByLabelText("Состояние грузового отделения") as HTMLSelectElement).value).toBe("");
  });

  it("protects the entered input: the dirty flag blocks navigation", async () => {
    renderForm();
    await userEvent.click(screen.getAllByRole("radio", { name: /^Совпадает: / })[0]);
    await waitFor(() => expect(useDirtyStore.getState().dirty).toBe(true));
    useDirtyStore.getState().setDirty(false);
  });

  it("keeps the entered input after a network error", async () => {
    renderForm();
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "100");
    await userEvent.click(screen.getAllByRole("radio", { name: /^Совпадает: / })[0]);
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    await waitFor(() => {
      expect(screen.getByText(/не удалось сохранить|Ошибка|Сверка изменена/i)).toBeInTheDocument();
    });
    expect(screen.getAllByLabelText("Вес, кг")[0]).toHaveValue("100");
  });

  it("keeps the mismatch fact and reason after a network error", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Не совпадает: Вес, кг" }));
    await userEvent.type(screen.getByLabelText("Фактическое значение"), "100");
    await userEvent.type(screen.getByLabelText("Причина несоответствия"), "Недостача");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    await waitFor(() => {
      expect(screen.getByText(/не удалось сохранить|Ошибка|Сверка изменена/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Фактическое значение")).toHaveValue("100");
    expect(screen.getByLabelText("Причина несоответствия")).toHaveValue("Недостача");
  });

  it("governs enablement by the local recompute, not the stale saved projection", () => {
    // The stale saved view lists only RETURN_ALL, but with real delivered
    // quantities and no marked grounds all three decisions are selectable;
    // the server stays authoritative at save time.
    renderForm({
      initial: {
        ...emptyView,
        delivered: { mass_kg: "120", quantity: "4", unit_id: "u1" },
        allowed_decisions: ["RETURN_ALL"],
      },
    });
    expect(screen.getByRole("radio", { name: "Полное гашение" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Частичное гашение" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Полный возврат" })).toBeEnabled();
  });

  it("shows the honest empty invoice state and the fair flag", async () => {
    renderForm();
    expect(screen.getByText(/Стоимость будет рассчитана после сохранения/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Ярмарка/ }));
    expect(screen.getByRole("checkbox", { name: /Ярмарка/ })).toBeChecked();
  });
});

/** ТЗ DR11: the invoice block renders the SAVED server pricing snapshot. */
describe("ТЗ DR11: расчёт стоимости услуг", () => {
  const pricingView: ReconciliationView = {
    ...emptyView,
    id: "d11e2d3a-1111-4222-8333-444444444444",
    revision: 2,
    pricing: {
      lines: [
        {
          service_code: "PRODUCT_IDENTIFICATION",
          name: "Идентификация продукции по наименованию и визуальным осмотром",
          unit_id: "aaaaaaaa-1111-4111-8111-111111111111",
          quantity: "1",
          unit_price: "100.00",
          amount: "100.00",
        },
        {
          service_code: "TRANSPORT_INSPECTION",
          name: "Ветеринарно-санитарная оценка и идентификация транспорта",
          unit_id: "service",
          quantity: "1",
          unit_price: "130.00",
          amount: "130.00",
        },
      ],
      total: "230.00",
      currency: "RUB",
      fair: false,
    },
  };

  it("replaces the empty state with the two saved lines after a save with pricing", async () => {
    // The save command publishes the returned view into the page state; the
    // same screen then shows the priced invoice without any reload.
    const savedPayloads: unknown[] = [];
    const server = setupServer(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
          full_name: "Ветврач",
          login: "vet",
          email: "vet@lab.test",
          position: null,
          role: "VET",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
          source_presence: "CURRENT_CONFIRMED",
        }),
      ),
      http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
        savedPayloads.push(await request.json());
        return HttpResponse.json(pricingView, { status: 200 });
      }),
    );
    server.listen();
    try {
      function SaveFlow(): React.ReactElement {
        const [view, setView] = useState<ReconciliationView>(emptyView);
        return <ReconciliationForm party={party} initial={view} onSaved={setView} />;
      }
      render(
        <MemoryRouter>
          <SaveFlow />
        </MemoryRouter>,
      );
      expect(screen.getByText(/Стоимость будет рассчитана после сохранения/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(savedPayloads.length).toBeGreaterThan(0));
      expect(
        screen.getAllByText("Идентификация продукции по наименованию и визуальным осмотром").length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText("Ветеринарно-санитарная оценка и идентификация транспорта").length,
      ).toBeGreaterThan(0);
      expect(screen.getByText("230,00 ₽")).toBeInTheDocument();
      expect(screen.queryByText(/Стоимость будет рассчитана после сохранения/)).toBeNull();
    } finally {
      server.close();
    }
  });

  it("shows the exact Russian names, quantity, unit, tariff and amount", () => {
    renderForm({ initial: pricingView });
    expect(screen.getByRole("columnheader", { name: "Услуга" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Единица расчёта" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Количество" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Тариф" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Сумма" })).toBeInTheDocument();
    // The service name also titles a section, so the table cells are matched
    // inside the invoice table only.
    const invoice = document.querySelector(".vse-rec-invoice-table");
    if (invoice === null) {
      throw new Error("invoice table not found");
    }
    expect(invoice.textContent).toContain("Идентификация продукции по наименованию и визуальным осмотром");
    expect(invoice.textContent).toContain("Ветеринарно-санитарная оценка и идентификация транспорта");
    // The honest unit labels: the source GUID fallback and the lineage default.
    expect(
      screen.getByText("Единица из ВСД (GUID: aaaaaaaa-1111-4111-8111-111111111111)"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 услуга")).toBeInTheDocument();
    expect(screen.getAllByText("100,00 ₽").length).toBe(2);
    expect(screen.getAllByText("130,00 ₽").length).toBe(2);
    // The saved server total is displayed, never computed on the client.
    expect(screen.getByText("230,00 ₽")).toBeInTheDocument();
  });

  it("names the missing service when the server returns CONFIGURATION_MISSING and keeps the input", async () => {
    const server = setupServer(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
          full_name: "Ветврач",
          login: "vet",
          email: "vet@lab.test",
          position: null,
          role: "VET",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
          source_presence: "CURRENT_CONFIRMED",
        }),
      ),
      http.put("*/api/v1/arrivals/:partyId/reconciliation", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Configuration missing",
            status: 422,
            code: "CONFIGURATION_MISSING",
            detail: "Для услуги сверки нет тарифа в прейскуранте.",
            trace_id: "trace-cfg-1",
            errors: [
              {
                path: "performed.TRANSPORT_INSPECTION",
                field_id: "CHECK",
                message: "Для услуги сверки нет тарифа в прейскуранте.",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    server.listen();
    try {
      renderForm();
      const weight = screen.getAllByLabelText("Вес, кг")[0];
      await userEvent.clear(weight);
      await userEvent.type(weight, "120");
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      expect(
        await screen.findByText(
          /не хватает настройки для услуги «Ветеринарно-санитарная оценка и идентификация транспорта»/,
        ),
      ).toBeInTheDocument();
      // The entered reconciliation is never cleared by the pricing error.
      expect(screen.getAllByLabelText("Вес, кг")[0]).toHaveValue("120");
      expect(screen.getByText(/Стоимость будет рассчитана после сохранения/)).toBeInTheDocument();
    } finally {
      server.close();
    }
  });

  it("shows the honest zeros for a fair reconciliation", () => {
    renderForm({
      initial: {
        ...pricingView,
        fair: true,
        pricing: {
          lines:
            pricingView.pricing?.lines.map((line) => ({ ...line, unit_price: "0.00", amount: "0.00" })) ?? [],
          total: "0.00",
          currency: "RUB",
          fair: true,
        },
      },
    });
    expect(screen.getAllByText("0,00 ₽").length).toBe(5); // two tariffs + two amounts + the total
    expect(screen.getByText(/Ярмарка/)).toBeInTheDocument();
  });

  it("keeps the snapshot visible after a fresh load of the page", () => {
    // The snapshot comes from the SAVED view (GET /reconciliation), the same
    // object a page reload delivers — no client-side recompute happens.
    renderForm({ initial: pricingView });
    const rows = document.querySelectorAll(".vse-rec-invoice-table tbody tr");
    expect(rows.length).toBe(2);
    expect(screen.getByText("230,00 ₽")).toBeInTheDocument();
  });

  it("keeps the priced invoice readable without horizontal overflow on 390 px", () => {
    window.innerWidth = 390;
    try {
      renderForm({ initial: pricingView });
      expect(document.documentElement.scrollWidth <= window.innerWidth + 1).toBe(true);
    } finally {
      window.innerWidth = 1024;
    }
  });
});

describe("first-pass decision enablement (fix round 1)", () => {
  it("recomputes allowed decisions from the CURRENT input", () => {
    const comparisons = { "CHK-F05": { matches: true } };
    expect(computeAllowedDecisions({ mass_kg: "100", quantity: "4" }, comparisons)).toEqual([
      "ACCEPT_ALL",
      "PARTIAL",
      "RETURN_ALL",
    ]);
    // An inadmissible ground (receiver) leaves only the full return.
    expect(
      computeAllowedDecisions({ mass_kg: "100", quantity: "4" }, { "CHK-F07": { matches: false } }),
    ).toEqual(["RETURN_ALL"]);
    // A non-arrival / zero delivery admits no decision at all.
    expect(computeAllowedDecisions({ mass_kg: "0", quantity: "0" }, comparisons)).toEqual([]);
  });

  it("makes ACCEPT_ALL selectable once quantities are entered, before any save", async () => {
    // The stale saved view carries an empty projection — the local recompute
    // still enables the decision as soon as the facts admit it.
    renderForm({ initial: { ...emptyView, allowed_decisions: [] } });
    expect(screen.getByRole("radio", { name: "Полное гашение" })).toBeDisabled();
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "100");
    expect(screen.getByRole("radio", { name: "Полное гашение" })).toBeEnabled();
  });

  it("disables full/partial acceptance for an inadmissible mismatch", async () => {
    renderForm({
      initial: { ...emptyView, delivered: { mass_kg: "120", quantity: "4", unit_id: "u1" } },
    });
    const receiver = document.querySelector<HTMLInputElement>(
      '[data-field-id="CHK-F07"] input[value="mismatch"]',
    );
    if (receiver === null) {
      throw new Error("receiver mark not found");
    }
    await userEvent.click(receiver);
    expect(screen.getByRole("radio", { name: "Полное гашение" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Частичное гашение" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Полный возврат" })).toBeEnabled();
  });
});

describe("repeat ВСЭ inputs (fix round 1)", () => {
  const savedView: ReconciliationView = {
    ...emptyView,
    id: "c1e2d3a4-1111-4222-8333-444444444444",
    revision: 2,
  };
  const captured: { repeat: unknown; headers: Headers }[] = [];

  const server = setupServer(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: "Ветврач",
        login: "vet",
        email: "vet@lab.test",
        position: null,
        role: "VET",
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: [],
        revision: 1,
        source_presence: "CURRENT_CONFIRMED",
      }),
    ),
    http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
      const body = (await request.json()) as { repeat: unknown };
      captured.push({ repeat: body.repeat, headers: request.headers });
      return HttpResponse.json(savedView, { status: 200 });
    }),
  );

  beforeAll(() => server.listen());

  it("renders the previous-ВСЭ facts and sends the real repeat payload", async () => {
    renderForm({ party: partyWithPrevious });
    expect(screen.getByText("ПВС-1")).toBeInTheDocument();
    expect(screen.getByText("Отрицательно")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Требуется" }));
    await userEvent.type(
      screen.getByLabelText("Основание для проведения повторной ВСЭ"),
      "Повторный осмотр партии",
    );
    await userEvent.type(screen.getByLabelText("№ акта"), "АКТ-9");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[captured.length - 1].repeat).toEqual({
      required: true,
      reason: "Повторный осмотр партии",
      actNumber: "АКТ-9",
    });
  });

  it("keeps the note and a null repeat without a previous ВСЭ", async () => {
    renderForm();
    expect(screen.getByText(/Сведений ранее проведённой ВСЭ в эВСД нет/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Требуется" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[captured.length - 1].repeat).toBeNull();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });
});

/** ТЗ DR8: unit propagation, CHK-F20 binding, reason codes, OTHER_REASON. */
describe("ТЗ DR8: unit, quantities and return reason", () => {
  const savedView: ReconciliationView = {
    ...emptyView,
    id: "d8e2d3a4-1111-4222-8333-444444444444",
    revision: 2,
  };

  const server = setupServer(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: "Ветврач",
        login: "vet",
        email: "vet@lab.test",
        position: null,
        role: "VET",
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: [],
        revision: 1,
        source_presence: "CURRENT_CONFIRMED",
      }),
    ),
    http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
      const body = (await request.json()) as {
        delivered: { unit_id: string };
        accepted: { unit_id: string };
        returned: { unit_id: string };
        returnReason: { code: string; text?: string } | null;
      };
      savedPayloads.push(body);
      return HttpResponse.json(savedView, { status: 200 });
    }),
  );

  beforeAll(() => server.listen());
  afterEach(() => {
    server.resetHandlers();
    savedPayloads.length = 0;
  });
  afterAll(() => server.close());

  it("shows the read-only source unit and fills all three QuantitySets", async () => {
    renderForm();
    expect(screen.getByText("Единица измерения (из эВСД)")).toBeInTheDocument();
    expect(screen.getByText("кг")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Единица измерения/)).toBeNull();
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "120");
    const quantity = screen.getAllByLabelText("Количество (кг)")[0];
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "4");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    await waitFor(() => expect(savedPayloads.length).toBeGreaterThan(0));
    const payload = savedPayloads[savedPayloads.length - 1];
    expect(payload.delivered.unit_id).toBe("aaaaaaaa-1111-4111-8111-111111111111");
    expect(payload.accepted.unit_id).toBe("aaaaaaaa-1111-4111-8111-111111111111");
    expect(payload.returned.unit_id).toBe("aaaaaaaa-1111-4111-8111-111111111111");
  });

  it("renders the §6.2 Russian reason labels and sends the exact code", async () => {
    renderForm({ initial: { ...emptyView, decision: "PARTIAL", allowed_decisions: ["PARTIAL"] } });
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "100");
    await userEvent.click(screen.getByRole("radio", { name: "Частичное гашение" }));
    expect(screen.getByRole("option", { name: "Брак / товар ненадлежащего качества" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Отказ торговой точки / покупателя" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Причина возврата"), "CONSIGNOR_REJECTION");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    await waitFor(() => expect(savedPayloads.length).toBeGreaterThan(0));
    expect(savedPayloads[savedPayloads.length - 1].returnReason).toEqual({ code: "CONSIGNOR_REJECTION" });
  });

  it("blocks an empty OTHER_REASON text and caps it at 240 characters", async () => {
    renderForm({ initial: { ...emptyView, decision: "RETURN_ALL", allowed_decisions: ["RETURN_ALL"] } });
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "120");
    await userEvent.click(screen.getByRole("radio", { name: "Полный возврат" }));
    await userEvent.selectOptions(screen.getByLabelText("Причина возврата"), "OTHER_REASON");
    const input = screen.getByLabelText("Текст иной причины") as HTMLInputElement;
    expect(input).toHaveAttribute("maxlength", "240");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    expect(await screen.findByText(/обязателен текст причины возврата/)).toBeInTheDocument();
    expect(savedPayloads.length).toBe(0);
  });

  it("binds the server CHK-F20 problem to the named quantity part", async () => {
    server.use(
      http.put("*/api/v1/arrivals/:partyId/reconciliation", () =>
        HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            detail: "Проверьте введённые данные.",
            errors: [
              { path: "accepted", field_id: "CHK-F20", message: "Единица измерения принята некорректно." },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    renderForm();
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "120");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    const messages = await screen.findAllByText("Единица измерения принята некорректно.");
    const part = messages.map((message) => message.closest(".vse-rec-quantities-part")).find(Boolean);
    expect(part).not.toBeNull();
    expect(part?.textContent).toContain("Принято");
  });
});

/** ТЗ DR10: the canonical source unit GUID without dt:name. */
describe("ТЗ DR10: source unit guid without dt:name", () => {
  const UNIT_GUID = "21ed96c9-337b-4a27-8761-c6e6ad3c9f5b";
  const savedView: ReconciliationView = {
    ...emptyView,
    id: "e10e2d3a-1111-4222-8333-444444444444",
    revision: 2,
  };
  const savedPayloads: { delivered: { unit_id: string } }[] = [];

  const server = setupServer(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: "Ветврач",
        login: "vet",
        email: "vet@lab.test",
        position: null,
        role: "VET",
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: [],
        revision: 1,
        source_presence: "CURRENT_CONFIRMED",
      }),
    ),
    http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
      savedPayloads.push((await request.json()) as { delivered: { unit_id: string } });
      return HttpResponse.json(savedView, { status: 200 });
    }),
  );

  beforeAll(() => server.listen());
  afterEach(() => {
    server.resetHandlers();
    savedPayloads.length = 0;
  });
  afterAll(() => server.close());

  /** The fixture party of §8-1: the unit carries ONLY a GUID (no name). */
  const partyGuidOnly: IncomingView = {
    ...party,
    classification: { ...party.classification, unit: { id: UNIT_GUID, name: null } },
    documentary: { mass_kg: "120.0", quantity: "4", unit_id: UNIT_GUID },
  };

  it("shows no missing-unit warning when the GUID exists without a name", () => {
    renderForm({ party: partyGuidOnly });
    expect(screen.queryByText(/Исходный эВСД не содержит единицу измерения/)).toBeNull();
    // The read-only GUID fallback label is shown instead (§6).
    expect(screen.getByText(`Единица из ВСД (GUID: ${UNIT_GUID})`)).toBeInTheDocument();
  });

  it("saves a non-empty unit id in the payload when the name is absent", async () => {
    renderForm({ party: partyGuidOnly });
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "120");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    await waitFor(() => expect(savedPayloads.length).toBeGreaterThan(0));
    expect(savedPayloads[savedPayloads.length - 1].delivered.unit_id).toBe(UNIT_GUID);
  });

  it("shows the honest warning for a genuinely absent unit GUID", () => {
    const partyWithoutUnit: IncomingView = {
      ...partyGuidOnly,
      classification: { ...partyGuidOnly.classification, unit: null },
      documentary: { mass_kg: "120.0", quantity: "4", unit_id: "" },
    };
    renderForm({ party: partyWithoutUnit });
    expect(screen.getByText(/Исходный эВСД не содержит единицу измерения/)).toBeInTheDocument();
    expect(screen.queryByText(/Единица из ВСД \(GUID/)).toBeNull();
  });

  it("does not invent a unit from a mass, a place count or «кг»", () => {
    const partyFakeUnit: IncomingView = {
      ...partyWithoutUnitBase(),
      documentary: { mass_kg: "500.0", quantity: "8", unit_id: "500.0" },
    };
    renderForm({ party: partyFakeUnit });
    expect(screen.getByText(/Исходный эВСД не содержит единицу измерения/)).toBeInTheDocument();
  });

  it("binds a server UNIT_MISSING problem to the unit block, not only the banner", async () => {
    server.use(
      http.put("*/api/v1/arrivals/:partyId/reconciliation", () =>
        HttpResponse.json(
          {
            code: "UNIT_MISSING",
            detail: "Исходный эВСД не содержит единицу измерения; гашение недоступно.",
          },
          { status: 422 },
        ),
      ),
    );
    renderForm({ party: partyGuidOnly });
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "120");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    const messages = await screen.findAllByText(/не содержит единицу измерения/);
    const block = messages.map((message) => message.closest(".vse-rec-quantities")).find(Boolean);
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain("Единица измерения (из эВСД)");
  });

  function partyWithoutUnitBase(): IncomingView {
    return {
      ...partyGuidOnly,
      classification: { ...partyGuidOnly.classification, unit: null },
      documentary: { mass_kg: "500.0", quantity: "8", unit_id: "" },
    };
  }
});

/** ТЗ DR13: полнота сверки (CHK-F06/F15), If-Match сохранённой версии и
 * честный 409 с автоматической перезагрузкой. */
describe("ТЗ DR13: полнота сверки и повторное сохранение", () => {
  /** The same party whose source projection carries the owner and the
   * product-type values (the live data of the defect report). */
  const partyComplete: IncomingView = {
    ...party,
    external: {
      ...party.external,
      fields: {
        ...party.external.fields,
        senderOwner: "СХПК «Заря»",
        receiverOwner: "ИП Петров",
      },
    },
    classification: { ...party.classification, productType: 1 },
  };

  it("mirrors the backend compared FieldSpec: CHK-F06/F15 appear with real sources and stay absent otherwise", () => {
    const absent = comparedFields(party).map((field) => field.fieldId);
    expect(absent).not.toContain("CHK-F06");
    expect(absent).not.toContain("CHK-F15");
    const fields = comparedFields(partyComplete);
    expect(fields.find((field) => field.fieldId === "CHK-F06")).toMatchObject({
      block: "participants",
      label: "Отправитель — владелец",
      source: "СХПК «Заря»",
    });
    // The numeric product type keeps its honest decimal string, never an
    // invented Russian label.
    expect(fields.find((field) => field.fieldId === "CHK-F15")).toMatchObject({
      block: "product",
      label: "Тип продукции",
      source: "1",
    });
  });

  it("sends the CHK-F06/F15 marks in the save payload", async () => {
    const savedPayloads: { checks: Record<string, { matches: boolean }> }[] = [];
    const server = setupServer(
      http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
        savedPayloads.push((await request.json()) as { checks: Record<string, { matches: boolean }> });
        return HttpResponse.json({ ...emptyView, revision: 2 }, { status: 200 });
      }),
    );
    server.listen();
    try {
      renderForm({ party: partyComplete });
      await userEvent.click(screen.getByRole("button", { name: /Все соответствует/ }));
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(savedPayloads.length).toBeGreaterThan(0));
      expect(savedPayloads[0].checks["CHK-F06"]).toEqual({ matches: true });
      expect(savedPayloads[0].checks["CHK-F15"]).toEqual({ matches: true });
    } finally {
      server.close();
    }
  });

  it("saves twice cleanly: If-Match follows the shown reconciliation revision", async () => {
    const requests: { etag: string | null; key: string | null }[] = [];
    const server = setupServer(
      http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
        requests.push({
          etag: request.headers.get("if-match"),
          key: request.headers.get("idempotency-key"),
        });
        return HttpResponse.json({ ...emptyView, revision: requests.length + 1 }, { status: 200 });
      }),
    );
    server.listen();
    try {
      function SaveFlow(): React.ReactElement {
        const [view, setView] = useState<ReconciliationView>(emptyView);
        return <ReconciliationForm party={party} initial={view} onSaved={setView} />;
      }
      render(
        <MemoryRouter>
          <SaveFlow />
        </MemoryRouter>,
      );
      await userEvent.click(screen.getByRole("button", { name: /Все соответствует/ }));
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(requests.length).toBe(1));
      expect(requests[0].etag).toBe('"1"');
      await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить сверку" })).toBeEnabled());
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(requests.length).toBe(2));
      // The second save carries the ADOPTED revision, so the server never
      // answers REVISION_CONFLICT for a stale If-Match.
      expect(requests[1].etag).toBe('"2"');
      expect(requests[1].key).not.toBeNull();
      expect(requests[1].key).not.toBe(requests[0].key);
    } finally {
      server.close();
    }
  });

  it("reuses the idempotency key for a repeated identical save against the same revision", async () => {
    const requests: { key: string | null }[] = [];
    const server = setupServer(
      http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
        const body = (await request.json()) as { checks: Record<string, unknown> };
        requests.push({ key: request.headers.get("idempotency-key") });
        // The server saves the checks and replays the same shown state, so
        // the second identical click must reuse the session key instead of
        // minting a new command.
        return HttpResponse.json({ ...emptyView, checks: body.checks }, { status: 200 });
      }),
    );
    server.listen();
    try {
      renderForm();
      await userEvent.click(screen.getByRole("button", { name: /Все соответствует/ }));
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(requests.length).toBe(1));
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(requests.length).toBe(2));
      expect(requests[1].key).toBe(requests[0].key);
    } finally {
      server.close();
    }
  });

  it("answers REVISION_CONFLICT with the honest reload message", async () => {
    const server = setupServer(
      http.put("*/api/v1/arrivals/:partyId/reconciliation", () =>
        HttpResponse.json(
          {
            code: "REVISION_CONFLICT",
            detail: "Версия записи не совпадает (If-Match).",
          },
          { status: 409 },
        ),
      ),
    );
    server.listen();
    try {
      renderForm();
      await userEvent.click(screen.getByRole("button", { name: /Все соответствует/ }));
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      expect(await screen.findByText("Данные обновлены, сверка перезагружена.")).toBeInTheDocument();
      expect(screen.queryByText(/другим пользователем/)).toBeNull();
    } finally {
      server.close();
    }
  });

  it("keeps the frozen-state wording for STATE_CONFLICT", async () => {
    const server = setupServer(
      http.put("*/api/v1/arrivals/:partyId/reconciliation", () =>
        HttpResponse.json(
          { code: "STATE_CONFLICT", detail: "Сверка уже подтверждена внешним результатом." },
          { status: 409 },
        ),
      ),
    );
    server.listen();
    try {
      renderForm();
      await userEvent.click(screen.getByRole("button", { name: /Все соответствует/ }));
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      expect(
        await screen.findByText(/Сверка подтверждена внешним результатом и не меняется обычным сохранением/),
      ).toBeInTheDocument();
    } finally {
      server.close();
    }
  });
});

describe("ТЗ DR17: номер прицепа/полуприцепа (CHK-F11)", () => {
  /** The same party whose source carries a real trailer number. */
  const partyWithTrailer: IncomingView = {
    ...party,
    external: {
      ...party.external,
      fields: {
        ...party.external.fields,
        transportType: "Автомобильный",
        trailerNumber: "Т456РР116",
        storage: "FROZEN",
      },
    },
  };
  /** The absent trailer: the backend publishes the agreed informational text. */
  const partyAbsentTrailer: IncomingView = {
    ...party,
    external: {
      ...party.external,
      fields: { ...party.external.fields, trailerNumber: "Прицеп отсутствует" },
    },
  };

  it("shows the trailer card in the transport block between the ТС number and storage", () => {
    const fields = comparedFields(partyWithTrailer).filter((field) => field.block === "transport");
    expect(fields.map((field) => field.fieldId)).toEqual(["CHK-F09", "CHK-F10", "CHK-F11", "CHK-F12"]);
    expect(fields.find((field) => field.fieldId === "CHK-F11")).toMatchObject({
      label: "Номер прицепа/полуприцепа",
      source: "Т456РР116",
    });
  });

  it("renders the trailer value from the fixture in the form", () => {
    renderForm({ party: partyWithTrailer });
    const card = screen.getByText("Номер прицепа/полуприцепа").closest("[data-field-id]");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Т456РР116");
  });

  it("shows «Прицеп отсутствует» when the XML has no trailer node", () => {
    renderForm({ party: partyAbsentTrailer });
    const card = screen.getByText("Номер прицепа/полуприцепа").closest("[data-field-id]");
    expect(card?.textContent).toContain("Прицеп отсутствует");
  });

  it("allows the explicit «Совпадает» mark for an absent trailer without any actual input", async () => {
    const savedPayloads: { checks: Record<string, unknown> }[] = [];
    const server = setupServer(
      http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
        savedPayloads.push((await request.json()) as { checks: Record<string, unknown> });
        return HttpResponse.json({ ...emptyView, revision: 2 }, { status: 200 });
      }),
    );
    server.listen();
    try {
      renderForm({ party: partyAbsentTrailer });
      const radio = screen.getByRole("radio", { name: "Совпадает: Номер прицепа/полуприцепа" });
      expect(radio).toBeEnabled();
      // No actual/reason inputs are required for the match mark.
      expect(screen.queryByLabelText("Фактическое значение")).toBeNull();
      await userEvent.click(radio);
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(savedPayloads.length).toBe(1));
      expect(savedPayloads[0].checks["CHK-F11"]).toEqual({ matches: true });
    } finally {
      server.close();
    }
  });

  it("opens the fact inputs with the agreed placeholder for a mismatch", async () => {
    renderForm({ party: partyWithTrailer });
    await userEvent.click(screen.getByRole("radio", { name: "Не совпадает: Номер прицепа/полуприцепа" }));
    const actual = screen.getByLabelText("Фактическое значение");
    expect(actual.getAttribute("placeholder")).toBe("Фактический номер прицепа/полуприцепа");
    expect(screen.getByLabelText("Причина несоответствия")).toBeInTheDocument();
  });

  it("restores the saved CHK-F11 mark on reopening", () => {
    const withSavedMark: ReconciliationView = {
      ...emptyView,
      checks: { "CHK-F11": { matches: true, actual: null, reason: null } },
    };
    renderForm({ party: partyWithTrailer, initial: withSavedMark });
    expect(
      (screen.getByRole("radio", { name: "Совпадает: Номер прицепа/полуприцепа" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("keeps the accessible radio semantics and focus for the trailer marks", async () => {
    renderForm({ party: partyWithTrailer });
    const match = screen.getByRole("radio", { name: "Совпадает: Номер прицепа/полуприцепа" });
    const mismatch = screen.getByRole("radio", { name: "Не совпадает: Номер прицепа/полуприцепа" });
    expect(match.getAttribute("type")).toBe("radio");
    expect(mismatch.getAttribute("name")).toBe("checks.CHK-F11.matches");
    expect(match.getAttribute("aria-label")).toBe("Совпадает: Номер прицепа/полуприцепа");
    match.focus();
    expect(document.activeElement).toBe(match);
  });
});

describe("participant name fields (ТЗ DR18 §10)", () => {
  function partyWithNames(fields: Record<string, string>): IncomingView {
    return {
      ...party,
      external: { ...party.external, fields: { ...party.external.fields, ...fields } },
    };
  }

  it("renders the two immutable fields of each participant card", () => {
    renderForm({
      party: partyWithNames({
        senderOwner: "ООО «Мясопром»",
        senderEnterprise: "Предприятие «Мясопром»",
        receiverOwner: "ОАО «Восход»",
        receiverEnterprise: "Лабораторный убойный пункт",
        senderOwnerNameSource: "SOURCE_XML",
        senderEnterpriseNameSource: "VETIS_LOOKUP",
        receiverOwnerNameSource: "SOURCE_XML",
        receiverEnterpriseNameSource: "VETIS_LOOKUP",
      }),
    });
    expect(screen.getByText("Сведения о получателе")).toBeInTheDocument();
    const names = screen.getAllByText("Предприятие «Мясопром»");
    expect(names.length).toBeGreaterThan(0);
    expect(screen.getByText("Лабораторный убойный пункт")).toBeInTheDocument();
  });

  it("shows the loading state while the worker resolves the GUID", () => {
    renderForm({
      party: partyWithNames({
        senderOwnerNameSource: "PENDING",
        senderEnterpriseNameSource: "PENDING",
        receiverOwnerNameSource: "PENDING",
        receiverEnterpriseNameSource: "PENDING",
      }),
    });
    const loading = screen.getAllByText("Уточняем названия организаций…");
    expect(loading.length).toBe(4);
    expect(loading.some((node) => node.textContent?.includes("0ed40ab2"))).toBe(false);
  });

  it("shows the error state without offering a click retry", () => {
    renderForm({
      party: partyWithNames({
        receiverOwnerNameSource: "ERROR",
        receiverEnterpriseNameSource: "ERROR",
        senderOwnerNameSource: "SOURCE_XML",
        senderEnterpriseNameSource: "SOURCE_XML",
      }),
    });
    expect(screen.getAllByText("Название временно недоступно").length).toBe(2);
    expect(screen.getByRole("button", { name: "Сохранить сверку" })).toBeInTheDocument();
  });

  it("shows the honest missing fallback and keeps the form working", async () => {
    renderForm({
      party: partyWithNames({
        receiverOwnerNameSource: "MISSING",
        receiverEnterpriseNameSource: "MISSING",
        senderOwnerNameSource: "MISSING",
        senderEnterpriseNameSource: "MISSING",
      }),
    });
    expect(screen.getAllByText("Название не получено").length).toBe(4);
    // The reconciliation is NOT blocked: the full decision is still choosable
    // and the sticky actions stay enabled.
    expect(screen.getByRole("button", { name: "Сохранить сверку" })).toBeEnabled();
    // No GUID/UUID is ever shown instead of a name.
    const text = document.body.textContent ?? "";
    expect(text.includes("0ed40ab2")).toBe(false);
    expect(text.includes("d562919c")).toBe(false);
    await userEvent.click(screen.getAllByLabelText("Вес, кг")[0]);
    await userEvent.clear(screen.getAllByLabelText("Вес, кг")[0]);
    await userEvent.type(screen.getAllByLabelText("Вес, кг")[0], "100");
    expect(screen.getAllByLabelText("Вес, кг")[0]).toHaveValue("100");
  });

  it("renders a long name without breaking the card layout", () => {
    const longName =
      "Очень длинное наименование организации-владельца продукции «Сельскохозяйственный производственный кооператив имени двадцатилетия Победы в Великой Отечественной войне»";
    renderForm({
      party: partyWithNames({
        senderOwner: longName,
        senderOwnerNameSource: "VETIS_LOOKUP",
        senderEnterpriseNameSource: "MISSING",
        receiverOwnerNameSource: "MISSING",
        receiverEnterpriseNameSource: "MISSING",
      }),
    });
    expect(screen.getAllByText(longName).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Название не получено").length).toBe(3);
  });

  it("never issues external VetIS requests from the browser", async () => {
    const externalRequests: string[] = [];
    const server = setupServer(
      http.get("*/api/v1/me", () => HttpResponse.json({}, { status: 401 })),
      http.get("*api2.vetrf.ru*", ({ request }) => {
        externalRequests.push(request.url);
        return HttpResponse.json({}, { status: 502 });
      }),
      http.post("*api2.vetrf.ru*", ({ request }) => {
        externalRequests.push(request.url);
        return HttpResponse.json({}, { status: 502 });
      }),
    );
    server.listen();
    try {
      renderForm({
        party: partyWithNames({
          senderOwnerNameSource: "PENDING",
          senderEnterpriseNameSource: "PENDING",
          receiverOwnerNameSource: "PENDING",
          receiverEnterpriseNameSource: "PENDING",
        }),
      });
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить сверку" })).toBeEnabled());
      expect(externalRequests).toEqual([]);
    } finally {
      server.close();
    }
  });
});
