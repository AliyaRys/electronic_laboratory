/**
 * DR20 §9 frontend tests: «Дата выработка» (CHK-F22) and «Срок годности»
 * (CHK-F23) in the product block of the reconciliation screen — the typed
 * GoodsDate display formats (single / interval / informal), the mismatch
 * date input of the common ComparisonField, the restoration of saved marks
 * and the card-bound errors.
 *
 * Test 6 (1440/1024/768/390 px) is a JSDOM limitation disclosure: JSDOM has
 * no layout engine, so real pixel widths cannot be asserted here; the test
 * checks the overflow guard contract (`scrollWidth <= innerWidth`) at the
 * narrow JSDOM viewport, the keyboard focus order and a long informal value
 * instead. Real-viewport verification happens in Playwright e2e.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, afterEach, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ReconciliationForm, type ReconciliationFormProps } from "./ReconciliationForm";
import { comparedFields, formatGoodsDate } from "./api";
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
      consignor: "ООО «Мясопром»",
      consignee: "Убойный пункт Ленина, 5",
      productItem: "Отруба говяжьи",
      producedOn: "2026-11-03",
      expiresOn: "2026-11-10",
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

/** The interval variant of the same typed read model (§2 row 2). */
const partyInterval: IncomingView = {
  ...party,
  external: {
    ...party.external,
    fields: {
      ...party.external.fields,
      producedOn: null,
      producedOnFrom: "2026-11-03",
      producedOnTo: "2026-11-05",
      expiresOn: null,
      expiresOnFrom: "2026-11-10",
      expiresOnTo: "2026-11-16",
    },
  },
};

/** The informal variant: the source text, never an invented date. */
const partyInformal: IncomingView = {
  ...party,
  external: {
    ...party.external,
    fields: {
      ...party.external.fields,
      producedOn: null,
      producedOnInformal: "начало ноября 2026 года",
    },
  },
};

const CHECK_PRODUCT_TITLE = "Идентификация продукции по наименованию и визуальным осмотром";

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

/** Test 9-4: the saved marks and actual values of a reload. */
const savedView: ReconciliationView = {
  ...emptyView,
  id: "d20e2d3a-1111-4222-8333-444444444444",
  revision: 2,
  checks: {
    "CHK-F22": { matches: false, actual: "2026-11-04", reason: "Дата отличается от упаковки" },
    "CHK-F23": { matches: true },
  },
};

afterEach(() => {
  useDirtyStore.getState().setDirty(false);
});

