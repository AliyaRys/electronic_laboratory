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
const ORGANOLEPTIC_ID = "c8d1e50e-bf49-5475-bb82-860f6fc47e74";
const TEMPERATURE_ID = "ec2fba68-e4d1-5c82-9591-92ee9da5293e";

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
    status: "CONFIRMED",
    fields: { documentUuid: "1f0e6d2a-1111-4222-8333-444444444444", consignor: "ООО «Мясопром»" },
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
  source_presence: "CURRENT_CONFIRMED",
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
    sample: {
      id: "44444444-4444-4444-8444-444444444444",
      collected_on: "2026-11-05",
      mass_kg: "0.800000",
      revision: 1,
    },
    outcome: null,
    direction: null,
    reason: null,
    created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    specialist_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    specialist_name: "Врач Ветеринарный",
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
  it("a 404 route problem shows the honest «Просмотр записи» title (DR44 fix-loop)", async () => {
    server.use(
      http.get(`*/api/v1/examinations/${EXAM}`, () =>
        HttpResponse.json(
          { code: "NOT_FOUND", detail: "Карточка не найдена в доступной области." },
          { status: 404 },
        ),
      ),
    );
    renderRoute();
    expect(await screen.findByRole("heading", { name: "Просмотр записи" })).toBeTruthy();
    expect(screen.getAllByText("Карточка не найдена в доступной области.").length).toBeGreaterThan(0);
  });

  it("a WAITING card shows no conclusion and offers the separate late outcome", async () => {
    server.use(http.get(`*/api/v1/examinations/${EXAM}`, () => HttpResponse.json(card({}))));
    renderRoute();
    expect(await screen.findByRole("heading", { name: /ВСЭ № 12/ })).toBeTruthy();
    // No conclusion is shown while waiting (SC-047).
    expect(screen.queryByText(/В реализацию без ограничений/)).toBeNull();
    expect(screen.queryByText(/На утилизацию/)).toBeNull();
    expect(screen.queryByRole("link", { name: /заключени|печать|скачат/i })).toBeNull();
    // Readonly facts of the card and the party.
    expect(await screen.findByDisplayValue("кл-1", {}, { timeout: 6000 })).toBeTruthy();
    expect(
      await screen.findByDisplayValue("1f0e6d2a-1111-4222-8333-444444444444", {}, { timeout: 6000 }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("100")).toBeTruthy();
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
    expect(await screen.findByDisplayValue("Непригодно · На утилизацию")).toBeTruthy();
    expect(screen.getByDisplayValue("Посторонние включения")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Завершить ожидание" })).toBeNull();
  });

  // --- ТЗ DR44 §4: the vse-view composition (Task 6) ---------------------------------

  it("renders the six mockup sections with real data", async () => {
    server.use(
      http.get(`*/api/v1/examinations/${EXAM}`, () =>
        HttpResponse.json(
          card({
            status: "COMPLETED",
            outcome: "FIT",
            direction: "SALE",
            first_completed_at: "2026-11-07T12:00:00Z",
            researches: [
              { indicatorId: ORGANOLEPTIC_ID, kind: "ENUM", value: "MATCH" },
              { indicatorId: TEMPERATURE_ID, kind: "DECIMAL", value: "4.5" },
            ],
            pricing: {
              lines: [
                {
                  service_code: TEMPERATURE_ID,
                  name: "Температура в толще мышц",
                  quantity: "1",
                  unit_id: "service",
                  unit_price: "5.00",
                  amount: "5.00",
                },
              ],
              total: "5.00",
              currency: "RUB",
              fair: false,
            },
          }),
        ),
      ),
    );
    renderRoute();
    for (const heading of [
      "Сведения об экспертизе",
      "Участники и продукция",
      "Исследования ВСЭ",
      "Проба",
      "Итог экспертизы",
      "Расчёт стоимости услуг",
    ]) {
      expect(await screen.findByRole("heading", { name: heading }, { timeout: 6000 })).toBeTruthy();
    }
    // The known research shows its Russian name, never «Показатель UUID».
    expect(screen.getByText("Органолептическое исследование")).toBeTruthy();
    expect(screen.getAllByText("Температура в толще мышц").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Показатель /)).toBeNull();
    // The linked sample (date + mass) from view.sample.
    expect(screen.getByDisplayValue("05.11.2026")).toBeTruthy();
    expect(screen.getByDisplayValue("0,8")).toBeTruthy();
    // The outcome, the specialist and the frozen pricing total.
    expect(screen.getByDisplayValue("Пригодно · В реализацию без ограничений")).toBeTruthy();
    expect(screen.getByDisplayValue("Врач Ветеринарный")).toBeTruthy();
    expect(screen.getAllByText("5,00 ₽").length).toBeGreaterThanOrEqual(2);
  });

  it("the title is «Просмотр записи» + «ВСЭ №…» with the compact actions", async () => {
    server.use(http.get(`*/api/v1/examinations/${EXAM}`, () => HttpResponse.json(card({}))));
    renderRoute();
    expect(await screen.findByText("Просмотр записи")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ВСЭ № 12" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Исправить карточку" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeTruthy();
  });

  it("a WAITING card still fabricates no outcome but keeps the late action", async () => {
    server.use(http.get(`*/api/v1/examinations/${EXAM}`, () => HttpResponse.json(card({}))));
    renderRoute();
    await screen.findByRole("heading", { name: /ВСЭ № 12/ });
    expect(screen.queryByText("Пригодно")).toBeNull();
    expect(screen.queryByText("Непригодно")).toBeNull();
    expect(
      await screen.findByText("Итог не указан: карточка ожидает ответа лаборатории.", {}, { timeout: 6000 }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Завершить ожидание" })).toBeTruthy();
  });
});
