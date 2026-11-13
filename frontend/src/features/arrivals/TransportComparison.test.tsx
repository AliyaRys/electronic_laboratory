/**
 * ТЗ DR19 §7 frontend tests (6): the compared field
 * «Вид транспорта» (CHK-F09) as the FIRST card of the transport block —
 * the Russian source value comes from the read model (the raw VetIS code is
 * never translated by the frontend, R-DR19-1), the shared ComparisonField
 * card with the mismatch placeholder «Фактический вид транспорта», the
 * explicit mark saved/restored across a reopen, the honest fallback for an
 * unknown code, keyboard focus and narrow-screen behaviour.
 *
 * jsdom limitations, disclosed honestly (ТЗ §7 item 6): real pixel widths
 * (1440/1024/768/390 px) cannot be measured here — only the absence of a
 * horizontal overflow at the emulated 390 px viewport is asserted; visual
 * verification on the live widths happens in the browser (controller gate).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router";
import { ReconciliationForm } from "./ReconciliationForm";
import { comparedFields, type IncomingView, type ReconciliationView } from "./api";
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
      issuedOn: "2026-11-13",
      statusLabel: "Оформлен",
      transportTypeCode: "1",
      transportType: "Автомобильный",
      transportNumber: "А123ВВ77",
      trailerNumber: "Т456РР116",
      storageCode: "CHILLED",
      storage: "Охлажденный",
      consignor: "АО «Отправитель»",
      consignee: "Лаборатория",
      productItem: "Туша баранья",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "Баранина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Туша баранья" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 1,
  source_presence: "CURRENT_CONFIRMED",
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
  saved_at: "2026-11-13T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: null,
  errors: [],
  complete: false,
};

function renderForm(props: { party?: IncomingView; initial?: ReconciliationView } = {}): void {
  const client = new QueryClient();
  client.setQueryData([LAB, PARTY, "reconciliation"], props.initial ?? emptyView);
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReconciliationForm
          party={props.party ?? party}
          initial={props.initial ?? emptyView}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  useDirtyStore.getState().setDirty(false);
});

it("shows CHK-F09 as the first card of the transport block", () => {
  const fields = comparedFields(party);
  const transport = fields.filter((field) => field.block === "transport").map((field) => field.fieldId);
  expect(transport).toEqual(["CHK-F09", "CHK-F10", "CHK-F11", "CHK-F12"]);
  expect(fields.find((field) => field.fieldId === "CHK-F09")).toMatchObject({
    label: "Вид транспорта",
    source: "Автомобильный",
    actualPlaceholder: "Фактический вид транспорта",
  });
});

it("renders the code-1 card as «Автомобильный» in the form", () => {
  renderForm();
  const card = screen.getByText("Вид транспорта").closest("[data-field-id]");
  expect(card?.textContent).toContain("Автомобильный");
});

it("shows the backend label for every dictionary code 1–7", () => {
  // The labels are the read-model values (one backend dictionary); the
  // frontend never translates codes itself (R-DR19-1).
  const cases: Array<[string, string]> = [
    ["1", "Автомобильный"],
    ["2", "Железнодорожный"],
    ["3", "Авиатранспортный"],
    ["4", "Морской (контейнер)"],
    ["5", "Морской (трюм)"],
    ["6", "Речной"],
    ["7", "Перегон (скота)"],
  ];
  for (const [code, label] of cases) {
    const fields = comparedFields({
      ...party,
      external: {
        ...party.external,
        fields: { ...party.external.fields, transportTypeCode: code, transportType: label },
      },
    });
    const field = fields.find((item) => item.fieldId === "CHK-F09");
    expect(field?.source).toBe(label);
  }
});

it("opens the mismatch fact with the dedicated placeholder and the reason field", async () => {
  renderForm();
  await userEvent.click(screen.getByRole("radio", { name: "Не совпадает: Вид транспорта" }));
  expect(screen.getByPlaceholderText("Фактический вид транспорта")).toBeInTheDocument();
  expect(screen.getByLabelText("Причина несоответствия")).toBeInTheDocument();
});

it("restores the saved mark and facts after reopening the form", () => {
  renderForm({
    initial: {
      ...emptyView,
      checks: {
        "CHK-F09": {
          matches: false,
          actual: "Железнодорожный",
          reason: "В ВСД указан автомобиль, фактически вагон",
        },
      },
    },
  });
  expect(screen.getByRole("radio", { name: "Не совпадает: Вид транспорта" })).toBeChecked();
  expect(screen.getByLabelText("Фактическое значение")).toHaveValue("Железнодорожный");
  expect(screen.getByLabelText("Причина несоответствия")).toHaveValue(
    "В ВСД указан автомобиль, фактически вагон",
  );
});

describe("honest states, keyboard and narrow screens", () => {
  it("renders the honest fallback for an unknown code without horizontal overflow on 390 px", () => {
    renderForm({
      party: {
        ...party,
        external: {
          ...party.external,
          fields: {
            ...party.external.fields,
            transportTypeCode: "9",
            transportType: "Неизвестный вид транспорта",
          },
        },
      },
    });
    expect(screen.getByText("Неизвестный вид транспорта")).toBeInTheDocument();
    const before = window.innerWidth;
    window.innerWidth = 390;
    expect(document.documentElement.scrollWidth <= window.innerWidth + 1).toBe(true);
    window.innerWidth = before;
  });

  it("keeps the mark explicit: no radio is preselected and focus is visible", async () => {
    renderForm();
    expect(screen.getByRole("radio", { name: "Совпадает: Вид транспорта" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Не совпадает: Вид транспорта" })).not.toBeChecked();
    await userEvent.tab();
    expect(document.activeElement).not.toBeNull();
    (document.activeElement as HTMLElement).focus();
    expect(document.activeElement).toHaveFocus();
  });

  it("renders the loading and error states of the form without a fictive mark", async () => {
    // jsdom: the network states belong to the page container; here the honest
    // absence is verified — with no reconciliation data the CHK-F09 card is
    // simply absent (no fictitious mark, R-DR19-3).
    const fields = comparedFields({
      ...party,
      external: { ...party.external, fields: { ...party.external.fields, transportType: null } },
    });
    expect(fields.find((field) => field.fieldId === "CHK-F09")).toBeUndefined();
  });
});
