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
      documentNumber: "RU016:260812-005102",
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
        expect(screen.getByText(/Обновление не выполнено/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it("shows the honest network error with a retry", async () => {
    renderPage(`/labs/${LAB}/arrivals`, () =>
      HttpResponse.json({ code: "NETWORK", detail: "Сеть недоступна." }, { status: 500 }),
    );
    await screen.findByText(/Не удалось загрузить поступления/);
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });
});
