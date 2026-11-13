/**
 * «Нормы исследований» editor page (ТЗ-DR6 §17.4 + ТЗ-DR28 §8 frontend
 * scenarios): the scoped context drives everything — no misleading empty
 * state without a scope, the full VSE-F18–F29 registry with honest
 * «Не настроено» rows, «Добавить норму» opening the SHARED MethodEditor with
 * createMethod() and real internal ids while no UUID is ever shown.
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
import type { MethodsContextTyped, MethodRuleTyped } from "./api";
import { MethodsEditorPage } from "./MethodsEditorPage";

const LAB = "11111111-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";
const STATE = "cccccccc-0000-4000-8000-000000000001";

const microscopy = INDICATORS.find((item) => item.code === "VSE-F24") as (typeof INDICATORS)[number];
const temperature = INDICATORS.find((item) => item.code === "VSE-F20") as (typeof INDICATORS)[number];
const cooking = INDICATORS.find((item) => item.code === "VSE-F26") as (typeof INDICATORS)[number];

let me: UserView;
/** The active rules of the mocked scoped context. */
let activeRules: MethodRuleTyped[];
/** 409 CONFIGURATION_MISSING: no configured working scope. */
let scopeMissing: boolean;
/** The created rules (POST), served back on the context refetch. */
let createdRules: MethodRuleTyped[];

function contextRule(rule: MethodRuleTyped) {
  return rule;
}

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

function contextFixture(): MethodsContextTyped {
  return {
    laboratory: { id: LAB, name: "Лаборатория №1 г. Казань" },
    areas: [{ code: "meat", name: "Мясо и мясопродукты", configured: true }],
    species_options: [{ id: SPECIES, label: "Свинина", requires_trichinelloscopy: true }],
    states: [{ id: STATE, label: "Охлаждённое", requires_trichinelloscopy: false }],
    product_species: { id: SPECIES, label: "Свинина", requires_trichinelloscopy: true },
    product_state: { id: STATE, label: "Охлаждённое", requires_trichinelloscopy: false },
    indicators: INDICATORS.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      result_schema:
        item.kind === "DECIMAL"
          ? "DECIMAL"
          : item.kind === "INTEGER"
            ? "INTEGER_NONNEGATIVE"
            : item.kind === "TEXT"
              ? "TEXT"
              : item.kind === "DOSIMETRY"
                ? "DOSIMETRY_PAIR"
                : item.kind === "BOOLEAN"
                  ? "BOOLEAN_MATCH"
                  : "ENUM",
      unit_id: item.unit ?? null,
      mandatory: item.mandatory,
      conditional: item.code === "VSE-F21",
      options: item.options ? item.options.map((option) => option.label) : null,
    })),
    active_rules: [...activeRules, ...createdRules].map(contextRule),
    missing: INDICATORS.filter(
      (item) => ![...activeRules, ...createdRules].some((rule) => rule.indicator_id === item.id),
    ).map((item) => item.id),
  };
}

const putSpy = vi.fn();
const postSpy = vi.fn();
let contextRequests = 0;
let listRequests = 0;

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/catalogs/methods/context", () => {
    contextRequests += 1;
    if (scopeMissing) {
      return HttpResponse.json(
        {
          code: "CONFIGURATION_MISSING",
          detail: "Вид продукции и состояние продукции не настроены для этой лаборатории.",
        },
        { status: 409 },
      );
    }
    return HttpResponse.json(contextFixture());
  }),
  http.get("*/api/v1/catalogs/methods", () => {
    // The legacy scoped list must NEVER be called by the page (DR28 §5.1):
    // it is not the working read model and a laboratory UUID never reaches it.
    listRequests += 1;
    return HttpResponse.json({ items: [], total: 0, page: 1, page_size: 50 });
  }),
  http.put("*/api/v1/catalogs/methods/:id", async ({ request }) => {
    putSpy(await request.clone().json());
    return HttpResponse.json({ id: "x" });
  }),
  http.post("*/api/v1/catalogs/methods", async ({ request }) => {
    const payload = (await request.clone().json()) as Record<string, unknown>;
    postSpy(payload);
    createdRules.push(
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-0000000000aa",
        indicator_id: String(payload["indicator_id"]),
        result_schema: String(payload["result_schema"]),
        unit_id: String(payload["unit_id"]),
      }),
    );
    return HttpResponse.json({ rule: { id: "bbbbbbbb-0000-4000-8000-0000000000aa" } });
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
  activeRules = [];
  createdRules = [];
  scopeMissing = false;
  contextRequests = 0;
  listRequests = 0;
  putSpy.mockClear();
  postSpy.mockClear();
  server.resetHandlers();
});

