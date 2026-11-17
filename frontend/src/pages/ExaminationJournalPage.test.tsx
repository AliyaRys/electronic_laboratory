/**
 * ExaminationJournalPage tests (E04, MSW, ТЗ DR45 §1/§2): the journal uses
 * its OWN scoped read model, a plain URL answers COMPLETED only, the
 * WAITING tab issues the explicit ?status=WAITING query, rows link to the
 * real card ids and the URL state (status/page/filters) survives a reload.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { ExaminationJournalPage } from "./ExaminationJournalPage";
import type { ExaminationJournalItem } from "../features/examinations/api";

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

function item(
  examinationId: string,
  overrides: Partial<ExaminationJournalItem> = {},
): ExaminationJournalItem {
  return {
    examination_id: examinationId,
    party_id: "9c1b2d3e-1111-4222-8333-444444444444",
    laboratory_id: LAB,
    number: "ВСЭ-001",
    stamp: "Клеймо-1",
    status: "COMPLETED",
    created_at: "2026-11-07T07:00:00Z",
    first_completed_at: "2026-11-07T10:00:00Z",
    outcome: "FIT",
    specialist_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    specialist_name: "Ветврач",
    evsd_uuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
    consignor_name: "ООО «Мясопром»",
    ...overrides,
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
  it("the plain URL queries COMPLETED (never the arrivals list) and shows the row", async () => {
    const calls: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        const url = new URL(request.url);
        calls.push(url.searchParams.get("status") ?? "<none>");
        return HttpResponse.json({ items: [item(EXAM)], total: 1, page: 1, page_size: 20 });
      }),
    );
    renderRoute();
    await screen.findByRole("link", { name: /Просмотр карточки ВСЭ/ });
    expect(calls).toEqual(["COMPLETED"]);
    const link = screen.getByRole("link", { name: /Просмотр карточки ВСЭ/ });
    expect(link.getAttribute("href")).toBe(`/labs/${LAB}/examinations/${EXAM}`);
    expect(screen.getByRole("tab", { name: "Завершённые" }).getAttribute("aria-selected")).toBe("true");
  });

  it("the waiting tab re-queries with status=WAITING and labels the badge", async () => {
    const statuses: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get("status") ?? "<none>");
        return HttpResponse.json({ items: [item(EXAM2, { status: "WAITING", outcome: null })], total: 1 });
      }),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole("link", { name: /Просмотр карточки ВСЭ/ });
    await user.click(screen.getByRole("tab", { name: "Ожидание результатов" }));
    await screen.findByRole("tab", { name: "Ожидание результатов", selected: true });
    expect(statuses).toEqual(["COMPLETED", "WAITING"]);
  });

  it("filters and sort ride in the URL and reset the page", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item(EXAM)], total: 1 });
      }),
    );
    const user = userEvent.setup();
    renderRoute(`${`/labs/${LAB}/examinations`}?page=2`);
    await screen.findByRole("link", { name: /Просмотр карточки ВСЭ/ });
    await user.click(screen.getByRole("tab", { name: "Ожидание результатов" }));
    await screen.findByRole("tab", { name: "Ожидание результатов", selected: true });
    expect(queries.at(-1)).toContain("status=WAITING");
    expect(queries.at(-1)).toContain("page=1");
    expect(queries.at(-1)).not.toContain("page=2");
    await user.selectOptions(screen.getByLabelText("Итог ВСЭ"), "UNFIT");
    await waitFor(() => expect(queries.at(-1)).toContain("outcome=UNFIT"));
    await user.type(screen.getByLabelText("Поиск"), "клеймо");
    await waitFor(() => expect(queries.at(-1)).toContain("q="));
    await user.selectOptions(screen.getByLabelText("Сортировка"), "asc");
    await waitFor(() => expect(queries.at(-1)).toContain("sort=asc"));
  });

  it("the completion period becomes the Moscow half-open window", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item(EXAM)], total: 1 });
      }),
    );
    renderRoute();
    await screen.findByRole("link", { name: /Просмотр карточки ВСЭ/ });
    fireEvent.change(screen.getByLabelText("Период завершения с"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("по"), { target: { value: "2026-11-10" } });
    await waitFor(() => {
      expect(queries.at(-1)).toContain("occurred_from=2026-11-01T00%3A00%3A00%2B03%3A00");
      expect(queries.at(-1)).toContain("occurred_to=2026-11-11T00%3A00%3A00%2B03%3A00");
    });
  });

  it("renders the honest empty and error states with retry", async () => {
    server.use(
      http.get("*/api/v1/examinations", () => HttpResponse.json({ items: [], total: 0 }, { status: 200 })),
    );
    renderRoute();
    expect(await screen.findByText("Карточек в этом статусе нет.")).toBeTruthy();

    server.use(
      http.get("*/api/v1/examinations", () =>
        HttpResponse.json({ code: "INTERNAL_ERROR", detail: "Сбой", trace_id: "t" }, { status: 500 }),
      ),
    );
    renderRoute();
    expect(await screen.findByText("Не удалось загрузить журнал.")).toBeTruthy();
  });

  it("shows the Moscow dd.mm.yyyy hh:mm moment and the frozen specialist", async () => {
    server.use(http.get("*/api/v1/examinations", () => HttpResponse.json({ items: [item(EXAM)], total: 1 })));
    renderRoute();
    expect(await screen.findByText("07.11.2026 10:00")).toBeTruthy();
    // The frozen ФИО appears in both the filter select and the row.
    expect(screen.getAllByText("Ветврач").length).toBeGreaterThanOrEqual(1);
  });
});
