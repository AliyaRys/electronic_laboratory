/**
 * «Нормы исследований» editor page (ТЗ-DR6 §17.4 + ТЗ-DR28 §8):
 * - interval rendering with unit, lower>upper blocked, a null boundary stays
 *   null and is sent as the typed value (never 0);
 * - the qualitative «Проба варки» mapping built from accepted_values with the
 *   variants from the shared INDICATORS registry;
 * - the honest unknown-indicator diagnostic without an invented name;
 * - the DR28 behaviors: no misleading empty state on an unconfigured scope
 *   (§5.1), the full VSE-F18–F29 list with «Не настроено»/«Настроить»
 *   (§6.1), the «Добавить норму» button opening the EXISTING MethodEditor
 *   whose submit calls createMethod() (§6.2), real ids sent but never shown.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../app/providers";
import type { UserView } from "../../shared/api/me";
import { INDICATORS } from "../examinations/indicators";
import type { CatalogIndicatorView, MethodRuleTyped, MethodsContextData } from "./api";
import { MethodsEditorPage } from "./MethodsEditorPage";

const LAB = "11111111-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";
const STATE = "44444444-4444-4444-8444-444444444444";

const microscopy = INDICATORS.find((item) => item.code === "VSE-F24") as (typeof INDICATORS)[number];
const temperature = INDICATORS.find((item) => item.code === "VSE-F20") as (typeof INDICATORS)[number];
const cooking = INDICATORS.find((item) => item.code === "VSE-F26") as (typeof INDICATORS)[number];

let me: UserView;

const contextIndicators: CatalogIndicatorView[] = INDICATORS.map((item) => ({
  id: item.id,
  code: item.code,
  name: item.name,
  result_schema:
    item.kind === "ENUM"
      ? "ENUM"
      : item.kind === "TEXT"
        ? "TEXT"
        : item.kind === "INTEGER"
          ? "INTEGER_NONNEGATIVE"
          : item.kind === "DOSIMETRY"
            ? "DOSIMETRY_PAIR"
            : item.kind === "BOOLEAN"
              ? "BOOLEAN_MATCH"
              : "DECIMAL",
  unit_id: item.unit ?? null,
  mandatory: item.mandatory,
  conditional: item.code === "VSE-F21",
  options: item.options?.map((option) => option.label) ?? null,
}));

function intervalRule(overrides: Partial<MethodRuleTyped>): MethodRuleTyped {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    product_state_id: STATE,
    indicator_id: microscopy.id,
    version: 1,
    result_schema: "INTEGER_NONNEGATIVE",
    unit_id: "ед.",
    rule: { type: "interval", lower: "0", upper: "10", lower_inclusive: true, upper_inclusive: true },
    source: { name: "методика" },
    active: true,
    revision: 2,
    ...overrides,
  };
}

function contextData(overrides: Partial<MethodsContextData> = {}): MethodsContextData {
  return {
    laboratory: { id: LAB, name: "Лаборатория №1 г. Казань" },
    areas: [{ code: "meat", name: "Мясо и мясопродукты", configured: true }],
    species_options: [{ id: SPECIES, label: "Свинина", requires_trichinelloscopy: true }],
    states: [{ id: STATE, label: "Охлаждённая свинина", requires_trichinelloscopy: false }],
    product_species: { id: SPECIES, label: "Свинина", requires_trichinelloscopy: true },
    product_state: { id: STATE, label: "Охлаждённая свинина", requires_trichinelloscopy: false },
    indicators: contextIndicators,
    active_rules: [],
    missing: contextIndicators.map((item) => item.id),
    ...overrides,
  };
}

const putSpy = vi.fn();
let methodsRequests: string[] = [];

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/catalogs/methods/context", ({ request }) => {
    methodsRequests.push(request.url);
    const url = new URL(request.url);
    // R-DR28-1: a laboratory UUID is never sent as a species.
    expect(url.searchParams.get("product_species_id")).not.toBe(LAB);
    return HttpResponse.json(contextData());
  }),
  http.get("*/api/v1/catalogs/methods", () => {
    throw new Error("the editor page must use the context read model, not the raw list");
  }),
  http.get("*/api/v1/catalogs/readiness", () => HttpResponse.json({ missing: [] })),
  http.put("*/api/v1/catalogs/methods/:id", async ({ request }) => {
    putSpy(await request.clone().json());
    return HttpResponse.json({ id: "x" });
  }),
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
    capabilities: ["catalog:create", "catalog:update", "catalog:delete"],
    revision: 1,
  };
  putSpy.mockClear();
  methodsRequests = [];
  server.resetHandlers();
});

