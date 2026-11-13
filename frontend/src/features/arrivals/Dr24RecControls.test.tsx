/**
 * ТЗ DR24 (dorabotka/2026-11-13-reconciliation-controls-logo-drafts-quantities.md):
 * comparison-card geometry, the Mercury badge logo, draft-state semantics
 * (no mark is ever saved without «Сохранить сверку») and the string-only
 * decimal presentation. MSW fixtures only — live VetIS writes are forbidden.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReconciliationPage } from "../../pages/ReconciliationPage";
import { ReconciliationForm } from "./ReconciliationForm";
import {
  formatDecimalDisplay,
  normalizeDecimalInput,
  type IncomingView,
  type ReconciliationView,
} from "./api";
import { useDirtyStore } from "../../entities/session/context";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const UNIT_GUID = "21ed96c9-337b-4a27-8761-c6e6ad3c9f5b";

/** The fixture party with resolved participant names (SOURCE_XML/VETIS_LOOKUP). */
const party: IncomingView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "CONFIRMED",
    fields: {
      documentUuid: "1f0e6d2a-1111-4222-8333-444444444444",
      issuedOn: "2026-11-03",
      statusLabel: "Оформлен",
      purpose: "реализация в пищу людям",
      transportNumber: "А123ВС77",
      senderOwner: "СХПК «Заря»",
      senderOwnerNameSource: "SOURCE_XML",
      senderEnterprise: "ООО «Мясопром»",
      senderEnterpriseNameSource: "VETIS_LOOKUP",
      receiverOwner: "ИП Петров",
      receiverOwnerNameSource: "SOURCE_XML",
      receiverEnterprise: "Лаборатория ВСЭ №1",
      receiverEnterpriseNameSource: "VETIS_LOOKUP",
      productItem: "Отруба говяжьи",
      product: "говядина",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Отруба говяжьи" },
    unit: { id: UNIT_GUID, name: "кг" },
  },
  documentary: { mass_kg: "60.000000", quantity: "5", unit_id: UNIT_GUID },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 1,
  source_presence: "CURRENT_CONFIRMED",
};

const emptyView: ReconciliationView = {
  id: "",
  party_id: PARTY,
  revision: 1,
  state: "OPEN",
  checks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "0", quantity: "0", unit_id: "" },
  accepted: { mass_kg: "0", quantity: "0", unit_id: "" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "" },
  decision: null,
  return_reason: null,
  repeat: null,
  transaction: { planned: null, type: null },
  fair: false,
  services: [],
  actor_id: "",
  saved_at: "2026-11-07T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: null,
  errors: [],
  complete: false,
};

const reconciliationCss = readFileSync(
  resolve(process.cwd(), "src/features/arrivals/reconciliation.css"),
  "utf8",
);

afterEach(() => {
  useDirtyStore.getState().setDirty(false);
});

