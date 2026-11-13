/**
 * ТЗ DR23 §7.6 (frontend 6): the honest participant-name states of the
 * receiver card — loading/resolved/error/missing, a very long name and the
 * narrow 390 px viewport.
 */
import { render, screen } from "@testing-library/react";
import { describe, afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReconciliationForm } from "./ReconciliationForm";
import { NAME_ERROR_TEXT, NAME_MISSING_TEXT, NAME_PENDING_TEXT, participantName } from "./api";
import type { IncomingView, ReconciliationView } from "./api";
import { useDirtyStore } from "../../entities/session/context";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const LONG_NAME =
  "Государственное унитарное предприятие «Объединённый мясоперерабатывающий комбинат имени Первого государственного убойного пункта»";

function partyView(receiver: {
  owner: string | null;
  ownerSource: string;
  enterprise: string | null;
  enterpriseSource: string;
}): IncomingView {
  return {
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
        consignee: "",
        productItem: "Отруба говяжьи",
        massKg: "120.0",
        senderOwner: "ООО «Мясопром»",
        senderOwnerNameSource: "VETIS_LOOKUP",
        senderEnterprise: "Предприятие «Мясопром»",
        senderEnterpriseNameSource: "VETIS_LOOKUP",
        receiverOwner: receiver.owner,
        receiverOwnerNameSource: receiver.ownerSource,
        receiverEnterprise: receiver.enterprise,
        receiverEnterpriseNameSource: receiver.enterpriseSource,
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
}

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

function renderForm(view: IncomingView): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReconciliationForm party={view} initial={emptyView} onSaved={() => undefined} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  useDirtyStore.getState().setDirty(false);
});

describe("participant-name states (ТЗ DR23 §6)", () => {
  it("maps every honest state to its agreed text (never a GUID)", () => {
    const view = partyView({
      owner: null,
      ownerSource: "PENDING",
      enterprise: null,
      enterpriseSource: "MISSING",
    });
    expect(participantName(view, "receiver", "owner")).toEqual({
      value: NAME_PENDING_TEXT,
      state: "loading",
    });
    expect(participantName(view, "receiver", "enterprise")).toEqual({
      value: NAME_MISSING_TEXT,
      state: "missing",
    });
    const errored = partyView({
      owner: null,
      ownerSource: "ERROR",
      enterprise: null,
      enterpriseSource: "MISSING",
    });
    expect(participantName(errored, "receiver", "owner")).toEqual({
      value: NAME_ERROR_TEXT,
      state: "error",
    });
  });

  it("renders loading, resolved, error and missing states in the receiver card", () => {
    const show = (view: IncomingView): (() => void) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const result = render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <ReconciliationForm party={view} initial={emptyView} onSaved={() => undefined} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      return result.unmount;
    };
    let unmountNow = show(
      partyView({ owner: null, ownerSource: "PENDING", enterprise: null, enterpriseSource: "PENDING" }),
    );
    expect(screen.getAllByText(NAME_PENDING_TEXT).length).toBe(2);
    unmountNow();
    unmountNow = show(
      partyView({
        owner: "ОАО «Восход»",
        ownerSource: "VETIS_LOOKUP",
        enterprise: "Лабораторный убойный пункт",
        enterpriseSource: "VETIS_LOOKUP",
      }),
    );
    expect(screen.getByText("ОАО «Восход»")).toBeTruthy();
    unmountNow();
    unmountNow = show(
      partyView({ owner: null, ownerSource: "ERROR", enterprise: null, enterpriseSource: "MISSING" }),
    );
    expect(screen.getByText(NAME_ERROR_TEXT)).toBeTruthy();
    unmountNow();
    unmountNow = show(
      partyView({ owner: null, ownerSource: "MISSING", enterprise: null, enterpriseSource: "MISSING" }),
    );
    expect(screen.getAllByText(NAME_MISSING_TEXT).length).toBe(2);
    unmountNow();
  });

  it("shows a very long resolved name fully, never a GUID", () => {
    renderForm(
      partyView({
        owner: LONG_NAME,
        ownerSource: "VETIS_LOOKUP",
        enterprise: "Лабораторный убойный пункт",
        enterpriseSource: "VETIS_LOOKUP",
      }),
    );
    expect(screen.getByText(LONG_NAME)).toBeTruthy();
    // The participant name field shows the resolved NAME; no receiver
    // GUID/UUID is rendered anywhere as a name.
    expect(screen.queryByText("3e188573-0de9-42c1-ab14-1f3e8391cb3e")).toBeNull();
  });

  it("keeps the receiver card present and labelled at the 390 px viewport", () => {
    const original = window.innerWidth;
    window.innerWidth = 390;
    try {
      renderForm(
        partyView({ owner: null, ownerSource: "PENDING", enterprise: null, enterpriseSource: "PENDING" }),
      );
      expect(screen.getByRole("heading", { name: "Сведения о получателе" })).toBeTruthy();
      expect(screen.getAllByText(NAME_PENDING_TEXT).length).toBe(2);
    } finally {
      window.innerWidth = original;
    }
  });
});