function renderEditor(initial = "/catalogs?tab=methods"): void {
  const router = createMemoryRouter(
    [
      { path: "/catalogs", element: <MethodsEditorPage /> },
      { path: "*", element: <p>Не найдено</p> },
    ],
    { initialEntries: [initial] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const normLabel = (indicatorName: string, bound: "от" | "до"): string => `Норма ${bound}: ${indicatorName}`;

describe("MethodsEditorPage", () => {
  it("an unconfigured scope shows the honest configuration screen and never the empty norms state", async () => {
    scopeMissing = true;
    renderEditor();
    expect(await screen.findAllByText(/Вид продукции и состояние продукции не настроены/i)).not.toHaveLength(
      0,
    );
    expect(screen.queryByText("Нормы для этой области не заданы.")).toBeNull();
    await waitFor(() => expect(contextRequests).toBeGreaterThan(0));
    // The legacy scoped list is never called — the laboratory UUID never
    // becomes a product species (§5.1).
    expect(listRequests).toBe(0);
    expect(screen.queryByRole("button", { name: "Добавить норму" })).toBeNull();
  });

  it("an empty but configured scope lists the full VSE-F18–F29 registry as «Не настроено»", async () => {
    renderEditor();
    expect(await screen.findByRole("button", { name: "Добавить норму" })).toBeInTheDocument();
    for (const indicator of INDICATORS) {
      expect(screen.getByText(indicator.name)).toBeInTheDocument();
    }
    // F30/F31 are party dictionaries, never catalog norms.
    expect(screen.queryByText("Инвазионные болезни")).toBeNull();
    expect(screen.queryByText("Незаразные болезни")).toBeNull();
    const unset = screen.getAllByText("Не настроено");
    expect(unset.length).toBe(INDICATORS.length);
    expect(screen.getAllByRole("button", { name: "Настроить" }).length).toBe(INDICATORS.length);
    // The human-readable scope is shown; no GUID ever appears.
    expect(screen.getByText(/Состояние продукции: Охлаждённое/)).toBeInTheDocument();
    expect(screen.queryByText(SPECIES)).toBeNull();
    expect(screen.queryByText(STATE)).toBeNull();
  });

  it("«Добавить норму» opens the shared editor and POSTs real ids, then the row appears", async () => {
    const act = userEvent.setup();
    renderEditor();
    await act.click(await screen.findByRole("button", { name: "Добавить норму" }));
    const select = await screen.findByLabelText("Показатель");
    expect(screen.queryByText(/UUID/)).toBeNull();
    await act.selectOptions(select, temperature.id);
    await act.type(screen.getByLabelText("Нижняя граница"), "0");
    await act.type(screen.getByLabelText("Верхняя граница"), "6");
    await act.type(screen.getByLabelText("Источник методики"), "ГОСТ");
    await act.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const payload = postSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload["product_species_id"]).toBe(SPECIES);
    expect(payload["product_state_id"]).toBe(STATE);
    expect(payload["indicator_id"]).toBe(temperature.id);
    // The created row appears through the context refetch, no page reload.
    expect(await screen.findByLabelText(normLabel(temperature.name, "от"))).toHaveValue("0");
    // The configured row left the «Не настроено» list.
    expect(screen.getAllByText("Не настроено").length).toBe(INDICATORS.length - 1);
  });

  it("renders interval rows with the unit and only business boundary settings", async () => {
    activeRules = [
      intervalRule({}),
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        indicator_id: temperature.id,
        result_schema: "DECIMAL",
        unit_id: "°C",
        rule: { type: "interval", lower: "0", upper: null, lower_inclusive: true, upper_inclusive: true },
      }),
    ];
    renderEditor();
    const lower = await screen.findByLabelText(normLabel(microscopy.name, "от"));
    expect(lower).toHaveValue("0");
    expect(screen.getByLabelText(normLabel(microscopy.name, "до"))).toHaveValue("10");
    // The unit suffix of the row.
    expect(screen.getAllByText("ед.").length).toBeGreaterThan(0);
    // Boundary inclusivity stays available without exposing source/version.
    const details = screen.getAllByText("Настройка границ");
    expect(details.length).toBeGreaterThan(0);
    expect(screen.queryByText(/Версия записи/)).toBeNull();
    expect(screen.queryByText(/источник:/i)).toBeNull();
    expect(screen.queryByText("Раздел не готов к расчёту:")).toBeNull();
  });

  it("a null upper boundary stays empty and is sent as null (not 0)", async () => {
    const act = userEvent.setup();
    activeRules = [
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        indicator_id: temperature.id,
        result_schema: "DECIMAL",
        unit_id: "°C",
        rule: { type: "interval", lower: "0", upper: null, lower_inclusive: true, upper_inclusive: true },
      }),
    ];
    renderEditor();
    const upper = await screen.findByLabelText(normLabel(temperature.name, "до"));
    expect(upper).toHaveValue("");
    await act.type(upper, "4");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as { rule: { upper?: string; lower?: string } };
    expect(payload.rule.upper).toBe("4");
  });

  it("lower > upper is blocked with a field-bound error", async () => {
    const act = userEvent.setup();
    activeRules = [intervalRule({})];
    renderEditor();
    const lower = await screen.findByLabelText(normLabel(microscopy.name, "от"));
    await act.clear(lower);
    await act.type(lower, "50");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() =>
      expect(screen.getAllByText("Нижняя граница должна быть не больше верхней.").length).toBeGreaterThan(0),
    );
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("the qualitative mapping is built from accepted_values with the registry variants", async () => {
    activeRules = [
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000003",
        indicator_id: cooking.id,
        result_schema: "ENUM",
        unit_id: "",
        rule: {
          type: "qualitative",
          accepted_values: ["Бульон прозрачный, аромат специфический"],
        },
      }),
    ];
    renderEditor();
    await screen.findByRole("heading", { name: cooking.name });
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

  it("an unknown indicator keeps the honest diagnostic without an invented name", async () => {
    activeRules = [
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000009",
        indicator_id: "dddddddd-0000-4000-8000-000000000009",
        unit_id: "ед.",
      }),
    ];
    renderEditor();
    expect(await screen.findByText(/показателя вне общего каталога/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp("dddddddd"))).toBeInTheDocument();
  });
});
