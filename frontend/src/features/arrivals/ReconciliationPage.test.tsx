/**
 * ReconciliationPage tests (fix round 1): the REAL route loads the party by
 * its id through GET /arrivals/:party_id — never via a queue `q` search a
 * party UUID can never match; a foreign/unknown UUID renders not-found.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ReconciliationPage } from "../../pages/ReconciliationPage";
import type { IncomingView, ReconciliationView } from "./api";

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
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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
      consignee: "Убойный пункт",
      productItem: "Отруба говяжьи",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: null,
    unit: null,
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "u1" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 1,
};

const emptyReconciliation: ReconciliationView = {
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
  allowed_decisions: [],
  act: { required: false, items: [] },
  route: null,
  errors: [],
  complete: false,
};

function renderRoute(partyId = PARTY): void {
  const client = new QueryClient();
  render(
    <MemoryRouter initialEntries={[`/labs/${LAB}/arrivals/${partyId}/reconciliation`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/labs/:labId/arrivals/:partyId/reconciliation" element={<ReconciliationPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ReconciliationPage", () => {
  it("loads a real party by id through the single read and renders the form", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}`, () => HttpResponse.json(party)),
      http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => HttpResponse.json(emptyReconciliation)),
    );
    renderRoute();
    expect(await screen.findByText("Решение о приёмке")).toBeInTheDocument();
    expect(screen.getByText("1f0e6d2a-1111-4222-8333-444444444444")).toBeInTheDocument();
  });

  it("renders the mockup title row with the Mercury badge", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}`, () => HttpResponse.json(party)),
      http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => HttpResponse.json(emptyReconciliation)),
    );
    renderRoute();
    expect(
      await screen.findByRole("heading", { name: "Сверка данных транспортного эВСД" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Меркурий")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Поступления" })).toBeInTheDocument();
  });

  it("renders the loading state while the reads are in flight", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}`, () => HttpResponse.json(party)),
      http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => new Promise(() => undefined)),
    );
    renderRoute();
    expect(await screen.findByText("Загрузка сверки…")).toBeInTheDocument();
    expect(screen.queryByText("Решение о приёмке")).toBeNull();
  });

  it("renders not-found for a foreign or unknown party UUID", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}`, () =>
        HttpResponse.json(
          {
            code: "NOT_FOUND",
            title: "Not found",
            status: 404,
            detail: "Поступление не найдено.",
            instance: "",
          },
          { status: 404 },
        ),
      ),
      http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => HttpResponse.json(emptyReconciliation)),
    );
    renderRoute();
    expect(await screen.findByText("Поступление не найдено в доступной области.")).toBeInTheDocument();
    expect(screen.queryByText("Решение о приёмке")).toBeNull();
  });

  it("renders a network error with retry", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}`, () =>
        HttpResponse.json(
          {
            code: "NETWORK_ERROR",
            title: "Network error",
            status: 0,
            detail: "Сеть недоступна.",
            instance: "",
          },
          { status: 500 },
        ),
      ),
      http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => HttpResponse.json(emptyReconciliation)),
    );
    renderRoute();
    expect(await screen.findByText("Не удалось загрузить поступление.")).toBeInTheDocument();
  });

  it("explains the closed state instead of the editable form", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}`, () => HttpResponse.json(party)),
      http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () =>
        HttpResponse.json({
          ...emptyReconciliation,
          state: "CONFIRMED",
          decision: "ACCEPT_ALL",
          complete: true,
        }),
      ),
    );
    renderRoute();
    expect(await screen.findByText("Сверка подтверждена внешним результатом.")).toBeInTheDocument();
    expect(screen.queryByText("Решение о приёмке")).toBeNull();
  });
});
