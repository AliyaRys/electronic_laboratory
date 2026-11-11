/**
 * Role-aware catalog context (ТЗ-DR6 §17.1): the compact allowed-scope
 * selector of ADMIN/ANALYST with human-readable names and URL deep link, the
 * honest blocking HEAD configuration error for 0/2+ laboratories, and no raw
 * UUID ever shown as a name.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createQueryClient } from "../../app/providers";
import type { UserView } from "../../shared/api/me";
import { TariffsEditorPage } from "./TariffsEditorPage";

const LAB = "11111111-2222-4333-8444-555555555555";
const LAB_B = "22222222-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "99999999-9999-4999-8999-999999999999";

let me: UserView;
let contexts: unknown[];

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () => HttpResponse.json(contexts)),
  http.get("*/api/v1/catalogs/tariffs", () =>
    HttpResponse.json({ items: [], total: 0, page: 1, page_size: 50 }),
  ),
  http.get("*/api/v1/catalogs/readiness", () => HttpResponse.json({ missing: [] })),
);

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  me = {
    id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    full_name: "Ольга Заведующая",
    login: "head",
    email: "head@lab.tatar",
    position: null,
    role: "HEAD",
    active: true,
    scopes: [{ laboratory_id: LAB, product_scope_id: SPECIES }],
    capabilities: [],
    revision: 1,
  };
  contexts = [];
  server.resetHandlers();
});

function renderEditor(search: string): void {
  const router = createMemoryRouter(
    [
      { path: "/catalogs", element: <TariffsEditorPage /> },
      { path: "*", element: <p>Не найдено</p> },
    ],
    { initialEntries: [search] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("catalog context (§6)", () => {
  it("ADMIN builds a non-empty selector from /contexts/laboratories when /contexts carries only territories", async () => {
    // The REAL backend shape: ADMIN /contexts rows have laboratory_id null
    // (territories only); the selector options exist ONLY on the purpose-built
    // scoped endpoint. A fabricated /contexts laboratory row would have hidden
    // this defect.
    me = { ...me, role: "ADMIN", scopes: [] };
    contexts = [{ territory_id: "44444444-4444-4333-8444-444444444444", territory_name: "Набережные Челны" }];
    server.use(
      http.get("*/api/v1/contexts/laboratories", () =>
        HttpResponse.json([
          {
            laboratory_id: LAB,
            name: "Лаборатория №1 г. Казань",
            territory_id: "44444444-4444-4333-8444-444444444444",
          },
          {
            laboratory_id: LAB_B,
            name: "Лаборатория №2 с. Азнакаево",
            territory_id: "44444444-4444-4333-8444-444444444444",
          },
        ]),
      ),
    );
    renderEditor(`/catalogs?tab=tariffs&laboratory_id=${LAB_B}`);
    const selector = (await screen.findByLabelText("Лаборатория")) as HTMLSelectElement;
    expect(selector.value).toBe(LAB_B);
    const options = Array.from(selector.options).map((option) => option.textContent);
    expect(options).toContain("Лаборатория №1 г. Казань");
    expect(options).toContain("Лаборатория №2 с. Азнакаево");
    expect(options.join(" ")).not.toMatch(new RegExp(LAB.slice(0, 8)));
  });

  it("an ADMIN selector falls back to the /contexts rows when the laboratory endpoint answers with a problem", async () => {
    // Older backend before the §6.4 endpoint deploy: the scoped endpoint is
    // absent and the /contexts rows still carry the laboratory ids.
    me = { ...me, role: "ADMIN", scopes: [] };
    contexts = [
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ];
    server.use(
      http.get("*/api/v1/contexts/laboratories", () =>
        HttpResponse.json({ code: "NOT_FOUND", detail: "Нет маршрута.", status: 404 }, { status: 404 }),
      ),
    );
    renderEditor("/catalogs?tab=tariffs");
    const selector = await screen.findByLabelText("Лаборатория");
    expect(selector).toBeInTheDocument();
  });

  it("a foreign ANALYST deep link shows no foreign data and keeps the safe pick state", async () => {
    // The endpoint answers with a problem, so the /contexts rows are the
    // fallback source of the allowed set (older backend shape).
    me = { ...me, role: "ANALYST", scopes: [] };
    contexts = [
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ];
    server.use(
      http.get("*/api/v1/contexts/laboratories", () =>
        HttpResponse.json({ code: "NOT_FOUND", detail: "Нет маршрута.", status: 404 }, { status: 404 }),
      ),
    );
    renderEditor(`/catalogs?tab=tariffs&laboratory_id=${FOREIGN}`);
    const selector = (await screen.findByLabelText("Лаборатория")) as HTMLSelectElement;
    expect(selector.value).toBe("");
    expect(screen.getByText("Выберите лабораторию, чтобы открыть справочник.")).toBeInTheDocument();
  });

  it("HEAD with two assigned laboratories gets the honest blocking error", async () => {
    me = {
      ...me,
      role: "HEAD",
      scopes: [
        { laboratory_id: LAB, product_scope_id: SPECIES },
        { laboratory_id: LAB_B, product_scope_id: SPECIES },
      ],
    };
    renderEditor("/catalogs?tab=tariffs");
    expect(
      await screen.findByText(
        "Учётная запись заведующего должна иметь ровно одну назначенную лабораторию. Обратитесь к администратору.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Лаборатория")).toBeNull();
  });
});
