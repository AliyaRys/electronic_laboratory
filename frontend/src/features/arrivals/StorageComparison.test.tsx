/**
 * ТЗ DR16 §8 frontend tests (6): the compared field
 * «Способ хранения продукции при перевозке» (CHK-F12) in the transport block —
 * the Russian source value from the backend (the raw VetIS code is never
 * translated by the frontend, R-DR16-1), the shared ComparisonField card with
 * the mismatch placeholder «Фактический способ хранения», the explicit mark
 * saved/restored across a reopen, the server decision matrix restriction and
 * the honest fallback for an unknown code on narrow screens.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router";
import { ReconciliationForm } from "./ReconciliationForm";
import { comparedFields, computeAllowedDecisions, type IncomingView, type ReconciliationView } from "./api";
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
      issuedOn: "2026-11-12",
      statusLabel: "Оформлен",
      transportNumber: "А123ВВ77",
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
  saved_at: "2026-11-12T10:00:00Z",
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

it("shows CHK-F12 in the transport block with the Russian source value, not the VetIS code", () => {
  renderForm();
  expect(screen.getByText("Способ хранения продукции при перевозке")).toBeInTheDocument();
  expect(screen.getByText("Охлажденный")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("CHILLED");
});

it("keeps CHK-F12 inside the transport block right after the transport numbers", () => {
  const fields = comparedFields(party);
  const transport = fields.filter((field) => field.block === "transport").map((field) => field.fieldId);
  expect(transport).toEqual(["CHK-F10", "CHK-F12"]);
  const storage = fields.find((field) => field.fieldId === "CHK-F12");
  expect(storage?.label).toBe("Способ хранения продукции при перевозке");
  expect(storage?.source).toBe("Охлажденный");
});

it("opens the mismatch fact with the dedicated placeholder and the reason field", async () => {
  renderForm();
  await userEvent.click(
    screen.getByRole("radio", { name: "Не совпадает: Способ хранения продукции при перевозке" }),
  );
  expect(screen.getByPlaceholderText("Фактический способ хранения")).toBeInTheDocument();
  expect(screen.getByLabelText("Причина несоответствия")).toBeInTheDocument();
});

it("restores the saved mark and facts after reopening the form", () => {
  renderForm({
    initial: {
      ...emptyView,
      checks: {
        "CHK-F12": { matches: false, actual: "Замороженный", reason: "Термограф показывает оттайку" },
      },
    },
  });
  expect(
    screen.getByRole("radio", { name: "Не совпадает: Способ хранения продукции при перевозке" }),
  ).toBeChecked();
  expect(screen.getByLabelText("Фактическое значение")).toHaveValue("Замороженный");
  expect(screen.getByLabelText("Причина несоответствия")).toHaveValue("Термограф показывает оттайку");
});

it("restricts the locally enabled decisions to RETURN_ALL for a CHK-F12 mismatch", () => {
  const allowed = computeAllowedDecisions(
    { mass_kg: "120", quantity: "4" },
    { "CHK-F12": { matches: false } },
  );
  expect(allowed).toEqual(["RETURN_ALL"]);
  renderForm({
    initial: {
      ...emptyView,
      delivered: { mass_kg: "120", quantity: "4", unit_id: "u1" },
      checks: { "CHK-F12": { matches: false, actual: "Замороженный", reason: "Оттайка" } },
    },
  });
  expect(screen.getByRole("radio", { name: /Полное гашение/ })).toBeDisabled();
  expect(screen.getByRole("radio", { name: /Частичное гашение/ })).toBeDisabled();
  expect(screen.getByRole("radio", { name: /Полный возврат/ })).toBeEnabled();
});

it("renders the honest fallback for an unknown code without horizontal overflow on 390 px", () => {
  renderForm({
    party: {
      ...party,
      external: {
        ...party.external,
        fields: {
          ...party.external.fields,
          storageCode: "RADIOACTIVE",
          storage: "Неизвестный способ хранения",
        },
      },
    },
  });
  expect(screen.getByText("Неизвестный способ хранения")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("RADIOACTIVE");
  const before = window.innerWidth;
  window.innerWidth = 390;
  expect(document.documentElement.scrollWidth <= window.innerWidth + 1).toBe(true);
  window.innerWidth = before;
});

describe("no automatic marks", () => {
  it("renders CHK-F12 without any preselected radio (the mark stays explicit)", () => {
    renderForm();
    expect(
      screen.getByRole("radio", { name: "Совпадает: Способ хранения продукции при перевозке" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Не совпадает: Способ хранения продукции при перевозке" }),
    ).not.toBeChecked();
    expect(screen.queryByLabelText("Фактическое значение")).toBeNull();
  });
});
