/**
 * ArrivalsPage tests (A01, MSW): URL-context filters, the honest disabled
 * update button, and the hide command path with If-Match + Idempotency-Key.
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
      documentNumber: "№ A-001234",
      transportNumber: null,
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
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "u1" },
  confirmation: null,
  queue: "EXPECTED",
  examination_id: null,
  revision: 1,
};

function renderPage(initial = "/labs/" + LAB + "/arrivals"): {
  captured: { url: string; headers: Headers }[];
  setItems: (items: unknown[]) => void;
  deletes: Headers[];
} {
  const captured: { url: string; headers: Headers }[] = [];
  const deletes: Headers[] = [];
  let items: unknown[] = [view];
  server.use(
    http.get("*/api/v1/arrivals", ({ request }) => {
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
  it("keeps the queue and search filters in the URL", async () => {
    const { captured } = renderPage(`/labs/${LAB}/arrivals?queue=work`);
    await screen.findByText("говядина");
    expect(captured[0]?.url).toContain("queue=WORK");
    await userEvent.type(screen.getByLabelText("Поиск (документ, продукция)"), "говя");
    await userEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => {
      expect(captured.at(-1)?.url).toContain("q=");
    });
  });

  it("shows the honest not-configured update state", async () => {
    renderPage();
    await screen.findByText("говядина");
    const update = screen.getByRole("button", { name: "Обновить" });
    expect(update.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Обновление из ВетИС не настроено/)).toBeTruthy();
  });

  it("hides an expected arrival with If-Match and an Idempotency-Key", async () => {
    const { deletes } = renderPage();
    await screen.findByText("говядина");
    await userEvent.click(screen.getByRole("button", { name: "Действия со строкой" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Скрыть из очереди" }));
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
});
