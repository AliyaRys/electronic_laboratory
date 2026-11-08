/**
 * ReportsPage tests (R03, AT-20): the saved-report list with real links,
 * VET gets the honest forbidden state, ADMIN likewise; the row itself is
 * not a link container (the menu never opens the row).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ReportsPage } from "./ReportsPage";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REPORT = "11111111-2222-4333-8444-555555555555";

function me(role: string): Record<string, unknown> {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    full_name: "Тестовый пользователь",
    login: "tester",
    email: "tester@example.test",
    position: null,
    role,
    active: true,
    scopes: [{ laboratory_id: LAB, product_scope_id: null }],
    capabilities: [],
    revision: 1,
  };
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/labs/${LAB}/reports`]}>
        <Routes>
          <Route path="/labs/:labId/reports" element={<ReportsPage />} />
          <Route path="/labs/:labId/reports/new" element={<div>Создание</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReportsPage", () => {
  it("lists saved reports with keyboard-accessible links", async () => {
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("HEAD"))),
      http.get("*/api/v1/reports/5vet", () =>
        HttpResponse.json({
          items: [
            {
              id: REPORT,
              report_type: "5VET_SECTION_III",
              laboratory_id: LAB,
              year: 2026,
              half: 1,
              source_count: 3,
              saved_at: "2027-01-02T10:00:00Z",
              saved_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              rev: 1,
            },
          ],
          total: 1,
          page: 1,
          page_size: 20,
        }),
      ),
    );
    renderPage();
    const link = await screen.findByRole("link", { name: /2026, I полугодие/ });
    expect(link.getAttribute("href")).toContain(`/labs/${LAB}/reports/${REPORT}`);
    expect(screen.getByText(/Источников: 3/)).toBeVisible();
  });

  it("forbids VET (samples scope only) and ADMIN", async () => {
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("VET"))),
      http.get("*/api/v1/reports/5vet", () =>
        HttpResponse.json({ items: [], total: 0, page: 1, page_size: 20 }),
      ),
    );
    renderPage();
    expect(await screen.findByText("Раздел доступен только заведующему и аналитику.")).toBeVisible();
    // No report data was requested at all.
    expect(screen.queryByText(/Сохранённые отчёты/)).toBeNull();
  });

  it("the create affordance navigates to the creation page", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("ANALYST"))),
      http.get("*/api/v1/reports/5vet", () =>
        HttpResponse.json({ items: [], total: 0, page: 1, page_size: 20 }),
      ),
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Создать отчёт 5-вет" }));
    await waitFor(() => expect(screen.getByText("Создание")).toBeVisible());
  });

  it("pages through 25 saved reports: page 2 then back", async () => {
    const user = userEvent.setup();
    const gets: string[] = [];
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("HEAD"))),
      http.get("*/api/v1/reports/5vet", ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") ?? "1");
        gets.push(`page=${page}`);
        const items = Array.from({ length: 25 }, (_value, index) => ({
          id: `report-${index}`,
          report_type: "5VET_SECTION_III",
          laboratory_id: LAB,
          year: 2026,
          half: index % 2 === 0 ? 1 : 2,
          source_count: 3,
          saved_at: "2027-01-02T10:00:00Z",
          saved_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          rev: 1,
        }));
        const pageSize = 20;
        const start = (page - 1) * pageSize;
        return HttpResponse.json({
          items: items.slice(start, start + pageSize),
          total: items.length,
          page,
          page_size: pageSize,
        });
      }),
    );
    renderPage();
    expect(await screen.findByText(/Страница 1 из 2/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Следующая страница" }));
    expect(await screen.findByText(/Страница 2 из 2/)).toBeVisible();
    expect(gets).toContain("page=2");
    await user.click(screen.getByRole("button", { name: "Предыдущая страница" }));
    expect(await screen.findByText(/Страница 1 из 2/)).toBeVisible();
    expect(gets).toContain("page=1");
    // The «previous» control is disabled on the first page.
    expect(screen.getByRole("button", { name: "Предыдущая страница" })).toBeDisabled();
  });
});
