/**
 * ReportViewPage tests (R03): the summary + form of one saved snapshot; a
 * report deleted elsewhere answers 404 and the honest not-found state; the
 * export actions call the snapshot-only export URLs.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ReportViewPage } from "./ReportViewPage";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REPORT = "11111111-2222-4333-8444-555555555555";

const payload = {
  version: 1,
  laboratory: { name: "Лаборатория №1" },
  year: 2026,
  half: 1,
  classification_version: "2026-v1",
  columns: ["PIG"],
  matrix: [["2"]],
  source_count: 1,
  official: false,
};

function renderView(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/labs/${LAB}/reports/${REPORT}`]}>
        <Routes>
          <Route path="/labs/:labId/reports/:reportId" element={<ReportViewPage />} />
          <Route path="/labs/:labId/reports" element={<div>Список отчётов</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function snapshotView(): Record<string, unknown> {
  return {
    id: REPORT,
    report_type: "5VET_SECTION_III",
    laboratory_id: LAB,
    year: 2026,
    half: 1,
    payload,
    codes: { okud: "001", okpo: "1", okved: "1", oktmo: "1", okogu: "1", okopf: "1", okfs: "1" },
    source_count: 1,
    saved_at: "2027-01-02T10:00:00Z",
    saved_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    rev: 1,
  };
}

describe("ReportViewPage", () => {
  it("shows the summary and the saved matrix without recomputation", async () => {
    server.use(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          full_name: "Тестовый пользователь",
          login: "tester",
          email: "tester@example.test",
          position: null,
          role: "HEAD",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
        }),
      ),
      http.get(`*/api/v1/reports/5vet/${REPORT}`, () => HttpResponse.json(snapshotView())),
    );
    renderView();
    expect(await screen.findByText("Матрица сохранённого отчёта")).toBeVisible();
    expect(screen.getByText(/Лаборатория №1/)).toBeVisible();
    expect(screen.getByText(/2026, I полугодие/)).toBeVisible();
    expect(screen.getByText("Предварительная форма")).toBeVisible();
    expect(screen.getByText(/Источников в снимке: 1/)).toBeVisible();
  });

  it("an official=true snapshot does NOT show the preliminary marking", async () => {
    server.use(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          full_name: "Тестовый пользователь",
          login: "tester",
          email: "tester@example.test",
          position: null,
          role: "HEAD",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
        }),
      ),
      http.get(`*/api/v1/reports/5vet/${REPORT}`, () =>
        HttpResponse.json({
          ...(snapshotView() as Record<string, unknown>),
          payload: { ...payload, official: true },
        }),
      ),
    );
    renderView();
    expect(await screen.findByText("Матрица сохранённого отчёта")).toBeVisible();
    expect(screen.queryByText("Предварительная форма")).toBeNull();
  });

  it("a report deleted elsewhere answers 404 → honest not-found", async () => {
    server.use(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          full_name: "Тестовый пользователь",
          login: "tester",
          email: "tester@example.test",
          position: null,
          role: "HEAD",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
        }),
      ),
      http.get(`*/api/v1/reports/5vet/${REPORT}`, () =>
        HttpResponse.json(
          { code: "NOT_FOUND", title: "Not found", status: 404, detail: "Сохранённый отчёт не найден." },
          { status: 404 },
        ),
      ),
    );
    renderView();
    expect(
      await screen.findByText("Отчёт не найден: возможно, он был удалён другим пользователем."),
    ).toBeVisible();
  });

  it("exports target the snapshot-only files of the exact saved report", async () => {
    let pdf = "";
    server.use(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          full_name: "Тестовый пользователь",
          login: "tester",
          email: "tester@example.test",
          position: null,
          role: "HEAD",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
        }),
      ),
      http.get(`*/api/v1/reports/5vet/${REPORT}`, () => HttpResponse.json(snapshotView())),
      http.get(`*/api/v1/reports/5vet/${REPORT}/export.pdf`, ({ request }) => {
        pdf = request.url;
        return HttpResponse.json(
          { code: "RENDERER_UNAVAILABLE", status: 503, detail: "Рендер недоступен." },
          { status: 503 },
        );
      }),
    );
    renderView();
    await screen.findByText("Матрица сохранённого отчёта");
    const user = (await import("@testing-library/user-event")).default.setup();
    await user.click(screen.getByRole("button", { name: "Скачать PDF" }));
    expect(await screen.findByText(/Файл не сформирован/)).toBeVisible();
    expect(pdf).toContain(`/api/v1/reports/5vet/${REPORT}/export.pdf`);
  });
});
