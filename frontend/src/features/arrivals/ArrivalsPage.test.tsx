/**
 * ArrivalsPage tests (A01/V02 + DR3, MSW): URL-context queues, real stage
 * counters, per-stage filters without a «Найти» button, the hide command
 * path (If-Match + Idempotency-Key) through the explicit icon button, and
 * the VET/HEAD-only durable sync job.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ArrivalsPage } from "../../pages/ArrivalsPage";

const server = setupServer(
  http.get("*/api/v1/me", () =>
    HttpResponse.json({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      full_name: "Ветеринарный врач",
      login: "vet",
      email: "vet@example.test",
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

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const view = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
      issuedOn: "2026-08-12T08:40:00",
      transportNumber: "А245КМ 116",
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
  documentary: { mass_kg: "486.5", quantity: "3", unit_id: "u" },
  confirmation: null,
  queue: "EXPECTED",
  examination_id: null,
  revision: 1,
  source_presence: "CURRENT_CONFIRMED",
};

function renderPage(
  initial = "/labs/" + LAB + "/arrivals",
  arrivalsHandler?: (request: Request, items: unknown[]) => Response,
): {
  captured: { url: string; headers: Headers }[];
  deletes: Headers[];
  setItems: (items: unknown[]) => void;
} {
  const captured: { url: string; headers: Headers }[] = [];
  const deletes: Headers[] = [];
  let items: unknown[] = [view];
  server.use(
    http.get("*/api/v1/arrivals", ({ request }) => {
      if (arrivalsHandler !== undefined) return arrivalsHandler(request, items);
      captured.push({ url: new URL(request.url).search, headers: request.headers });
      return HttpResponse.json({ items, total: items.length, page: 1, page_size: 20 });
    }),
    http.delete(`*/api/v1/arrivals/${PARTY}`, ({ request }) => {
      deletes.push(request.headers);
      items = [];
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/labs/:labId/arrivals" element={<ArrivalsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { captured, deletes, setItems: (next: unknown[]) => (items = next) };
}

describe("ArrivalsPage", () => {
  it("shows the three mockup stage tabs and keeps the queue in the URL", async () => {
    const { captured } = renderPage(`/labs/${LAB}/arrivals`);
    await screen.findByText("говядина");
    expect(captured[0]?.url).toContain("queue=EXPECTED");
    expect(screen.getByRole("button", { name: /Ожидаемые/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /В работе/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Завершенные/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ожидается/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Завершенные/ }));
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("queue=ACCEPTED");
    });
  });

  it("renders the real stage totals as tab counters, not page rows", async () => {
    const seen: string[] = [];
    renderPage(`/labs/${LAB}/arrivals`, (request, items) => {
      const url = new URL(request.url);
      seen.push(url.search);
      const queue = url.searchParams.get("queue") ?? "EXPECTED";
      return HttpResponse.json({
        items: queue === "EXPECTED" ? items : [],
        total: queue === "EXPECTED" ? items.length : 137,
        page: 1,
        page_size: 20,
      });
    });
    await screen.findByText("говядина");
    await waitFor(
      () => {
        expect(seen.some((entry) => entry.includes("queue=WORK"))).toBe(true);
      },
      { timeout: 3000 },
    );
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /В работе/ }).textContent).toContain("137");
      },
      { timeout: 3000 },
    );
  });

  it("per-stage filters without a «Найти» button; Enter applies and keeps q in the URL", async () => {
    const { captured } = renderPage();
    await screen.findByText("говядина");
    expect(screen.queryByRole("button", { name: "Найти" })).toBeNull();
    await userEvent.type(screen.getByLabelText("Поиск"), "говя{Enter}");
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("q=");
      expect(captured.at(-1)?.url).toContain("page=1");
    });
  });

  it("the result filter exists only on «Завершенные» (server-supported)", async () => {
    renderPage(`/labs/${LAB}/arrivals?queue=accepted`);
    await screen.findByText("говядина");
    expect(screen.getByLabelText("Результат")).toBeTruthy();
    // Real enum values keep their honest labels.
    for (const option of ["Все результаты", "Ожидание", "Возврат", "Завершено"]) {
      expect(screen.getByRole("option", { name: option })).toBeTruthy();
    }
  });

  it("the accepted stage has its own column set with Статус ВСД", async () => {
    renderPage(`/labs/${LAB}/arrivals?queue=accepted`);
    await screen.findByText("говядина");
    expect(screen.getByRole("columnheader", { name: "Статус ВСД" })).toBeTruthy();
    expect(screen.getByText("Выбрать столбцы")).toBeTruthy();
  });

  it("the EXPECTED stage has distinct hide and reconciliation icon actions", async () => {
    const { deletes } = renderPage();
    await screen.findByText("говядина");
    expect(screen.getByRole("button", { name: "Скрыть поступление из очереди" })).toBeTruthy();
    const action = screen.getByRole("link", { name: "Перейти к сверке данных" });
    action.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(action);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deletes.length).toBe(0);
  });

  it("hides an expected arrival with If-Match and an Idempotency-Key", async () => {
    const { deletes } = renderPage();
    await screen.findByText("говядина");
    await userEvent.click(screen.getByRole("button", { name: "Скрыть поступление из очереди" }));
    await userEvent.click(screen.getByRole("button", { name: "Скрыть" }));
    await waitFor(() => {
      expect(deletes.length).toBe(1);
      expect(deletes[0]?.get("if-match")).toBe('"1"');
      expect(deletes[0]?.get("idempotency-key")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByText("говядина")).toBeNull();
    });
  });

  it("after hiding the last row of page 2, the page moves back to an existing page (11)", async () => {
    // Page 2 holds exactly one row (total 21, page_size 20): hiding it makes
    // page 2 empty, so the page corrects to the previous existing page.
    const { captured, deletes } = renderPage(
      `/labs/${LAB}/arrivals?queue=expected&page=2`,
      (request, items) => {
        captured.push({ url: new URL(request.url).search, headers: request.headers });
        const pageNumber = Number(new URL(request.url).searchParams.get("page") ?? "1");
        return HttpResponse.json({
          items: pageNumber === 2 ? items : [],
          total: 21,
          page: pageNumber,
          page_size: 20,
        });
      },
    );
    await screen.findByText("говядина");
    await userEvent.click(screen.getByRole("button", { name: "Скрыть поступление из очереди" }));
    await userEvent.click(screen.getByRole("button", { name: "Скрыть" }));
    await waitFor(() => {
      expect(deletes.length).toBe(1);
    });
    // The next read goes to the corrected page 1 (no empty «page=2» request).
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("page=1");
      expect(captured.at(-1)?.url).not.toContain("page=2");
    });
  });

  it("the chosen result stays in the URL on the accepted stage (9)", async () => {
    const { captured } = renderPage(`/labs/${LAB}/arrivals?queue=accepted`);
    await screen.findByText("говядина");
    expect(captured.at(-1)?.url).not.toContain("result=");
    await userEvent.selectOptions(screen.getByLabelText("Результат"), "RETURNED");
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("result=returned");
    });
  });

  it("changing the queue resets the page to 1", async () => {
    const { captured } = renderPage(`/labs/${LAB}/arrivals?queue=expected&page=3`);
    await screen.findByText("говядина");
    await userEvent.click(screen.getByRole("button", { name: /В работе/ }));
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("queue=WORK");
      expect(captured.at(-1)?.url).not.toContain("page=3");
    });
  });

  it("shows the page-level ACCESS_DENIED state", async () => {
    renderPage(`/labs/${LAB}/arrivals`, () =>
      HttpResponse.json({ code: "ACCESS_DENIED", detail: "" }, { status: 403 }),
    );
    await screen.findByText("Нет доступа к этому разделу.");
    expect(screen.queryByText("говядина")).toBeNull();
  });

  it("keeps the update button VET/HEAD-only and runs the durable sync job", async () => {
    const posts: Headers[] = [];
    let polls = 0;
    server.use(
      http.post("*/api/v1/arrivals/sync", ({ request }) => {
        posts.push(request.headers);
        return HttpResponse.json({
          operation_id: "aaaaaaaa-0000-4000-8000-000000000001",
          state: "PENDING",
          status_url: `/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000001`,
        });
      }),
      http.get("*/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000001", () => {
        polls += 1;
        return HttpResponse.json({
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          kind: "vetis.sync",
          state: polls >= 2 ? "SUCCESS" : "RUNNING",
          updated_at: "2026-11-09T10:00:00Z",
        });
      }),
    );
    renderPage();
    await screen.findByText("говядина");
    const update = screen.getByRole("button", { name: "Обновить" });
    expect(update.hasAttribute("disabled")).toBe(false);
    await userEvent.click(update);
    expect(posts.length).toBe(1);
    await waitFor(
      () => {
        expect(screen.getByText(/Поступления обновлены из ВетИС/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it("an ANALYST cannot run the sync and sees no permanent hint row", async () => {
    server.use(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          full_name: "Аналитик",
          login: "analyst",
          email: "analyst@example.test",
          position: null,
          role: "ANALYST",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
          source_presence: "CURRENT_CONFIRMED",
        }),
      ),
    );
    renderPage();
    await screen.findByText("говядина");
    expect(screen.queryByRole("button", { name: "Обновить" })).toBeNull();
    expect(screen.queryByText(/Обновление поступлений из ВетИС выполняется автоматически/)).toBeNull();
  });

  it("shows the honest failure when the sync job fails", async () => {
    server.use(
      http.post("*/api/v1/arrivals/sync", () =>
        HttpResponse.json({
          operation_id: "aaaaaaaa-0000-4000-8000-000000000002",
          state: "PENDING",
          status_url: `/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000002`,
        }),
      ),
      http.get("*/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000002", () =>
        HttpResponse.json({
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          kind: "vetis.sync",
          state: "FAILED",
          problem: "INTEGRATION_NOT_CONFIGURED",
          updated_at: "2026-11-09T10:00:00Z",
        }),
      ),
    );
    renderPage();
    await screen.findByText("говядина");
    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(
      () => {
        expect(screen.getByText(/Обновление из ВетИС недоступно: интеграция не настроена/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
    // The honest problem stays visible; the refresh button never shows success.
    expect(screen.queryByText(/Поступления обновлены/)).toBeNull();
  });

  it("shows the honest network error with a retry", async () => {
    renderPage(`/labs/${LAB}/arrivals`, () =>
      HttpResponse.json({ code: "NETWORK", detail: "Сеть недоступна." }, { status: 500 }),
    );
    await screen.findByText(/Не удалось загрузить поступления/);
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });

  // --- DR7 §10.3: ALL matching incoming VSDs are displayed ---------------------

  it("shows two rows when the response carries two matching items", async () => {
    const second = {
      ...view,
      party_id: "9c1b2d3e-2222-4222-8333-444444444444",
      external: {
        ...view.external,
        evsd_uuid: "2f0e6d2a-1111-4222-8333-444444444444",
        fields: {
          ...view.external.fields,
          documentUuid: "3f0e6d2a-1111-4222-8333-444444444444",
        },
      },
      classification: {
        ...view.classification,
        product: { ...view.classification.product, name: "свинина" },
      },
    };
    renderPage(`/labs/${LAB}/arrivals`, (_request, items) => {
      void items;
      return HttpResponse.json({ items: [view, second], total: 2, page: 1, page_size: 20 });
    });
    await screen.findByText("говядина");
    await screen.findByText("свинина");
    expect(screen.getByText("говядина")).toBeTruthy();
    expect(screen.getByText("свинина")).toBeTruthy();
  });

  it("paginates 21 records: 20 on page 1 and the rest on page 2", async () => {
    const { captured } = renderPage(`/labs/${LAB}/arrivals`, (request) => {
      const pageNumber = Number(new URL(request.url).searchParams.get("page") ?? "1");
      captured.push({ url: new URL(request.url).search, headers: request.headers });
      const first = Array.from({ length: 20 }, (_unused, index) => ({
        ...view,
        party_id: `9c1b2d3e-0000-4000-8000-${String(index).padStart(12, "0")}`,
      }));
      const secondItem = {
        ...view,
        party_id: "9c1b2d3e-0000-4000-8000-999999999999",
        classification: {
          ...view.classification,
          product: { ...view.classification.product, name: "свинина" },
        },
      };
      return HttpResponse.json({
        items: pageNumber === 1 ? first : [secondItem],
        total: 21,
        page: pageNumber,
        page_size: 20,
      });
    });
    await screen.findAllByText("говядина");
    expect(screen.getAllByText("говядина").length).toBe(20);
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("page=2");
    });
    await screen.findByText("свинина");
  });

  it("after a successful sync the table AND the stage counters are re-read directly", async () => {
    const reads: string[] = [];
    let polls = 0;
    server.use(
      http.post("*/api/v1/arrivals/sync", () =>
        HttpResponse.json({
          operation_id: "aaaaaaaa-0000-4000-8000-000000000003",
          state: "PENDING",
          status_url: "/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000003",
        }),
      ),
      http.get("*/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000003", () => {
        polls += 1;
        return HttpResponse.json({
          id: "aaaaaaaa-0000-4000-8000-000000000003",
          kind: "vetis.sync",
          state: polls >= 2 ? "SUCCESS" : "RUNNING",
          updated_at: "2026-11-11T10:00:00Z",
          pages_done: 1,
          imported: 2,
        });
      }),
    );
    renderPage(`/labs/${LAB}/arrivals`, (request, items) => {
      reads.push(new URL(request.url).searchParams.get("queue") ?? "");
      return HttpResponse.json({ items, total: items.length, page: 1, page_size: 20 });
    });
    await screen.findByText("говядина");
    const initialReads = reads.length;
    expect(initialReads).toBeGreaterThanOrEqual(4);
    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(
      () => {
        expect(screen.getByText(/Поступления обновлены из ВетИС/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
    // Table + three stage counters are refetched after the terminal state.
    await waitFor(() => {
      expect(reads.length).toBeGreaterThanOrEqual(initialReads + 4);
    });
  });

  it("a failed sync shows the honest INTEGRATION_NOT_CONFIGURED message, never an empty result", async () => {
    server.use(
      http.post("*/api/v1/arrivals/sync", () =>
        HttpResponse.json({
          operation_id: "aaaaaaaa-0000-4000-8000-000000000004",
          state: "PENDING",
          status_url: "/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000004",
        }),
      ),
      http.get("*/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000004", () =>
        HttpResponse.json({
          id: "aaaaaaaa-0000-4000-8000-000000000004",
          kind: "vetis.sync",
          state: "FAILED",
          problem: "INTEGRATION_NOT_CONFIGURED",
          updated_at: "2026-11-11T10:00:00Z",
          pages_done: 0,
          imported: 0,
        }),
      ),
    );
    renderPage();
    await screen.findByText("говядина");
    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(
      () => {
        expect(screen.getByText(/Обновление из ВетИС недоступно: интеграция не настроена/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
    expect(screen.queryByText(/Поступления обновлены/)).toBeNull();
    expect(screen.queryByText(/эВСД не найдены/)).toBeNull();
    expect(screen.getByText("говядина")).toBeTruthy();
  });

  // --- ТЗ DR9 §7: the honest итог counters; §6: the stale EXPECTED gate --------

  it("after a successful full pass the итог shows received/observed/imported/excluded", async () => {
    server.use(
      http.post("*/api/v1/arrivals/sync", () =>
        HttpResponse.json({
          operation_id: "aaaaaaaa-0000-4000-8000-000000000005",
          state: "PENDING",
          status_url: "/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000005",
        }),
      ),
      http.get("*/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000005", () =>
        HttpResponse.json({
          id: "aaaaaaaa-0000-4000-8000-000000000005",
          kind: "vetis.sync",
          state: "SUCCESS",
          updated_at: "2026-11-12T10:00:00Z",
          pages_done: 2,
          imported: 3,
          diagnostics: {
            external_total: 5,
            observed_uuids: 4,
            kept: 3,
            new_documents: 1,
            updated_documents: 2,
            marked_not_current: 1,
            pages: 2,
          },
        }),
      ),
    );
    renderPage();
    await screen.findByText("говядина");
    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(
      () => {
        expect(screen.getByText(/Получено документов: 5/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("Наблюдено во внешнем списке: 4");
    expect(status).toContain("Импортировано: 3");
    expect(status).toContain("Исключено из активной очереди: 1");
  });

  it("a failed pass never words the error as «эВСД не найдены» and keeps rows", async () => {
    server.use(
      http.post("*/api/v1/arrivals/sync", () =>
        HttpResponse.json({
          operation_id: "aaaaaaaa-0000-4000-8000-000000000006",
          state: "PENDING",
          status_url: "/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000006",
        }),
      ),
      http.get("*/api/v1/operations/aaaaaaaa-0000-4000-8000-000000000006", () =>
        HttpResponse.json({
          id: "aaaaaaaa-0000-4000-8000-000000000006",
          kind: "vetis.sync",
          state: "FAILED",
          problem: "VETIS_TRANSPORT_ERROR",
          updated_at: "2026-11-12T10:00:00Z",
          pages_done: 1,
          imported: 1,
        }),
      ),
    );
    renderPage();
    await screen.findByText("говядина");
    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(
      () => {
        expect(screen.getByText(/Обновление не выполнено/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
    expect(screen.queryByText(/эВСД не найдены/)).toBeNull();
    expect(screen.getByText("говядина")).toBeTruthy();
  });

  // --- ТЗ DR15 §5/§7: server-side issue-date sort of the EXPECTED queue -------

  it("the EXPECTED queue shows the sort select with the exact mockup labels", async () => {
    renderPage();
    await screen.findByText("говядина");
    expect(screen.getByLabelText("Сортировка")).toBeTruthy();
    for (const option of ["Сначала оформленные раньше", "Сначала оформленные позже"]) {
      expect(screen.getByRole("option", { name: option })).toBeTruthy();
    }
  });

  it("choosing a sort order changes the URL and is sent to the API", async () => {
    const { captured } = renderPage();
    await screen.findByText("говядина");
    await userEvent.selectOptions(screen.getByLabelText("Сортировка"), "asc");
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("sort=asc");
    });
    await userEvent.selectOptions(screen.getByLabelText("Сортировка"), "desc");
    await waitFor(() => {
      expect(captured.at(-1)?.url).not.toContain("sort=asc");
    });
  });

  it("changing the sort resets the page to 1", async () => {
    const { captured } = renderPage(`/labs/${LAB}/arrivals?queue=expected&page=3`);
    await screen.findByText("говядина");
    await userEvent.selectOptions(screen.getByLabelText("Сортировка"), "asc");
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("sort=asc");
      expect(captured.at(-1)?.url).not.toContain("page=3");
    });
  });

  it("renders the rows in SERVER order, never re-sorting the page items", async () => {
    // The server deliberately answers with LATER issued dates first (a desc
    // answer); the table must keep exactly that order.
    const second = {
      ...view,
      party_id: "9c1b2d3e-2222-4222-8333-444444444444",
      external: {
        ...view.external,
        evsd_uuid: "2f0e6d2a-1111-4222-8333-444444444444",
        fields: { ...view.external.fields, issuedOn: "2026-08-10T08:40:00" },
      },
    };
    renderPage(`/labs/${LAB}/arrivals?queue=expected&sort=desc`, (_request, items) => {
      void items;
      return HttpResponse.json({ items: [view, second], total: 2, page: 1, page_size: 20 });
    });
    await screen.findAllByText("говядина");
    const dates = (await screen.findAllByRole("row"))
      .filter((row) => row.querySelector("td"))
      .map((row) => row.querySelector("td")?.textContent ?? "");
    expect(dates).toEqual(["12.08.2026 08:40", "10.08.2026 08:40"]);
  });

  it("the sort select exists only on the EXPECTED stage", async () => {
    renderPage(`/labs/${LAB}/arrivals?queue=work`);
    await screen.findByText("говядина");
    expect(screen.queryByLabelText("Сортировка")).toBeNull();
  });

  it("the sort select is keyboard-focusable and survives a URL with sort=asc", async () => {
    renderPage(`/labs/${LAB}/arrivals?queue=expected&sort=asc`);
    await screen.findByText("говядина");
    const select = screen.getByLabelText("Сортировка") as HTMLSelectElement;
    expect(select.value).toBe("asc");
    select.focus();
    expect(document.activeElement).toBe(select);
  });
});