function renderEditor(search = "/catalogs?tab=methods"): void {
  const router = createMemoryRouter(
    [
      { path: "/catalogs", element: <MethodsEditorPage /> },
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

const normLabel = (title: string, bound: "от" | "до"): string => `Норма ${bound}: ${title}`;

describe("MethodsEditorPage", () => {
  it("renders interval rows with the unit and only business boundary settings", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(
          contextData({
            active_rules: [
              intervalRule({}),
              intervalRule({
                id: "bbbbbbbb-0000-4000-8000-000000000002",
                indicator_id: temperature.id,
                result_schema: "DECIMAL",
                unit_id: "°C",
                rule: {
                  type: "interval",
                  lower: "0",
                  upper: null,
                  lower_inclusive: true,
                  upper_inclusive: true,
                },
              }),
              intervalRule({
                id: "bbbbbbbb-0000-4000-8000-000000000003",
                indicator_id: cooking.id,
                result_schema: "ENUM",
                unit_id: "",
                rule: { type: "qualitative", accepted_values: ["Бульон прозрачный, аромат специфический"] },
              }),
            ],
            missing: contextIndicators.map((item) => item.id).filter((id) => id !== microscopy.id),
          }),
        ),
      ),
    );
    renderEditor();
    const lower = await screen.findByLabelText(normLabel(`VSE-F24 · ${microscopy.name}`, "от"));
    expect(lower).toHaveValue("0");
    expect(screen.getByLabelText(normLabel(`VSE-F24 · ${microscopy.name}`, "до"))).toHaveValue("10");
    // The unit suffix of the row.
    expect(screen.getAllByText("ед.").length).toBeGreaterThan(0);
    // Boundary inclusivity stays available without exposing source/version.
    const details = screen.getAllByText("Настройка границ");
    expect(details.length).toBeGreaterThan(0);
    expect(screen.queryByText(/Версия записи/)).toBeNull();
    expect(screen.queryByText(/источник:/i)).toBeNull();
    expect(screen.queryByText("Раздел не готов к расчёту:")).toBeNull();
  });

  it("a null upper boundary stays empty and is sent as the typed value (not 0)", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(
          contextData({
            active_rules: [
              intervalRule({
                id: "bbbbbbbb-0000-4000-8000-000000000002",
                indicator_id: temperature.id,
                result_schema: "DECIMAL",
                unit_id: "°C",
                rule: {
                  type: "interval",
                  lower: "0",
                  upper: null,
                  lower_inclusive: true,
                  upper_inclusive: true,
                },
              }),
            ],
          }),
        ),
      ),
    );
    const act = userEvent.setup();
    renderEditor();
    const upper = await screen.findByLabelText(normLabel(`VSE-F20 · ${temperature.name}`, "до"));
    expect(upper).toHaveValue("");
    await act.type(upper, "4");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as { rule: { upper?: string; lower?: string } };
    expect(payload.rule.upper).toBe("4");
  });

  it("lower > upper is blocked with a field-bound error", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(contextData({ active_rules: [intervalRule({})] })),
      ),
    );
    const act = userEvent.setup();
    renderEditor();
    const lower = await screen.findByLabelText(normLabel(`VSE-F24 · ${microscopy.name}`, "от"));
    await act.clear(lower);
    await act.type(lower, "50");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() =>
      expect(screen.getAllByText("Нижняя граница должна быть не больше верхней.").length).toBeGreaterThan(0),
    );
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("the qualitative mapping is built from accepted_values with the registry variants", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(
          contextData({
            active_rules: [
              intervalRule({
                id: "bbbbbbbb-0000-4000-8000-000000000003",
                indicator_id: cooking.id,
                result_schema: "ENUM",
                unit_id: "",
                rule: { type: "qualitative", accepted_values: ["Бульон прозрачный, аромат специфический"] },
              }),
            ],
          }),
        ),
      ),
    );
    renderEditor();
    await screen.findByRole("heading", { name: `VSE-F26 · ${cooking.name}` });
    // Every registry variant of «Проба варки» is present; the accepted one is
    // «Норма», the rest are «Отклонение».
    for (const option of cooking.options ?? []) {
      const input = await screen.findByLabelText(`Вариант результата: ${option.label}`);
      expect(input).toHaveValue(option.label);
    }
    const selects = screen.getAllByLabelText(/Оценка/);
    expect((selects[0] as HTMLSelectElement).value).toBe("norm");
    expect((selects[1] as HTMLSelectElement).value).toBe("deviation");
  });

  it("marking a second variant «Норма» updates accepted_values on save", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(
          contextData({
            active_rules: [
              intervalRule({
                id: "bbbbbbbb-0000-4000-8000-000000000003",
                indicator_id: cooking.id,
                result_schema: "ENUM",
                unit_id: "",
                rule: { type: "qualitative", accepted_values: ["Бульон прозрачный, аромат специфический"] },
              }),
            ],
          }),
        ),
      ),
    );
    const act = userEvent.setup();
    renderEditor();
    const second = (await screen.findAllByLabelText(/Оценка/))[1];
    await act.selectOptions(second, "norm");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as { rule: { accepted_values: string[] } };
    expect(payload.rule.accepted_values).toEqual([
      "Бульон прозрачный, аромат специфический",
      "Бульон мутный",
    ]);
  });

  it("an unknown indicator keeps the honest diagnostic without an invented name", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(
          contextData({
            active_rules: [
              intervalRule({
                id: "bbbbbbbb-0000-4000-8000-000000000009",
                indicator_id: "dddddddd-0000-4000-8000-000000000009",
                unit_id: "ед.",
              }),
            ],
          }),
        ),
      ),
    );
    renderEditor();
    expect(await screen.findByText(/показателя вне общего каталога/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp("dddddddd"))).toBeInTheDocument();
  });

  // --- ТЗ-DR28 §5.1/§8.1: the honest unconfigured scope -------------------------

  it("an unconfigured area shows the configuration screen, never the empty-catalog lie", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(
          contextData({
            areas: [{ code: "meat", name: "Мясо и мясопродукты", configured: false }],
            species_options: [],
            states: [],
            product_species: null,
            product_state: null,
          }),
        ),
      ),
    );
    renderEditor();
    expect(await screen.findByText(/не настроены для этой лаборатории/i)).toBeInTheDocument();
    expect(screen.queryByText("Нормы для этой области не заданы.")).toBeNull();
    expect(methodsRequests.every((url) => !url.includes("product_species_id"))).toBe(true);
  });

  it("a species without any observed product state stays an honest configuration screen", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(
          contextData({
            states: [],
            product_state: null,
          }),
        ),
      ),
    );
    renderEditor();
    expect(
      await screen.findByText(/Состояние продукции для выбранного вида ещё не определено/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Нормы для этой области не заданы.")).toBeNull();
  });

  // --- ТЗ-DR28 §6.1/§8.2: the empty-but-configured page --------------------------

  it("the configured empty page shows the full VSE-F18–F29 list as «Не настроено»", async () => {
    renderEditor();
    for (const indicator of INDICATORS) {
      expect(await screen.findByText(`${indicator.code} · ${indicator.name}`)).toBeInTheDocument();
    }
    const unconfigured = await screen.findAllByText(/Не настроено/);
    expect(unconfigured.length).toBe(INDICATORS.length);
    expect(screen.getAllByRole("button", { name: "Настроить" }).length).toBe(INDICATORS.length);
    // The «Добавить норму» action exists now (§6.2) — the old page had none.
    expect(screen.getByRole("button", { name: "Добавить норму" })).toBeInTheDocument();
    // VSE-F30/F31 are the party dictionaries, never method-rule norms (§4).
    expect(screen.queryByText(/VSE-F30/)).toBeNull();
    expect(screen.queryByText(/VSE-F31/)).toBeNull();
    // The Russian area name is shown; no UUID is visible anywhere.
    expect(screen.getByLabelText("Вид продукции")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Мясо и мясопродукты" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SPECIES);
    expect(document.body.textContent).not.toContain(STATE);
  });

  it("the reader without edit rights sees no create or configure actions", async () => {
    // A VET stays read-only on the catalog (§7 authz matrix).
    me = { ...me, role: "VET", capabilities: [] };
    renderEditor();
    await screen.findByText(`${temperature.code} · ${temperature.name}`);
    expect(screen.queryByRole("button", { name: "Добавить норму" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Настроить" })).toBeNull();
  });

  // --- ТЗ-DR28 §6.2/§8.3/§8.4: create through the EXISTING MethodEditor ----------

  it("«Настроить» opens the MethodEditor create with the indicator pre-picked", async () => {
    let created: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/catalogs/methods", async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            ...intervalRule({
              indicator_id: temperature.id,
              result_schema: "DECIMAL",
              unit_id: "°C",
              rule: { type: "interval", lower: "0", upper: "8" },
            }),
            id: "bbbbbbbb-0000-4000-8000-00000000000a",
          },
          { status: 201 },
        );
      }),
      http.get("*/api/v1/catalogs/methods/context", () =>
        HttpResponse.json(
          contextData(
            created === null
              ? {}
              : {
                  active_rules: [
                    intervalRule({
                      id: "bbbbbbbb-0000-4000-8000-00000000000a",
                      indicator_id: temperature.id,
                      result_schema: "DECIMAL",
                      unit_id: "°C",
                      rule: { type: "interval", lower: "0", upper: "8" },
                    }),
                  ],
                },
          ),
        ),
      ),
    );
    const act = userEvent.setup();
    renderEditor();
    // The temperature row (VSE-F20) is the interval norm being configured.
    const row = await screen.findByText(`VSE-F20 · ${temperature.name}`);
    const rowButton = (row.closest("article") as HTMLElement).querySelector("button");
    await act.click(rowButton as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    // The EXISTING editor form: source is required, the state UUID is never
    // shown, the indicator arrives pre-picked by its Russian name.
    expect(dialog.textContent).toContain("Источник методики");
    expect(dialog.textContent).not.toContain(STATE);
    expect(document.body.textContent).not.toContain(STATE);
    await act.type(screen.getByLabelText("Нижняя граница"), "0");
    await act.type(screen.getByLabelText("Верхняя граница"), "8");
    await act.type(screen.getByLabelText("Источник методики"), "методика");
    await act.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).toMatchObject({
      laboratory_id: LAB,
      product_species_id: SPECIES,
      product_state_id: STATE,
      indicator_id: temperature.id,
      result_schema: "DECIMAL",
    });
    // The new row appears without a page reload (§8.4).
    await waitFor(() =>
      expect(screen.getByLabelText(normLabel(`VSE-F20 · ${temperature.name}`, "до"))).toHaveValue("8"),
    );
  });
});
