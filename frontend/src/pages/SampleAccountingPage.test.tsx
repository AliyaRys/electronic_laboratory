/**
 * SampleAccountingPage tests (S03): the period change re-reads the history
 * and never the balances (API-06: «фильтр не влияет на balance»); the VET
 * gets no 5-ВЕТ report link (own scope only) while HEAD does; the disposal
 * command carries the Idempotency-Key and the basket If-Match.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SampleAccountingPage } from "./SampleAccountingPage";

const server = setupServer(
  http.get("*/api/v1/me", ({ request }) => {
    const role = new URL(request.url).searchParams.get("role") ?? "VET";
    return HttpResponse.json({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      full_name: "Тестовый пользователь",
      login: "tester",
      email: "tester@example.test",
      position: null,
      role,
      active: true,
      scopes: [{ laboratory_id: LAB, product_scope_id: null }],
      capabilities:
        role === "VET" ? ["sample:read"] : ["sample:read", "report:5vet-list", "report:5vet-read"],
      revision: 1,
    });
  }),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SPECIES = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const balance = { product_species_id: SPECIES, mass_kg: "12.6", revision: 1 };
const collection = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  party_id: "9c1b2d3e-1111-4222-8333-444444444444",
  laboratory_id: LAB,
  product_species_id: SPECIES,
  classification_snapshot: { product: { id: SPECIES, name: "говядина" } },
  collected_on: "2026-11-05",
  mass_kg: "12.6",
  collected_by: "00000000-0000-4000-8000-000000000001",
  created_at: "2026-11-05T10:00:00Z",
  disposal_id: null,
  revision: 1,
};
const disposal = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  laboratory_id: LAB,
  product_species_id: SPECIES,
  disposed_on: "2026-11-06",
  mass_kg: "12.6",
  external_vsd_number: "ВСД-001",
  actor_id: "00000000-0000-4000-8000-000000000001",
  recorded_at: "2026-11-06T10:00:00Z",
};