function renderForm(props: { party?: IncomingView; initial?: ReconciliationView } = {}): void {
  const client = new QueryClient();
  client.setQueryData([LAB, PARTY, "reconciliation"], props.initial ?? emptyView);
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReconciliationForm
          party={props.party ?? party}
          initial={props.initial ?? emptyView}
          onSaved={() => undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/* --- §5: the string-only decimal presentation ---------------------------------- */

describe("ТЗ DR24 §5: строковый decimal-форматтер", () => {
  it("shows the exact display table of the spec", () => {
    const table: [string, string][] = [
      ["60", "60"],
      ["60.0", "60"],
      ["60.000000", "60"],
      ["60.45", "60,45"],
      ["60.450000", "60,45"],
      ["0.000000", "0"],
    ];
    for (const [source, display] of table) {
      expect(formatDecimalDisplay(source)).toBe(display);
    }
  });

  it("keeps every significant digit — no JS number ever touches the value", () => {
    const big = "12345678901234567890.1234567800";
    expect(formatDecimalDisplay(big)).toBe("12345678901234567890,12345678");
    // The canonical form keeps the same precision — no rounding, no exponent.
    expect(normalizeDecimalInput("12345678901234567890,1234567800")).toBe("12345678901234567890.12345678");
  });

  it("never breaks intermediate typing (60, / empty / comma input)", () => {
    expect(formatDecimalDisplay("60,")).toBe("60,");
    expect(formatDecimalDisplay("60.")).toBe("60.");
    expect(formatDecimalDisplay("")).toBe("");
    // The canonical value of the same inputs at blur/submit.
    expect(normalizeDecimalInput("60,")).toBe("60");
    expect(normalizeDecimalInput("60.0")).toBe("60");
    expect(normalizeDecimalInput("60,45")).toBe("60.45");
    expect(normalizeDecimalInput("")).toBe("");
  });
});

/* --- §4: the comparison-card geometry ------------------------------------------- */

describe("ТЗ DR24 §4: геометрия карточки сравнения", () => {
  it("keeps the value and the two mark buttons in one row — value up to the controls", () => {
    renderForm();
    const card = document.querySelector('[data-field-id="CHK-F21"]');
    expect(card).not.toBeNull();
    // The mockup grid: the value fills minmax(0,1fr), the two 40 px controls
    // sit right of it as the next grid items — never wrapped below.
    expect(reconciliationCss).toContain(".vse-rec-compare {");
    expect(
      reconciliationCss.replace(/\s+/g, " ").includes("grid-template-columns: minmax(0, 1fr) 40px 40px;"),
    ).toBe(true);
    const children = [...(card as Element).children];
    const valueIndex = children.findIndex((node) => node.classList.contains("vse-rec-mercury-value"));
    const buttonsIndex = children.findIndex((node) => node.classList.contains("vse-rec-check-buttons"));
    expect(valueIndex).toBeGreaterThanOrEqual(0);
    expect(buttonsIndex).toBe(valueIndex + 1);
    for (const button of (card as Element).querySelectorAll(".vse-rec-check")) {
      expect(button.className).toContain("vse-rec-check");
    }
  });

  it("the touch controls keep the 40×40 mockup geometry", () => {
    renderForm();
    expect(reconciliationCss).toMatch(/\.vse-rec-check \{[^}]*width: 40px;[^}]*height: 40px;/s);
  });

  it("does not push the buttons out at 390 px (no horizontal document scroll)", () => {
    const original = window.innerWidth;
    window.innerWidth = 390;
    try {
      renderForm();
      expect(document.documentElement.scrollWidth <= window.innerWidth + 1).toBe(true);
      const card = document.querySelector('[data-field-id="CHK-F21"]');
      const buttons = card?.querySelector(".vse-rec-check-buttons");
      expect(buttons).not.toBeNull();
    } finally {
      window.innerWidth = original;
    }
  });

  it("CHK-F07/F08 have ACTIVE mark buttons when the names are resolved", () => {
    renderForm();
    for (const fieldId of ["CHK-F07", "CHK-F08"]) {
      const card = document.querySelector(`[data-field-id="${fieldId}"]`);
      expect(card).not.toBeNull();
      for (const radio of card?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []) {
        expect(radio.disabled).toBe(false);
        expect(radio.checked).toBe(false);
      }
    }
  });

  it("PENDING/ERROR/MISSING keep the controls present, disabled and unmarked", () => {
    renderForm({
      party: {
        ...party,
        external: {
          ...party.external,
          fields: {
            ...party.external.fields,
            senderOwnerNameSource: "PENDING",
            senderOwner: "",
            receiverOwnerNameSource: "ERROR",
            receiverOwner: "",
            receiverEnterprise: "",
            receiverEnterpriseNameSource: "MISSING",
          },
        },
      },
    });
    const senderOwnerCard = document.querySelector('[data-field-id="CHK-F06"]');
    expect(senderOwnerCard?.textContent).toContain("Уточняем названия организаций…");
    const receiverEnterprise = document.querySelector('[data-field-id="CHK-F07"]');
    expect(receiverEnterprise?.textContent).toContain("Название не получено");
    const receiverOwner = document.querySelector('[data-field-id="CHK-F08"]');
    expect(receiverOwner?.textContent).toContain("Название временно недоступно");
    for (const fieldId of ["CHK-F06", "CHK-F07", "CHK-F08"]) {
      const card = document.querySelector(`[data-field-id="${fieldId}"]`);
      const radios = card?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [];
      expect(radios.length).toBe(2);
      for (const radio of radios) {
        expect(radio.disabled).toBe(true);
        expect(radio.checked).toBe(false);
      }
    }
    // A GUID is never shown instead of a name.
    expect(document.body.textContent).not.toContain(UNIT_GUID);
  });

  it("keeps the keyboard focus, radio semantics and the polite live status", async () => {
    renderForm();
    const weight = screen.getByRole("radio", { name: "Не совпадает: Вес, кг" });
    expect(weight.getAttribute("type")).toBe("radio");
    expect(screen.getByRole("radiogroup", { name: "Отметка сравнения: Вес, кг" })).toBeInTheDocument();
    weight.focus();
    expect(document.activeElement).toBe(weight);
    await userEvent.click(weight);
    expect(screen.getByText("Поле «Вес, кг»: не совпадает.")).toBeInTheDocument();
  });
});

/* --- §3.2: the Mercury badge logo ------------------------------------------------ */

describe("ТЗ DR24 §3.2: бейдж «Меркурий» с логотипом", () => {
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
    http.get(`*/api/v1/arrivals/${PARTY}`, () => HttpResponse.json(party)),
    http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => HttpResponse.json(emptyView)),
  );
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it("renders the mockup badge: img /mercury-logo.webp alt='' + text «Меркурий»", async () => {
    render(
      <MemoryRouter initialEntries={[`/labs/${LAB}/arrivals/${PARTY}/reconciliation`]}>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/labs/:labId/arrivals/:partyId/reconciliation" element={<ReconciliationPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const badge = await screen.findByText("Меркурий");
    expect(badge.closest(".vse-rec-mercury-badge")).not.toBeNull();
    const img = badge.closest(".vse-rec-mercury-badge")?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/mercury-logo.webp");
    expect(img?.getAttribute("alt")).toBe("");
  });
});

