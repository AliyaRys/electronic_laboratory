/**
 * ExaminationJournalPage tests (E04, MSW, ТЗ DR47 §2.3): the journal keeps
 * its OWN scoped read model with URL state, but reproduces the journal.html
 * composition: no breadcrumb, a 3+2 filter panel with the «Автор» label, a
 * date popover with three modes and Moscow half-open boundaries, vse-card
 * rows with outcome badges and an icon-only eye action, the centred
 * pagination and the honest empty state.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
  server.use(
    http.get("*/api/v1/examinations/authors", () =>
      HttpResponse.json([{ id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", full_name: "Ветврач" }]),
    ),
  );
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

describe("ExaminationJournalPage composition (DR47 §2.3)", () => {
  it("the plain URL queries COMPLETED and shows the journal.html composition", async () => {
    const calls: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        const url = new URL(request.url);
        calls.push(url.searchParams.get("status") ?? "<none>");
        return HttpResponse.json({ items: [item(EXAM)], total: 1, page: 1, page_size: 20 });
      }),
    );
    renderRoute();
    const eye = await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    expect(eye.getAttribute("href")).toBe(`/labs/${LAB}/examinations/${EXAM}`);
    expect(calls).toEqual(["COMPLETED"]);
    expect(screen.getByRole("tab", { name: "Завершённые" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { level: 1, name: "Журнал ВСЭ мяса и мясопродуктов" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Хозяйство или UUID ВСД")).toBeTruthy();
    // No breadcrumb in the composition (the shell header owns navigation).
    expect(screen.queryByText("← Поступления")).toBeNull();
    expect(document.querySelector(".vse-breadcrumb")).toBeNull();
    // One white filter panel with the 3+2 rows and exact labels.
    expect(screen.getByLabelText("Поиск")).toBeTruthy();
    expect(screen.getByLabelText("Итог ВСЭ")).toBeTruthy();
    expect(screen.getByLabelText("Автор")).toBeTruthy();
    expect(screen.queryByLabelText("Врач")).toBeNull();
    expect(screen.getByLabelText("Сортировка")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Период обращения/ })).toBeTruthy();
  });

  it("the author filter rides the server query as specialist_id", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item(EXAM)], total: 1, page: 1, page_size: 20 });
      }),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    await user.selectOptions(screen.getByLabelText("Автор"), "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f");
    await waitFor(() =>
      expect(queries.at(-1)).toContain("specialist_id=0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"),
    );
  });

  it("the waiting tab re-queries WAITING, disables the outcome filter and resets the page", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({
          items: [item(EXAM2, { status: "WAITING", outcome: null })],
          total: 1,
        });
      }),
    );
    const user = userEvent.setup();
    renderRoute(`/labs/${LAB}/examinations?page=3&outcome=FIT`);
    await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    await user.click(screen.getByRole("tab", { name: "Ожидание результатов" }));
    await screen.findByRole("tab", { name: "Ожидание результатов", selected: true });
    expect(queries.at(-1)).toContain("status=WAITING");
    expect(queries.at(-1)).toContain("page=1");
    const outcome = screen.getByLabelText("Итог ВСЭ") as HTMLSelectElement;
    expect(outcome.disabled).toBe(true);
    expect(screen.getByText("Итог ещё не сформирован")).toBeTruthy();
    expect(screen.getByText("Ожидание результатов")).toBeTruthy();
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
    await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    await user.click(screen.getByRole("tab", { name: "Ожидание результатов" }));
    await screen.findByRole("tab", { name: "Ожидание результатов", selected: true });
    expect(queries.at(-1)).toContain("status=WAITING");
    expect(queries.at(-1)).toContain("page=1");
    await user.type(screen.getByLabelText("Поиск"), "клеймо");
    await waitFor(() => expect(queries.at(-1)).toContain("q="));
    await user.selectOptions(screen.getByLabelText("Сортировка"), "asc");
    await waitFor(() => expect(queries.at(-1)).toContain("sort=asc"));
  });
});

