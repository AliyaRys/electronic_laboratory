import type { Meta, StoryObj } from "@storybook/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { HttpResponse } from "msw";
import { createQueryClient } from "../../app/providers";
import { applyScenario, catalogWorker } from "../../mocks/catalog-editor-browser";
import {
  RULE_TEMPERATURE,
  methodsScenarioHandlers,
  type MethodsScenario,
} from "../../mocks/catalog-editor-handlers";
import { TariffsEditorPage } from "./TariffsEditorPage";
import { CheckServicesEditorPage } from "./CheckServicesEditorPage";
import { MethodsEditorPage } from "./MethodsEditorPage";

/** One worker for the page stories: fixtures only, no demo mockup values.
 * The story waits for the MSW worker activation so the FIRST boot requests
 * (GET /me, /contexts) are already mocked — no pass-through 404s. */
let workerReady: Promise<unknown> | null = null;
const withWorker = async (): Promise<unknown> => {
  workerReady ??= catalogWorker.start({ quiet: true } as never);
  return workerReady;
};

const PageStory = ({
  route,
  scenario,
}: {
  route: string;
  scenario?: MethodsScenario;
}): React.ReactElement => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void withWorker()
      .then(() => (scenario === undefined ? null : applyScenario(methodsScenarioHandlers(scenario))))
      .then(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [scenario]);
  const router = createMemoryRouter([{ path: "/catalogs", element: <Page route={route} /> }], {
    initialEntries: [route],
  });
  if (!ready) return <div aria-busy="true" />;
  return (
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};

function Page({ route }: { route: string }): React.ReactElement {
  if (route.includes("tariffs")) return <TariffsEditorPage />;
  if (route.includes("check-services")) return <CheckServicesEditorPage />;
  return <MethodsEditorPage />;
}

const meta: Meta<typeof PageStory> = {
  title: "C02/EditorPages",
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof PageStory>;

export const TariffsWide: Story = {
  render: () => <PageStory route="/catalogs?tab=tariffs" />,
};

export const TariffsNarrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <PageStory route="/catalogs?tab=tariffs" />
    </div>
  ),
};

export const PaidServicesWide: Story = {
  render: () => <PageStory route="/catalogs?tab=check-services" />,
};

export const PaidServicesNarrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <PageStory route="/catalogs?tab=check-services" />
    </div>
  ),
};

export const NormsWide: Story = {
  render: () => <PageStory route="/catalogs?tab=methods" />,
};

/** §18: visual parity against directory-norms-edit — the same page at the
 * mockup width; only real read-model data is shown, never demo numbers. */
export const NormsParityDirectoryNormsEdit: Story = {
  render: () => <PageStory route="/catalogs?tab=methods" />,
};

export const NormsTablet: Story = {
  render: () => (
    <div style={{ width: 768 }}>
      <PageStory route="/catalogs?tab=methods" />
    </div>
  ),
};

export const NormsNarrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <PageStory route="/catalogs?tab=methods" />
    </div>
  ),
};

/* --- §18 page states ------------------------------------------------------- */

/** Полностью ненастроенный справочник: весь registry сразу с пустыми полями. */
export const NormsAllUnset: Story = {
  render: () => <PageStory route="/catalogs?tab=methods" scenario={{ rules: [] }} />,
};

/** Read-only: роль без прав — controls readonly, без mutation-контролов,
 * страница не выглядит сломанной (§15.4). */
export const NormsReadOnly: Story = {
  render: () => (
    <PageStory
      route="/catalogs?tab=methods"
      scenario={{ user: { role: "VET", full_name: "Игорь Ветеринар", capabilities: [] } }}
    />
  ),
};

/** Loading skeleton внутри секции реального размера (§15.1). */
export const NormsLoadingSkeleton: Story = {
  render: () => <PageStory route="/catalogs?tab=methods" scenario={{ contextDelay: 600000 }} />,
};

/** Ошибка сети: честный статус с «Повторить» внутри рабочей области (§15.2). */
export const NormsNetworkError: Story = {
  render: () => (
    <PageStory
      route="/catalogs?tab=methods"
      scenario={{
        contextProblem: { code: "UPSTREAM", detail: "Сервер справочников недоступен.", status: 503 },
      }}
    />
  ),
};

/** Длинные названия лаборатории в контексте (фикстурные данные). */
export const NormsLongNames: Story = {
  render: () => (
    <PageStory
      route="/catalogs?tab=methods"
      scenario={{
        names: {
          laboratory: "ГБУ «Государственная ветеринарная лаборатория по Республике Татарстан»",
          area: "Мясо и мясопродукты",
        },
      }}
    />
  ),
};

/* --- Interaction states (§18): native DOM play, same page code. ------------ */

const byLabel = (root: Document | HTMLElement, label: string): HTMLInputElement | null =>
  root.querySelector(`input[aria-label="${label}"]`);

const waitReady = async (doc: Document, label: string): Promise<HTMLInputElement | null> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const input = byLabel(doc, label);
    if (input !== null && !input.disabled) return input;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return null;
};

const clickByText = (root: Document | HTMLElement, text: string): void => {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent === text);
  if (button instanceof HTMLButtonElement) button.click();
};

const setValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set as (
    value: string,
  ) => void;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

/** Field validation error: 9 > 4 — the error appears at the row (§14). */
export const NormsFieldValidationError: Story = {
  render: () => <PageStory route="/catalogs?tab=methods" />,
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const lower = await waitReady(doc, "Норма от: Температура в толще мышц");
    if (lower !== null) setValue(lower, "9");
    clickByText(doc, "Сохранить справочник");
  },
};

/** Partial save: the temperature PUT fails, the summary reports honestly. */
export const NormsPartialSave: Story = {
  render: () => (
    <PageStory
      route="/catalogs?tab=methods"
      scenario={{
        putResults: {
          [RULE_TEMPERATURE]: () =>
            HttpResponse.json(
              {
                code: "VALIDATION_ERROR",
                detail: "Тип нормы не соответствует каноническому типу результата.",
              },
              { status: 422 },
            ),
        },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const lower = await waitReady(doc, "Норма от: Температура в толще мышц");
    if (lower !== null) setValue(lower, "1");
    clickByText(doc, "Сохранить справочник");
  },
};

/** 409: the draft stays, the honest resolution choice appears (§12.6). */
export const Norms409Conflict: Story = {
  render: () => (
    <PageStory
      route="/catalogs?tab=methods"
      scenario={{
        putResults: {
          [RULE_TEMPERATURE]: () =>
            HttpResponse.json(
              { code: "REVISION_CONFLICT", detail: "Запись была изменена другим пользователем." },
              { status: 409 },
            ),
        },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const lower = await waitReady(doc, "Норма от: Температура в толще мышц");
    if (lower !== null) setValue(lower, "1");
    clickByText(doc, "Сохранить справочник");
  },
};
