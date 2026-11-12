/**
 * ExaminationJournalPage tests (E04, MSW): the WAITING/COMPLETED statuses are
 * visually and textually distinct, rows link to the real card ids only and
 * the tab switch re-queries with the explicit result filter.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { ExaminationJournalPage } from "./ExaminationJournalPage";
import type { IncomingView } from "../features/arrivals/api";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EXAM = "e0000000-0000-4000-8000-000000000001";
const EXAM2 = "e0000000-0000-4000-8000-000000000002";

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
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function arrival(examinationId: string): IncomingView {
  return {
    id: "3f0e6d2a-1111-4222-8333-444444444444",
    party_id: "9c1b2d3e-1111-4222-8333-444444444444",
    laboratory_id: LAB,
    external: {
      contour: "PILOT",
      evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
      status: "COMPLETED",
      fields: { documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac", consignor: "ООО «Мясопром»" },
    },
    classification: {
      product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
      subProduct: null,
      productItem: null,
      unit: null,
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
    examination_id: examinationId,
    revision: 1,
    source_presence: "CURRENT_CONFIRMED",
  };
}

function renderRoute(url = `/labs/${LAB}/examinations`): void {
  const client = new QueryClient();
  render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/labs/:labId/examinations" element={<ExaminationJournalPage />} />
          <Route path="/labs/:labId/examinations/:examinationId" element={<p>Карточка открыта</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ExaminationJournalPage", () => {
  it("lists real waiting cards with a distinct status and a real-id link", async () => {
    let queriedResult: string | null = null;
    server.use(
      http.get("*/api/v1/arrivals", ({ request }) => {
        queriedResult = new URL(request.url).searchParams.get("result");
        return HttpResponse.json({
          items: [arrival(EXAM)],
          total: 1,
          page: 1,
          page_size: 20,
        });
      }),
    );
    const user = userEvent.setup();
    renderRoute();
    expect(await screen.findByText("Ожидание результатов")).toBeTruthy();
    expect(queriedResult).toBe("WAITING");
    const link = await screen.findByRole("link", { name: /Просмотр карточки ВСЭ/ });
    expect(link.getAttribute("href")).toBe(`/labs/${LAB}/examinations/${EXAM}`);
    await user.click(link);
    expect(await screen.findByText("Карточка открыта")).toBeTruthy();
  });

  it("the completed tab re-queries with result=COMPLETED and labels the rows", async () => {
    let queriedResult: string | null = null;
    server.use(
      http.get("*/api/v1/arrivals", ({ request }) => {
        queriedResult = new URL(request.url).searchParams.get("result");
        return HttpResponse.json({
          items: [arrival(EXAM2)],
          total: 1,
          page: 1,
          page_size: 20,
        });
      }),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByText("Ожидание результатов");
    await user.click(screen.getByRole("tab", { name: "Завершённые" }));
    expect(await screen.findByText("Завершено")).toBeTruthy();
    expect(queriedResult).toBe("COMPLETED");
    expect(screen.getByRole("link", { name: /Просмотр карточки ВСЭ/ })).toBeTruthy();
  });
});