function renderPage(role = "VET"): {
  balanceGets: URL[];
  disposalGets: URL[];
  posts: { headers: Headers; body: unknown }[];
} {
  const balanceGets: URL[] = [];
  const disposalGets: URL[] = [];
  const posts: { headers: Headers; body: unknown }[] = [];
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        full_name: "Тестовый пользователь",
        login: "tester",
        email: "tester@example.test",
        position: null,
        role,
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities:
          role === "VET"
            ? ["sample:read"]
            : role === "ADMIN"
              ? []
              : ["sample:read", "report:5vet-list", "report:5vet-read"],
        revision: 1,
      }),
    ),
    http.get("*/api/v1/samples/balances", ({ request }) => {
      balanceGets.push(new URL(request.url));
      return HttpResponse.json([balance]);
    }),
    http.get("*/api/v1/samples/collections", () =>
      HttpResponse.json({ items: [collection], total: 1, page: 1, page_size: 20 }),
    ),
    http.get("*/api/v1/samples/disposals", ({ request }) => {
      disposalGets.push(new URL(request.url));
      return HttpResponse.json({ items: [disposal], total: 1, page: 1, page_size: 20 });
    }),
    http.post("*/api/v1/samples/disposals", async ({ request }) => {
      posts.push({ headers: request.headers, body: await request.json() });
      return HttpResponse.json(disposal, { status: 201 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/labs/${LAB}/reports/samples`]}>
        <Routes>
          <Route path="/labs/:labId/reports/samples" element={<SampleAccountingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { balanceGets, disposalGets, posts };
}

describe("SampleAccountingPage", () => {
  it("the period change updates the history and never the balance", async () => {
    const { balanceGets, disposalGets } = renderPage();
    await screen.findByText("ВСД-001");
    expect(balanceGets.length).toBe(1);

    await userEvent.type(screen.getByLabelText("С даты"), "2026-11-01");
    await userEvent.type(screen.getByLabelText("По дату"), "2026-11-06");
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));

    await waitFor(() => {
      expect(disposalGets.at(-1)?.searchParams.get("date_from")).toBe("2026-11-01");
      expect(disposalGets.at(-1)?.searchParams.get("date_to")).toBe("2026-11-06");
    });
    // The balances read model never depends on the period filter.
    expect(balanceGets.length).toBe(1);
    expect((await screen.findAllByText("12.6")).length).toBeGreaterThan(0);
  });

  it("only balances and disposals are requested; collections are gone", async () => {
    const collectionsGets: URL[] = [];
    server.use(
      http.get("*/api/v1/samples/collections", ({ request }) => {
        collectionsGets.push(new URL(request.url));
        return HttpResponse.json({ items: [], total: 0, page: 1, page_size: 20 });
      }),
    );
    renderPage();
    await screen.findByText("ВСД-001");
    // DR48 §4.1: the «Доступные отборы» block is not in the DOM, the notes
    // and the «Период истории» heading are gone, and the page makes no
    // collections request.
    expect(screen.queryByText("Доступные отборы")).toBeNull();
    expect(screen.queryByText(/Остаток показывается только для чтения/)).toBeNull();
    expect(screen.queryByText(/История утилизаций не изменяется/)).toBeNull();
    expect(screen.queryByText("Период истории")).toBeNull();
    expect(screen.queryByRole("link", { name: /← Отчёты/ })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(collectionsGets).toHaveLength(0);
  });

  it("a reversed draft period is blocked with an inline message", async () => {
    const { disposalGets } = renderPage();
    await screen.findByText("ВСД-001");
    await userEvent.type(screen.getByLabelText("С даты"), "2026-11-06");
    await userEvent.type(screen.getByLabelText("По дату"), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(screen.getByText("Дата начала не может быть позже даты окончания.")).toBeVisible();
    expect(disposalGets).toHaveLength(1);
  });

  it("a VET gets no 5-ВЕТ report link (own scope only)", async () => {
    renderPage("VET");
    await screen.findByText("ВСД-001");
    expect(screen.queryByRole("link", { name: /5-ВЕТ/ })).toBeNull();
  });

  it("HEAD gets the 5-ВЕТ report link", async () => {
    renderPage("HEAD");
    await screen.findByText("ВСД-001");
    expect(screen.getByRole("link", { name: /5-ВЕТ/ })).toBeTruthy();
  });

  it("the disposal command carries the If-Match of the basket and an Idempotency-Key", async () => {
    const { posts } = renderPage("VET");
    await screen.findAllByText("12.6");
    // DR48 §4.4: ONE direct icon action, no row menu.
    await userEvent.click(screen.getByRole("button", { name: "Утилизировать остаток" }));
    await userEvent.type(await screen.findByLabelText("Номер исходящей эВСД"), "ВСД-001");
    await userEvent.click(screen.getByRole("button", { name: "Утилизировать" }));
    await waitFor(() => {
      expect(posts.length).toBe(1);
      expect(posts[0]?.headers.get("if-match")).toBe('"1"');
      expect(posts[0]?.headers.get("idempotency-key")).toBeTruthy();
      const body = posts[0]?.body as Record<string, unknown>;
      expect(body["externalVsdNumber"]).toBe("ВСД-001");
      expect(body["expectedMassKg"]).toBe("12.6");
    });
  });

  it("ANALYST sees neither the dispose action nor an empty row menu", async () => {
    renderPage("ANALYST");
    await screen.findAllByText("12.6");
    expect(screen.queryByRole("button", { name: "Утилизировать остаток" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Действия со строкой" })).toBeNull();
  });
});

describe("SampleAccountingPage capability guard (DR37)", () => {
  it("a user without sample:read gets the forbidden state and no sample GET", async () => {
    let sampleGets = 0;
    server.use(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          full_name: "Тестовый пользователь",
          login: "tester",
          email: "tester@example.test",
          position: null,
          role: "ADMIN",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
        }),
      ),
      http.get("*/api/v1/samples/balances", () => {
        sampleGets += 1;
        return HttpResponse.json([]);
      }),
    );
    renderPage("ADMIN");
    expect(await screen.findByText("Учёт проб недоступен: у вас нет полномочия чтения проб.")).toBeVisible();
    expect(sampleGets).toBe(0);
  });
});
