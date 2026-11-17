/**
 * ReportsPage tests (DR37): the «Отчёты» hub is capability-driven — the role
 * itself never opens a direction. VET (sample:read) sees only «Учёт проб»
 * and never triggers the 5-вет list; HEAD/ANALYST see their permitted
 * directions; a user without any reporting capability (ADMIN included) gets
 * the honest forbidden state without a single report/sample request.
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

const SAMPLE_CAPS = ["sample:read"];
const REPORT_CAPS = [
  "sample:read",
  "report:operational",
  "report:5vet-list",
  "report:5vet-read",
  "report:5vet-preview",
  "report:5vet-save",
  "report:5vet-delete",
  "report:5vet-export",
];

function me(role: string, capabilities: string[] = REPORT_CAPS): Record<string, unknown> {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    full_name: "Тестовый пользователь",
    login: "tester",
    email: "tester@example.test",
    position: null,
    role,
    active: true,
    scopes: [{ laboratory_id: LAB, product_scope_id: null }],
    capabilities,
    revision: 1,
  };
}

const savedList = {
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
};

function trackWorkRequests(handlerLog: string[]): void {
  server.use(
    http.get("*/api/v1/reports/5vet", () => {
      handlerLog.push("GET /reports/5vet");
      return HttpResponse.json(savedList);
    }),
    http.get("*/api/v1/reports/operational", () => {
      handlerLog.push("GET /reports/operational");
      return HttpResponse.json({});
    }),
    http.get("*/api/v1/samples/*", () => {
      handlerLog.push("GET /samples");
      return HttpResponse.json([]);
    }),
  );
}