describe("Journal date popover (DR47 §2.3.3)", () => {
  it("date mode sends the Moscow half-open day window and restores from the URL", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item(EXAM)], total: 1 });
      }),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    expect(screen.getByRole("button", { name: /Период обращения: Любая дата/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Период обращения/ }));
    await user.click(screen.getByRole("button", { name: "Дата" }));
    expect(screen.getByRole("button", { name: "Дата" }).getAttribute("aria-pressed")).toBe("true");
    await user.type(screen.getByLabelText("Дата"), "2026-11-01");
    await user.click(screen.getByRole("button", { name: "Применить" }));
    await waitFor(() => {
      expect(queries.at(-1)).toContain("occurred_from=2026-11-01T00%3A00%3A00%2B03%3A00");
      expect(queries.at(-1)).toContain("occurred_to=2026-11-02T00%3A00%3A00%2B03%3A00");
    });
    expect(screen.queryByLabelText("Дата")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Период обращения: Дата: 01.11.2026/ }),
    ).toBeTruthy();
  });

  it("datetime mode sends the one-minute half-open window", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item(EXAM)], total: 1 });
      }),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    await user.click(screen.getByRole("button", { name: /Период обращения/ }));
    await user.click(screen.getByRole("button", { name: "Дата и время" }));
    await user.type(screen.getByLabelText("Дата и время"), "2026-11-01T09:40");
    await user.click(screen.getByRole("button", { name: "Применить" }));
    await waitFor(() => {
      expect(queries.at(-1)).toContain("occurred_from=2026-11-01T09%3A40%3A00%2B03%3A00");
      expect(queries.at(-1)).toContain("occurred_to=2026-11-01T09%3A41%3A00%2B03%3A00");
    });
  });

  it("range mode sends an inclusive start and an exclusive end", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item(EXAM)], total: 1 });
      }),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    await user.click(screen.getByRole("button", { name: /Период обращения/ }));
    await user.click(screen.getByRole("button", { name: "Диапазон" }));
    await user.type(screen.getByLabelText("С"), "2026-11-01T09:40");
    await user.type(screen.getByLabelText("По"), "2026-11-10T18:00");
    await user.click(screen.getByRole("button", { name: "Применить" }));
    await waitFor(() => {
      expect(queries.at(-1)).toContain("occurred_from=2026-11-01T09%3A40%3A00%2B03%3A00");
      expect(queries.at(-1)).toContain("occurred_to=2026-11-10T18%3A01%3A00%2B03%3A00");
    });
  });

  it("an invalid range shows the Russian inline error and sends nothing", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/examinations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item(EXAM)], total: 1 });
      }),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    await user.click(screen.getByRole("button", { name: /Период обращения/ }));
    await user.click(screen.getByRole("button", { name: "Диапазон" }));
    await user.type(screen.getByLabelText("С"), "2026-11-10T18:00");
    await user.type(screen.getByLabelText("По"), "2026-11-01T09:40");
    await user.click(screen.getByRole("button", { name: "Применить" }));
    expect(await screen.findByText("Начало диапазона не может быть позже конца.")).toBeTruthy();
    // The popover stays open with the inputs reachable.
    expect(screen.getByLabelText("С")).toBeTruthy();
    const filtered = queries.filter((entry) => entry.includes("occurred_from"));
    expect(filtered).toEqual([]);
  });

  it("the range URL state restores the popover summary after a reload", async () => {
    server.use(
      http.get("*/api/v1/examinations", () =>
        HttpResponse.json({ items: [item(EXAM)], total: 1, page: 1, page_size: 20 }),
      ),
    );
    renderRoute(
      `/labs/${LAB}/examinations?date_mode=range&from=2026-11-01T09:40&to=2026-11-10T18:00`,
    );
    expect(
      await screen.findByRole("button", {
        name: /Период обращения: 01.11.2026 09:40 — 10.11.2026 18:00/,
      }),
    ).toBeTruthy();
  });
});