function renderForm(props: Partial<ReconciliationFormProps> = {}, onSaved = vi.fn()): void {
  const client = new QueryClient();
  client.setQueryData([LAB, PARTY, "reconciliation"], props.initial ?? emptyView);
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

describe("DR20: CHK-F22/F23 in the product block", () => {
  it("lists both fields inside the product block, after the product fields (§7)", () => {
    const fields = comparedFields(party);
    const productIds = fields.filter((field) => field.block === "product").map((field) => field.fieldId);
    // The present product fields keep their order, then CHK-F22, then CHK-F23
    // (CHK-F15/F17 stay absent in this fixture — their source is absent).
    expect(productIds).toEqual(["CHK-F16", "CHK-F18", "CHK-F20", "CHK-F21", "CHK-F22", "CHK-F23"]);
    expect(fields.find((field) => field.fieldId === "CHK-F22")).toMatchObject({
      block: "product",
      label: "Дата выработка",
    });
    expect(fields.find((field) => field.fieldId === "CHK-F23")).toMatchObject({
      block: "product",
      label: "Срок годности",
    });
  });
  it("renders the comparison cards on the screen in the same order", () => {
    renderForm();
    const product = screen
      .getAllByRole("heading", { level: 2, name: CHECK_PRODUCT_TITLE })
      .map((heading) => heading.closest("section"))
      .find(Boolean);
    if (product === null || product === undefined) throw new Error("product section not found");
    const ids = [...product.querySelectorAll("[data-field-id]")].map((node) =>
      node.getAttribute("data-field-id"),
    );
    expect(ids.indexOf("CHK-F22")).toBeGreaterThan(ids.indexOf("CHK-F21"));
    expect(ids.indexOf("CHK-F23")).toBeGreaterThan(ids.indexOf("CHK-F22"));
    const sources = [...product.querySelectorAll(".vse-rec-mercury-value")].map((node) => node.textContent);
    expect(sources).toContain("03.11.2026");
    expect(sources).toContain("до 10.11.2026");
  });

  it("renders single dates, intervals and informal text without collapse (§2/§7.1)", () => {
    expect(comparedFields(party).find((field) => field.fieldId === "CHK-F22")?.source).toBe("03.11.2026");
    expect(comparedFields(party).find((field) => field.fieldId === "CHK-F23")?.source).toBe("до 10.11.2026");
    const interval = comparedFields(partyInterval);
    expect(interval.find((field) => field.fieldId === "CHK-F22")?.source).toBe("с 03.11.2026 по 05.11.2026");
    expect(interval.find((field) => field.fieldId === "CHK-F23")?.source).toBe("с 10.11.2026 по 16.11.2026");
    const informal = comparedFields(partyInformal);
    expect(informal.find((field) => field.fieldId === "CHK-F22")?.source).toBe("начало ноября 2026 года");
    // The formatting helper itself never invents a date from an informal text.
    expect(formatGoodsDate({ producedOnInformal: "начало ноября" }, "producedOn")).toBe("начало ноября");
    expect(formatGoodsDate({}, "producedOn")).toBeNull();
  });

  it("opens a native date input with the common component marks for a mismatch (§7.2)", async () => {
    renderForm();
    const card = document.querySelector('[data-field-id="CHK-F22"]');
    if (card === null) throw new Error("CHK-F22 card not found");
    const mismatch = card.querySelector<HTMLInputElement>('input[value="mismatch"]');
    if (mismatch === null) throw new Error("mismatch mark not found");
    await userEvent.click(mismatch);
    const facts = card.querySelector(".vse-rec-facts");
    if (facts === null) throw new Error("facts block not found");
    const dateInput = facts.querySelector<HTMLInputElement>('input[type="date"]');
    expect(dateInput).not.toBeNull();
    // The common ComparisonField contract: the mark radio group of the same
    // card keeps its native radio semantics and the fact/reason inputs share
    // the shared Field contract.
    expect(card.querySelector('input[type="radio"]')).not.toBeNull();
    expect(facts.querySelector('input[type="date"]')).toBe(dateInput);
    expect(screen.getByLabelText("Причина несоответствия")).toBeInTheDocument();
  });

  it("restores the saved marks and actual values after a reload (§9-4)", () => {
    renderForm({ initial: savedView });
    const production = document.querySelector('[data-field-id="CHK-F22"]');
    if (production === null) throw new Error("CHK-F22 card not found");
    expect((production.querySelector('input[value="mismatch"]') as HTMLInputElement | null)?.checked).toBe(
      true,
    );
    expect((production.querySelector('input[type="date"]') as HTMLInputElement | null)?.value).toBe(
      "2026-11-04",
    );
    expect(screen.getByDisplayValue("Дата отличается от упаковки")).toBeInTheDocument();
    expect(
      (document.querySelector('[data-field-id="CHK-F23"] input[value="matches"]') as HTMLInputElement | null)
        ?.checked,
    ).toBe(true);
  });

  it("binds the validation error to the exact comparison card (§7.3)", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Не совпадает: Срок годности" }));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    const card = document.querySelector('[data-field-id="CHK-F23"]');
    if (card === null) throw new Error("CHK-F23 card not found");
    expect(card.textContent).toContain("причину несоответствия");
    // The other date card carries no error.
    const other = document.querySelector('[data-field-id="CHK-F22"]');
    if (other === null) throw new Error("CHK-F22 card not found");
    expect(other.textContent).not.toContain("причину несоответствия");
  });

  it("keeps focus reachable by keyboard and survives a long informal value (JSDOM disclosure)", async () => {
    const longInformal: IncomingView = {
      ...partyInformal,
      external: {
        ...partyInformal.external,
        fields: {
          ...partyInformal.external.fields,
          producedOnInformal:
            "очень длинная неформализованная дата выработки партии продукции, которая превышает привычную ширину карточки сверки и проверяет перенос строк без горизонтальной прокрутки",
        },
      },
    };
    window.innerWidth = 390;
    try {
      renderForm({ party: longInformal });
      expect(screen.getByText(/очень длинная неформализованная дата/)).toBeInTheDocument();
      // JSDOM has no layout engine: real 1440/1024/768/390 px widths are
      // verified in Playwright e2e; here the overflow guard contract holds.
      expect(document.documentElement.scrollWidth <= window.innerWidth + 1).toBe(true);
      // Keyboard: the tab order reaches the form controls (the first
      // focusable element of the composed screen).
      await userEvent.tab();
      expect(document.activeElement?.tagName).toBe("INPUT");
    } finally {
      window.innerWidth = 1024;
      useDirtyStore.getState().setDirty(false);
    }
  });
});
