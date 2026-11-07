/**
 * ExaminationViewPage tests (E04, MSW): a WAITING card shows NO conclusion
 * (no outcome/direction/reason, no print/download), offers the strictly
 * separate late-outcome action, and a COMPLETED card shows the saved result.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { ExaminationViewPage } from "./ExaminationViewPage";
import type { ExaminationView } from "../features/examinations/api";
import type { IncomingView } from "../features/arrivals/api";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const EXAM = "e0000000-0000-4000-8000-000000000001";

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
  http.get(`*/api/v1/arrivals/${PARTY}`, () => HttpResponse.json(partyView)),
  http.get("*/api/v1/samples/collections*", () =>
    HttpResponse.json({ items: [], total: 0, page: 1, page_size: 20 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const partyView: IncomingView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: { documentNumber: "№ A-001234", consignor: "ООО «Мясопром»" },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: { id: "362aa886", name: "Говядина" },
    productItem: { id: "362aa887", name: "Отруба говяжьи" },
    unit: { id: "362aa888", name: "штука" },
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "u1" },
  confirmation: {
    id: "c1000000-0000-4000-8000-000000000001",
    accepted_mass_kg: "100.0",
    accepted_quantity: "4",
    accepted_unit_id: "шт",
    returned_mass_kg: "0",
    returned_quantity: "0",
    confirmed_at: "2026-11-07T10:00:00Z",
  },
  queue: "WORK",
  examination_id: EXAM,
  revision: 1,
};

function card(overrides: Partial<ExaminationView>): ExaminationView {
  return {
    id: EXAM,
    party_id: PARTY,
    laboratory_id: LAB,
    number: "№ 12",
    stamp: "кл-1",
    status: "WAITING",
    sent_to_lab: true,
    researches: [],
    invasive_findings: [],
    noncontagious_findings: [],
    pricing: { lines: [], total: "0.00", currency: "RUB", fair: false },
    sample_collection_id: "44444444-4444-4444-8444-444444444444",
    outcome: null,
    direction: null,
    reason: null,
    created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    // The same-day actions (edit/delete) depend on the card's creation day:
    // build the stamp from the real clock so the tests stay date-independent.
    created_at: new Date().toISOString(),
    first_completed_at: null,
    revision: 1,
    ...overrides,
  };
}

function renderRoute(): void {
  const client = new QueryClient();
  render(
    <MemoryRouter initialEntries={[`/labs/${LAB}/examinations/${EXAM}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/labs/:labId/examinations/:examinationId" element={<ExaminationViewPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ExaminationViewPage", () => {
  it("a WAITING card shows no conclusion and offers the separate late outcome", async () => {
    server.use(http.get(`*/api/v1/examinations/${EXAM}`, () => HttpResponse.json(card({}))));
    renderRoute();
    expect(await screen.findByRole("heading", { name: /Карточка ВСЭ № 12/ })).toBeTruthy();
    // No conclusion is shown while waiting (SC-047).
    expect(screen.queryByText(/В реализацию без ограничений/)).toBeNull();
    expect(screen.queryByText(/На утилизацию/)).toBeNull();
    expect(screen.queryByRole("link", { name: /заключени|печать|скачат/i })).toBeNull();
    // Readonly facts of the card and the party.
    expect(screen.getByText("кл-1")).toBeTruthy();
    expect(await screen.findByText("№ A-001234", {}, { timeout: 6000 })).toBeTruthy();
    expect(screen.getByText("100.0")).toBeTruthy();
    // The late completion is its own single action.
    expect(screen.getByRole("button", { name: "Завершить ожидание" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Исправить карточку" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeTruthy();
  });

  it("a COMPLETED card shows the saved outcome without the late action", async () => {
    server.use(
      http.get(`*/api/v1/examinations/${EXAM}`, () =>
        HttpResponse.json(
          card({
            status: "COMPLETED",
            outcome: "UNFIT",
            direction: "DISPOSAL",
            reason: "Посторонние включения",
            first_completed_at: "2026-11-07T12:00:00Z",
          }),
        ),
      ),
    );
    renderRoute();
    expect(await screen.findByText("Непригодно · На утилизацию")).toBeTruthy();
    expect(screen.getByText("Посторонние включения")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Завершить ожидание" })).toBeNull();
  });
});