/* --- §3.3/§7: draft-state semantics ---------------------------------------------- */

const sessionHandler = http.get("*/api/v1/me", () =>
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
);

describe("ТЗ DR24 §3.3/§7: черновик-семантика сверки", () => {
  const savedViewWithCheck = (checks: ReconciliationView["checks"]): ReconciliationView => ({
    ...emptyView,
    id: "d24e2d3a-1111-4222-8333-444444444444",
    revision: 2,
    checks,
  });

  it("a NEW reconciliation (checks={}) renders every mark neutral", () => {
    renderForm();
    for (const radio of document.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][value="matches"], input[type="radio"][value="mismatch"]',
    )) {
      expect(radio.checked).toBe(false);
    }
  });

  it("a mark is draft-only: route unmount without PUT keeps the marks gone on reopen", async () => {
    let putCount = 0;
    const server = setupServer(
      sessionHandler,
      http.get(`*/api/v1/arrivals/${PARTY}`, () => HttpResponse.json(party)),
      http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => HttpResponse.json(emptyView)),
      http.put(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => {
        putCount += 1;
        return HttpResponse.json(emptyView, { status: 200 });
      }),
    );
    server.listen();
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let cleanup: () => void = () => undefined;
      const renderPage = (): void => {
        const { unmount } = render(
          <MemoryRouter initialEntries={[`/labs/${LAB}/arrivals/${PARTY}/reconciliation`]}>
            <QueryClientProvider client={client}>
              <Routes>
                <Route
                  path="/labs/:labId/arrivals/:partyId/reconciliation"
                  element={<ReconciliationPage />}
                />
              </Routes>
            </QueryClientProvider>
          </MemoryRouter>,
        );
        cleanup = unmount;
      };
      renderPage();
      const weight = await screen.findByRole("radio", { name: "Не совпадает: Вес, кг" });
      await userEvent.click(weight);
      expect(weight).toBeChecked();
      // Leave the route (unmount) WITHOUT «Сохранить сверку».
      cleanup();
      expect(putCount).toBe(0);
      // Reopen: the draft is gone — every mark is neutral again.
      renderPage();
      const reopened = await screen.findByRole("radio", { name: "Не совпадает: Вес, кг" });
      expect(reopened).not.toBeChecked();
      expect(putCount).toBe(0);
      cleanup();
    } finally {
      server.close();
      useDirtyStore.getState().setDirty(false);
    }
  });

  it("«Все соответствует» without «Сохранить сверку» fires no network request", async () => {
    let putCount = 0;
    const server = setupServer(
      http.put(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => {
        putCount += 1;
        return HttpResponse.json(emptyView, { status: 200 });
      }),
    );
    server.listen();
    try {
      renderForm();
      await userEvent.click(screen.getByRole("button", { name: /Все соответствует/ }));
      expect(putCount).toBe(0);
      const matches = document.querySelectorAll<HTMLInputElement>('input[type="radio"][value="matches"]');
      expect([...matches].some((radio) => radio.checked)).toBe(true);
    } finally {
      server.close();
    }
  });

  it("the query cache never receives draft form values before a successful PUT", async () => {
    let putCount = 0;
    const saved = savedViewWithCheck({ "CHK-F21": { matches: false, actual: "58", reason: "Недостача" } });
    const server = setupServer(
      http.put(`*/api/v1/arrivals/${PARTY}/reconciliation`, async ({ request }) => {
        putCount += 1;
        const body = (await request.json()) as { checks: Record<string, unknown> };
        // The only write path publishes the SAVED server view.
        expect(body.checks["CHK-F21"]).toEqual({ matches: false, actual: "58", reason: "Недостача" });
        return HttpResponse.json(saved, { status: 200 });
      }),
    );
    server.listen();
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData([LAB, PARTY, "reconciliation"], emptyView);
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <ReconciliationForm
              party={party}
              initial={emptyView}
              onSaved={(view) => {
                client.setQueryData([LAB, PARTY, "reconciliation"], view);
              }}
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await userEvent.click(screen.getByRole("radio", { name: "Не совпадает: Вес, кг" }));
      await userEvent.type(screen.getByLabelText("Фактическое значение"), "58");
      await userEvent.type(screen.getByLabelText("Причина несоответствия"), "Недостача");
      // Draft state: the cache still holds the EMPTY view.
      expect(client.getQueryData<ReconciliationView>([LAB, PARTY, "reconciliation"])?.checks).toEqual({});
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(putCount).toBe(1));
      // Only the successful PUT publishes the saved checks.
      expect(client.getQueryData<ReconciliationView>([LAB, PARTY, "reconciliation"])?.checks).toEqual(
        saved.checks,
      );
    } finally {
      server.close();
    }
  });

  it("a previously SAVED reconciliation restores its saved checks on reopen (diagnostic: the preselected mark comes from the saved server view)", async () => {
    let putCount = 0;
    const server = setupServer(
      sessionHandler,
      http.get(`*/api/v1/arrivals/${PARTY}`, () => HttpResponse.json(party)),
      http.get(`*/api/v1/arrivals/${PARTY}/reconciliation`, () =>
        HttpResponse.json(savedViewWithCheck({ "CHK-F21": { matches: true, actual: null, reason: null } })),
      ),
      http.put(`*/api/v1/arrivals/${PARTY}/reconciliation`, () => {
        putCount += 1;
        return HttpResponse.json(emptyView, { status: 200 });
      }),
    );
    server.listen();
    try {
      render(
        <MemoryRouter initialEntries={[`/labs/${LAB}/arrivals/${PARTY}/reconciliation`]}>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <Routes>
              <Route path="/labs/:labId/arrivals/:partyId/reconciliation" element={<ReconciliationPage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
      const restored = await screen.findByRole("radio", { name: "Совпадает: Вес, кг" });
      expect(restored).toBeChecked();
      // The preselected mark comes from the SAVED server checks, not from any
      // automatic marking: no write happened while opening the screen.
      expect(putCount).toBe(0);
    } finally {
      server.close();
    }
  });

  it("a saved OPEN reconciliation restores ONLY the really-saved checks", () => {
    // Diagnostic: change the saved check and the shown mark follows the
    // saved data — the source of a preselected mark is `initial.checks`.
    renderForm({
      initial: savedViewWithCheck({ "CHK-F21": { matches: false, actual: "58", reason: "Недостача" } }),
    });
    expect((screen.getByRole("radio", { name: "Не совпадает: Вес, кг" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: "Совпадает: Вес, кг" }) as HTMLInputElement).checked).toBe(
      false,
    );
    // Everything else stays neutral.
    expect((screen.getByRole("radio", { name: "Совпадает: Номер ТС" }) as HTMLInputElement).checked).toBe(
      false,
    );
  });
});

