/**
 * ТЗ DR23 §7 frontend tests (A02, MSW): the bounded background refresh of an
 * open reconciliation while the worker is still resolving participant names.
 * The browser NEVER reaches VetIS — every GET here goes to the local
 * read-model endpoints only.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ReconciliationPage } from "./ReconciliationPage";
import { NAME_POLL_INTERVAL_MS, NAME_POLL_MAX_MS } from "../features/arrivals/api";
import type { IncomingView, ReconciliationView } from "../features/arrivals/api";
import { useDirtyStore } from "../entities/session/context";
const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type NameState = {
  owner: string | null;
  ownerSource: string;
  enterprise: string | null;
  enterpriseSource: string;
};

let receiverNames: NameState = {
  owner: null,
  ownerSource: "PENDING",
  enterprise: null,
  enterpriseSource: "PENDING",
};
let arrivalGetCount = 0;
let reconciliationGetCount = 0;

function partyView(): IncomingView {
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
        receiverOwner: receiverNames.owner,
        receiverOwnerNameSource: receiverNames.ownerSource,
        receiverEnterprise: receiverNames.enterprise,
        receiverEnterpriseNameSource: receiverNames.enterpriseSource,
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

const reconciliationView: ReconciliationView = {
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

const requestedUrls: string[] = [];

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
  http.get(`*/api/v1/arrivals/${PARTY}`, () => {
    arrivalGetCount += 1;
    return HttpResponse.json(partyView());
  }),
  http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => {
    reconciliationGetCount += 1;
    return HttpResponse.json(reconciliationView);
  }),
);

beforeAll(() => {
  server.listen();
  server.events.on("request:start", ({ request }) => {
    requestedUrls.push(request.url);
  });
});
afterEach(() => {
  server.resetHandlers();
  receiverNames = { owner: null, ownerSource: "PENDING", enterprise: null, enterpriseSource: "PENDING" };
  arrivalGetCount = 0;
  reconciliationGetCount = 0;
  requestedUrls.length = 0;
  useDirtyStore.getState().setDirty(false);
});
afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

function renderPage(): { unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/labs/${LAB}/arrivals/${PARTY}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/labs/:labId/arrivals/:partyId" element={<ReconciliationPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ReconciliationPage name polling (ТЗ DR23 §6)", () => {
  it(
    "shows the honest pending text first, then the resolved name without navigation",
    { timeout: 20000 },
    async () => {
      renderPage();
      await screen.findAllByText("Уточняем названия организаций…");
      // The worker resolved both receiver rows: the next bounded poll picks it up.
      receiverNames = {
        owner: "ОАО «Восход»",
        ownerSource: "VETIS_LOOKUP",
        enterprise: "Лабораторный убойный пункт",
        enterpriseSource: "VETIS_LOOKUP",
      };
      await waitFor(
        () => {
          expect(screen.getByText("ОАО «Восход»")).toBeTruthy();
        },
        { timeout: 8000 },
      );
      expect(screen.getByText("Лабораторный убойный пункт")).toBeTruthy();
      // No navigation happened: the reconciliation screen is still the open one.
      expect(screen.getByRole("heading", { name: "Сведения о получателе" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Сверка данных транспортного эВСД" })).toBeTruthy();
    },
  );

  it("updates both PENDING receiver fields on the open screen", { timeout: 20000 }, async () => {
    renderPage();
    expect(await screen.findAllByText("Уточняем названия организаций…")).toHaveLength(2);
    receiverNames = {
      owner: "ОАО «Восход»",
      ownerSource: "VETIS_LOOKUP",
      enterprise: "Лабораторный убойный пункт",
      enterpriseSource: "VETIS_LOOKUP",
    };
    await waitFor(() => expect(screen.getByText("ОАО «Восход»")).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText("Лабораторный убойный пункт")).toBeTruthy();
    expect(screen.queryByText("Уточняем названия организаций…")).toBeNull();
  });

  it("stops polling after RESOLVED and after unmount", { timeout: 30000 }, async () => {
    const first = renderPage();
    await screen.findAllByText("Уточняем названия организаций…");
    receiverNames = {
      owner: "ОАО «Восход»",
      ownerSource: "VETIS_LOOKUP",
      enterprise: "Лабораторный убойный пункт",
      enterpriseSource: "VETIS_LOOKUP",
    };
    await waitFor(() => expect(screen.getByText("ОАО «Восход»")).toBeTruthy(), { timeout: 8000 });
    const afterResolved = reconciliationGetCount;
    const arrivalAfterResolved = arrivalGetCount;
    await sleep(NAME_POLL_INTERVAL_MS * 3);
    // RESOLVED: no further reconciliation GETs.
    expect(reconciliationGetCount).toBe(afterResolved);
    expect(arrivalGetCount).toBe(arrivalAfterResolved);

    // Unmount while PENDING: the timer and the in-flight requests are gone.
    first.unmount();
    receiverNames = { owner: null, ownerSource: "PENDING", enterprise: null, enterpriseSource: "PENDING" };
    const second = render(
      <MemoryRouter initialEntries={[`/labs/${LAB}/arrivals/${PARTY}`]}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/labs/:labId/arrivals/:partyId" element={<ReconciliationPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText("Уточняем названия организаций…");
    second.unmount();
    const afterUnmount = reconciliationGetCount;
    await sleep(NAME_POLL_INTERVAL_MS * 3);
    expect(reconciliationGetCount).toBe(afterUnmount);
  });

  it(
    "keeps the entered actual value, reason and marks across name refetches",
    { timeout: 20000 },
    async () => {
      renderPage();
      await screen.findAllByText("Уточняем названия организаций…");
      await userEvent.click(screen.getByRole("radio", { name: "Не совпадает: Вес, кг" }));
      const actual = screen.getByLabelText("Фактическое значение");
      await userEvent.type(actual, "118");
      await userEvent.type(screen.getByLabelText("Причина несоответствия"), "Потери при перевозке");
      receiverNames = {
        owner: "ОАО «Восход»",
        ownerSource: "VETIS_LOOKUP",
        enterprise: "Лабораторный убойный пункт",
        enterpriseSource: "VETIS_LOOKUP",
      };
      await waitFor(() => expect(screen.getByText("ОАО «Восход»")).toBeTruthy(), { timeout: 8000 });
      // The user input survived the background refresh.
      expect((screen.getByLabelText("Фактическое значение") as HTMLInputElement).value).toBe("118");
      expect((screen.getByLabelText("Причина несоответствия") as HTMLInputElement).value).toBe(
        "Потери при перевозке",
      );
      expect((screen.getByRole("radio", { name: "Не совпадает: Вес, кг" }) as HTMLInputElement).checked).toBe(
        true,
      );
    },
  );

  it("never requests VetIS from the browser", { timeout: 20000 }, async () => {
    renderPage();
    receiverNames = {
      owner: "ОАО «Восход»",
      ownerSource: "VETIS_LOOKUP",
      enterprise: "Лабораторный убойный пункт",
      enterpriseSource: "VETIS_LOOKUP",
    };
    await waitFor(() => expect(screen.getByText("ОАО «Восход»")).toBeTruthy(), { timeout: 8000 });
    await sleep(NAME_POLL_INTERVAL_MS * 2);
    for (const url of requestedUrls) {
      expect(url).not.toContain("api2.vetrf.ru");
      expect(url).not.toContain("vetrf.ru");
      expect(url).not.toContain("EnterpriseService");
      expect(url).not.toMatch(/soap/i);
    }
    // The bounded poll talks ONLY to the local read-model endpoints.
    expect(reconciliationGetCount).toBeGreaterThan(1);
  });

  it("uses the agreed bounded polling constants", () => {
    expect(NAME_POLL_INTERVAL_MS).toBe(1500);
    expect(NAME_POLL_MAX_MS).toBe(30000);
    expect(NAME_POLL_MAX_MS / NAME_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(10);
  });
});
