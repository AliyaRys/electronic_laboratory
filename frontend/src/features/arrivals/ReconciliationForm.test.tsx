/**
 * A02 unit tests: ComparisonField, ReceiptDecision, ActPreview and the
 * composed ReconciliationForm — keyboard marking, disabled decision with the
 * reason, the derived act plate, dirty navigation protection and the fact
 * that a failed save never loses the entered input.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ComparisonField, type ComparisonValue } from "./ComparisonField";
import { ReceiptDecision, type ReceiptDecisionValue } from "./ReceiptDecision";
import { ActPreview } from "./ActPreview";
import { ReconciliationForm, type ReconciliationFormProps } from "./ReconciliationForm";
import { computeAllowedDecisions } from "./api";
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
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "u1" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 1,
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

describe("ComparisonField", () => {
  it("marks a mismatch and reveals the actual/reason inputs", async () => {
    const onChange = vi.fn();
    render(
      <ComparisonField
        fieldId="CHK-F21"
        label="Вес, кг"
        block="Идентификация продукции"
        source="120.0"
        value={{ matches: null, actual: "", reason: "" }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByLabelText("Фактическое значение")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Не совпадает" }));
    expect(onChange).toHaveBeenCalledWith({ matches: false, actual: "", reason: "" });
  });

  it("keeps the explicit mark state (a default is never a check)", () => {
    const value: ComparisonValue = { matches: true, actual: "", reason: "" };
    render(
      <ComparisonField
        fieldId="CHK-F07"
        label="Получатель"
        block="Участники перевозки"
        source="Убойный пункт"
        value={value}
        onChange={vi.fn()}
      />,
    );
    expect((screen.getByRole("radio", { name: "Совпадает" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Убойный пункт")).toBeInTheDocument();
  });
});

describe("ReceiptDecision", () => {
  const base: ReceiptDecisionValue = {
    decision: null,
    return_reason_code: "",
    return_reason_text: "",
    transaction_planned: false,
    transaction_type: null,
    fair: false,
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
  it("renders the CHK blocks in the fixed order with the source values", () => {
    renderForm();
    const headings = [...screen.getAllByRole("heading", { level: 3 })].map((h) => h.textContent);
    expect(headings[0]).toBe("Документ");
    expect(headings[1]).toBe("Участники перевозки");
    expect(headings[2]).toBe("Идентификация транспорта");
    expect(headings[3]).toBe("Идентификация продукции");
    expect(headings[4]).toBe("Сопроводительные документы");
    expect(headings[5]).toBe("Прежняя ВСЭ");
    expect(headings[6]).toBe("Результаты");
    expect(headings[7]).toBe("Стоимость");
    expect(screen.getAllByText("А123ВС77").length).toBeGreaterThan(0);
    // The raw GUID of the eVSD is never shown.
    expect(document.body.textContent).not.toContain("1f0e6d2a");
  });

  it("protects the entered input: the dirty flag blocks navigation", async () => {
    renderForm();
    await userEvent.click(screen.getAllByRole("radio", { name: "Совпадает" })[0]);
    await waitFor(() => expect(useDirtyStore.getState().dirty).toBe(true));
    useDirtyStore.getState().setDirty(false);
  });

  it("keeps the entered input after a network error", async () => {
    renderForm();
    const weight = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(weight);
    await userEvent.type(weight, "100");
    await userEvent.click(screen.getAllByRole("radio", { name: "Совпадает" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    await waitFor(() => {
      expect(screen.getByText(/не удалось сохранить|Ошибка|Сверка изменена/i)).toBeInTheDocument();
    });
    expect(screen.getAllByLabelText("Вес, кг")[0]).toHaveValue("100");
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
    expect(screen.getByText(/Сведений прежней ВСЭ в эВСД нет/)).toBeInTheDocument();
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