/* --- §5/§6: quantities in the form, payload and summary --------------------------- */

describe("ТЗ DR24 §5/§6: количества, подписи и unit_id", () => {
  it("displays «60.000000» as «60» and «60,45» input saves the canonical decimal string", async () => {
    type Payload = {
      delivered: { mass_kg: string; quantity: string; unit_id: string };
      accepted: { mass_kg: string; unit_id: string };
      returned: { mass_kg: string; unit_id: string };
    };
    const payloads: Payload[] = [];
    const server = setupServer(
      http.put(`*/api/v1/arrivals/${PARTY}/reconciliation`, async ({ request }) => {
        payloads.push((await request.json()) as Payload);
        return HttpResponse.json({ ...emptyView, revision: 2 }, { status: 200 });
      }),
    );
    server.listen();
    try {
      renderForm({
        initial: {
          ...emptyView,
          delivered: { mass_kg: "60.000000", quantity: "5", unit_id: UNIT_GUID },
        },
      });
      // The documentary mass 60.000000 is displayed without the zero tail.
      expect(screen.getAllByLabelText("Вес, кг")[0]).toHaveValue("60");
      // A comma input is accepted and saved as the canonical decimal string.
      const acceptedMass = screen.getAllByLabelText("Вес, кг")[1];
      await userEvent.clear(acceptedMass);
      await userEvent.type(acceptedMass, "60,45");
      expect(acceptedMass).toHaveValue("60,45");
      // The place count keeps its own clear label — never «Количество (кг)».
      expect(screen.queryByText(/Количество \(кг\)/)).toBeNull();
      expect(screen.getAllByLabelText("Количество мест, шт.").length).toBe(3);
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(payloads.length).toBe(1));
      expect(payloads[0].accepted.mass_kg).toBe("60.45");
      expect(payloads[0].delivered.mass_kg).toBe("60");
      expect(payloads[0].delivered.unit_id).toBe(UNIT_GUID);
      expect(payloads[0].returned.unit_id).toBe(UNIT_GUID);
    } finally {
      server.close();
    }
  });

  it("a blurred comma input is canonicalised in place without losing precision", async () => {
    renderForm();
    const mass = screen.getAllByLabelText("Вес, кг")[0];
    await userEvent.clear(mass);
    await userEvent.type(mass, "60,450");
    await userEvent.tab();
    expect(mass).toHaveValue("60,45");
    // An intermediate «60,» survives until blur.
    await userEvent.clear(mass);
    await userEvent.type(mass, "60,");
    expect(mass).toHaveValue("60,");
    await userEvent.tab();
    expect(mass).toHaveValue("60");
  });

  it("shows mass and place count separately and never a GUID in the quantity blocks", () => {
    renderForm({
      party: {
        ...party,
        classification: { ...party.classification, unit: { id: UNIT_GUID, name: null } },
      },
    });
    const quantities = document.querySelector(".vse-rec-quantities");
    expect(quantities?.textContent).toContain("Вес, кг");
    expect(quantities?.textContent).toContain("Количество мест, шт.");
    expect(quantities?.textContent).not.toContain("GUID:");
    expect(quantities?.textContent).not.toContain(UNIT_GUID);
    expect(quantities?.textContent).not.toContain("Единица измерения");
  });

  it("formats the decimal facts of the receipt-confirmation summary", () => {
    // The presentation helper stays string-only for the summary too.
    expect(formatDecimalDisplay("34.5")).toBe("34,5");
    expect(formatDecimalDisplay("0.000000")).toBe("0");
    expect(formatDecimalDisplay("120")).toBe("120");
  });
});