function renderPage(path = `/labs/${LAB}/reports`): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/labs/:labId/reports" element={<ReportsPage />} />
          <Route path="/labs/:labId/reports/new" element={<div>Создание</div>} />
          <Route path="/labs" element={<div>Выбор лаборатории</div>} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/labs/:labId/reports/operational" element={<div>Операционные показатели</div>} />
          <Route path="/labs/:labId/reports/samples" element={<div>Учёт проб экран</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReportsPage hub (DR37)", () => {
  it("HEAD sees all three directions and the saved 5-вет list", async () => {
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("HEAD"))),
      http.get("*/api/v1/reports/5vet", () => HttpResponse.json(savedList)),
    );
    renderPage();
    expect(await screen.findByText("Форма 5-вет (раздел III)")).toBeVisible();
    expect(screen.getByText("Операционные показатели")).toBeVisible();
    expect(screen.getByText("Учёт проб")).toBeVisible();
    const link = await screen.findByRole("link", { name: "Открыть: 2026, I полугодие" });
    expect(link.getAttribute("href")).toContain(`/labs/${LAB}/reports/${REPORT}`);
  });

  it("an ANALYST sees the three directions with an operational/samples link each", async () => {
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("ANALYST"))),
      http.get("*/api/v1/reports/5vet", () => HttpResponse.json({ ...savedList, items: [], total: 0 })),
    );
    renderPage();
    await screen.findByText("Форма 5-вет (раздел III)");
    const operational = screen.getByRole("link", { name: "Открыть: Операционные показатели" });
    expect(operational.getAttribute("href")).toBe(`/labs/${LAB}/reports/operational`);
    const samples = screen.getByRole("link", { name: "Открыть: Учёт проб" });
    expect(samples.getAttribute("href")).toBe(`/labs/${LAB}/reports/samples`);
  });

  it("a VET with sample:read sees only «Учёт проб» and never loads the 5-вет list", async () => {
    const log: string[] = [];
    trackWorkRequests(log);
    server.use(http.get("*/api/v1/me", () => HttpResponse.json(me("VET", SAMPLE_CAPS))));
    renderPage();
    expect(await screen.findByText("Учёт проб")).toBeVisible();
    expect(screen.queryByText("Форма 5-вет (раздел III)")).toBeNull();
    expect(screen.queryByText("Операционные показатели")).toBeNull();
    // No 5-вет list request, no operational metrics request.
    expect(log).toEqual([]);
  });

  it("a VET cannot see the create affordance without preview/save capabilities", async () => {
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("VET", SAMPLE_CAPS))),
      http.get("*/api/v1/reports/5vet", () => HttpResponse.json(savedList)),
    );
    renderPage();
    await screen.findByText("Учёт проб");
    expect(screen.queryByRole("button", { name: /Создать отчёт/ })).toBeNull();
  });

  it("a HEAD without 5-вет preview+save has no create affordance, but sees the list", async () => {
    const caps = REPORT_CAPS.filter((capability) => capability !== "report:5vet-save");
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("HEAD", caps))),
      http.get("*/api/v1/reports/5vet", () => HttpResponse.json(savedList)),
    );
    renderPage();
    expect(await screen.findByText(/2026, I полугодие/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Создать отчёт/ })).toBeNull();
  });

  it("the create affordance navigates to the creation page", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("ANALYST"))),
      http.get("*/api/v1/reports/5vet", () => HttpResponse.json({ ...savedList, items: [], total: 0 })),
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Создать отчёт" }));
    await waitFor(() => expect(screen.getByText("Создание")).toBeVisible());
  });

  it("an ADMIN gets the forbidden state and triggers no report/sample request", async () => {
    const log: string[] = [];
    trackWorkRequests(log);
    server.use(http.get("*/api/v1/me", () => HttpResponse.json(me("ADMIN", []))));
    renderPage();
    expect(await screen.findByText(/Раздел отчётов недоступен|нет отчётных полномочий/)).toBeVisible();
    expect(log).toEqual([]);
  });

  it("a user without any reporting capability gets the forbidden state", async () => {
    server.use(http.get("*/api/v1/me", () => HttpResponse.json(me("HEAD", ["arrivals:read"]))));
    renderPage();
    expect(await screen.findByText(/Раздел отчётов недоступен|нет отчётных полномочий/)).toBeVisible();
  });

  it("without a laboratory the page explains and links to the honest selection", async () => {
    server.use(http.get("*/api/v1/me", () => HttpResponse.json(me("ANALYST"))));
    renderPage("/reports");
    expect(await screen.findByText(/Лаборатория не выбрана|Выберите лабораторию/)).toBeVisible();
    const choose = screen.getByRole("link", { name: "Выбрать лабораторию" });
    expect(choose.getAttribute("href")).toBe("/labs");
    // No laboratory data of an arbitrary laboratory is ever requested.
    expect(screen.queryByText(/Сохранённые отчёты/)).toBeNull();
  });

  it("shows the human-readable laboratory name, not a UUID", async () => {
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("ANALYST"))),
      http.get("*/api/v1/reports/5vet", () => HttpResponse.json({ ...savedList, items: [], total: 0 })),
      http.get("*/api/v1/contexts/laboratories", () =>
        HttpResponse.json([{ laboratory_id: LAB, name: "ГБУ «Лаборатория №1 г. Казань»" }]),
      ),
    );
    renderPage();
    expect(await screen.findByText(/Лаборатория №1 г. Казань/)).toBeVisible();
  });

  it("without report:5vet-list the 5-вет card never claims «пока нет» (false-empty fix)", async () => {
    const log: string[] = [];
    trackWorkRequests(log);
    server.use(
      http.get("*/api/v1/me", () =>
        HttpResponse.json(me("ANALYST", ["sample:read", "report:operational", "report:5vet-read"])),
      ),
    );
    renderPage();
    expect(await screen.findByText("Форма 5-вет (раздел III)")).toBeVisible();
    // The list was never requested; the meta is neutral, no false empty state.
    expect(screen.queryByText("Сохранённых отчётов пока нет.")).toBeNull();
    expect(screen.getByText("Список сохранённых отчётов недоступен.")).toBeVisible();
    expect(log).toEqual([]);
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

  it("the hub has no «← Поступления» breadcrumb (ТЗ DR41 §4)", async () => {
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("ANALYST"))),
      http.get("*/api/v1/reports/5vet", () => HttpResponse.json({ ...savedList, items: [], total: 0 })),
    );
    renderPage();
    await screen.findByText("Форма 5-вет (раздел III)");
    expect(screen.queryByRole("link", { name: "← Поступления" })).toBeNull();
    expect(screen.queryByText("← Поступления")).toBeNull();
  });
});