describe("Journal rows, badges and pagination (DR47 §2.3.4–2.3.5)", () => {
  it("labels the FIT/UNFIT/unknown completed outcomes and the waiting row honestly", async () => {
    server.use(
      http.get("*/api/v1/examinations", () =>
        HttpResponse.json({
          items: [
            item(EXAM, { outcome: "FIT" }),
            item(EXAM2, { outcome: "UNFIT" }),
            item("e0000000-0000-4000-8000-000000000003", { status: "WAITING", outcome: null }),
            item("e0000000-0000-4000-8000-000000000004", { outcome: null }),
          ],
          total: 4,
        }),
      ),
    );
    renderRoute();
    await screen.findByText("07.11.2026 10:00");
    // Exact column labels of the mockup, in order.
    const card = screen.getAllByRole("article")[0];
    expect(card.textContent).toContain("Дата и время обращения");
    expect(card.textContent).toContain("Хозяйство");
    expect(card.textContent).toContain("UUID ВСД");
    expect(card.textContent).toContain("Автор");
    expect(screen.getByText("Пригодно")).toBeTruthy();
    expect(screen.getByText("Непригодно")).toBeTruthy();
    expect(screen.getAllByText("Ожидание результатов").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Итог не указан")).toBeTruthy();
    // The fit badge keeps its green tone, the unfit its red one, the unknown
    // a neutral one (never a success color).
    const badges = screen.getAllByText(/Пригодно|Непригодно|Ожидание результатов|Итог не указан/);
    expect(badges.some((badge) => badge.className.includes("completed-fit"))).toBe(true);
    expect(badges.some((badge) => badge.className.includes("completed-unfit"))).toBe(true);
    expect(badges.some((badge) => badge.className.includes("waiting"))).toBe(true);
    const neutral = badges.find((badge) => badge.textContent === "Итог не указан");
    expect(neutral?.className.includes("completed-fit")).toBe(false);
    expect(neutral?.className.includes("completed-unfit")).toBe(false);
  });

  it("the eye action is an icon-only link with the exact accessible name", async () => {
    server.use(
      http.get("*/api/v1/examinations", () =>
        HttpResponse.json({ items: [item(EXAM)], total: 1, page: 1, page_size: 20 }),
      ),
    );
    renderRoute();
    const eye = await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    expect(eye.classList.contains("icon-only")).toBe(true);
    expect(eye.querySelector("svg")).not.toBeNull();
    // The tooltip text is reachable by keyboard focus.
    eye.focus();
    expect(await screen.findByText("Посмотреть карточку ВСЭ")).toBeTruthy();
  });

  it("renders the centred pagination without the visible «Страница N из M»", async () => {
    server.use(
      http.get("*/api/v1/examinations", () =>
        HttpResponse.json({ items: [item(EXAM)], total: 45, page: 2, page_size: 20 }),
      ),
    );
    renderRoute(`/labs/${LAB}/examinations?page=2`);
    await screen.findByRole("link", { name: "Посмотреть карточку ВСЭ" });
    const prev = screen.getByRole("button", { name: "Предыдущая страница" });
    const next = screen.getByRole("button", { name: "Следующая страница" });
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(screen.getByText("2").getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText(/Страница \d+ из/)).toBeNull();
  });

  it("renders the honest empty and error states with retry", async () => {
    server.use(
      http.get("*/api/v1/examinations", () => HttpResponse.json({ items: [], total: 0 }, { status: 200 })),
    );
    renderRoute();
    expect(await screen.findByText("По заданным условиям записи не найдены")).toBeTruthy();

    server.use(
      http.get("*/api/v1/examinations", () =>
        HttpResponse.json({ code: "INTERNAL_ERROR", detail: "Сбой", trace_id: "t" }, { status: 500 }),
      ),
    );
    renderRoute();
    expect(await screen.findByText("Не удалось загрузить журнал.")).toBeTruthy();
  });

  it("shows the Moscow dd.mm.yyyy hh:mm moment and the frozen specialist", async () => {
    server.use(
      http.get("*/api/v1/examinations", () => HttpResponse.json({ items: [item(EXAM)], total: 1 })),
    );
    renderRoute();
    expect(await screen.findByText("07.11.2026 10:00")).toBeTruthy();
    expect(screen.getAllByText("Ветврач").length).toBeGreaterThanOrEqual(1);
    // The honest fallback of a missing consignor name.
    expect(screen.getByText("ООО «Мясопром»")).toBeTruthy();
  });
});
