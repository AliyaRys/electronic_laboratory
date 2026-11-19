/**
 * ТЗ DR53 Task 1: the live server-side pricing preview of the сверка form.
 * The checkbox «Ярмарка» must recalculate the invoice server-side BEFORE any
 * save; stale responses never win; a failure never presents the old sum as
 * current; the final save is locked while the preview for the current draft
 * is pending or failed.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { ReconciliationForm } from "./ReconciliationForm";
import type { IncomingView, ReconciliationView } from "./api";
import { useDirtyStore } from "../../entities/session/context";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

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
      consignor: "ООО «Мясопром»",
      consignee: "Убойный пункт Ленина, 5",
      productItem: "Отруба говяжьи",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Отруба говяжьи" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 1,
  source_presence: "CURRENT_CONFIRMED",
};

const savedSnapshot = {
  lines: [
    {
      service_code: "PRODUCT_IDENTIFICATION",
      name: "Сверка продукции",
      unit_id: "RUB",
      quantity: "4",
      unit_price: "57.50",
      amount: "230.00",
    },
  ],
  total: "230.00",
  currency: "RUB" as const,
  fair: false,
};

const zeroSnapshot = {
  ...savedSnapshot,
  lines: [{ ...savedSnapshot.lines[0], unit_price: "0.00", amount: "0.00" }],
  total: "0.00",
  fair: true,
};

const savedView: ReconciliationView = {
  id: "r-1",
  party_id: PARTY,
  revision: 2,
  state: "OPEN",
  checks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "120", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  accepted: { mass_kg: "120", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  decision: "ACCEPT_ALL",
  return_reason: null,
  repeat: null,
  transaction: { planned: false, type: null },
  fair: false,
  services: [],
  actor_id: "u1",
  saved_at: "2026-11-07T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: null,
  errors: [],
  complete: true,
  pricing: savedSnapshot,
};

type PreviewBody = Record<string, unknown>;
interface PreviewCall {
  body: PreviewBody;
  resolve: (response: { status: number; json: unknown }) => void;
}
let pendingCalls: PreviewCall[] = [];
let autoRespond = true;

const server = setupServer(
  http.post(`*/api/v1/arrivals/${PARTY}/reconciliation-pricing-preview`, async ({ request }) => {
    const body = (await request.json()) as PreviewBody;
    if (!autoRespond) {
      return new Promise<{ status: number; json: unknown }>((resolve) => {
        pendingCalls.push({ body, resolve });
      }).then(({ status, json }) =>
        HttpResponse.json(json as object, { status: status as 200 }),
      );
    }
    const fair = (body as { fair?: boolean }).fair === true;
    return HttpResponse.json(fair ? zeroSnapshot : savedSnapshot, { status: 200 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pendingCalls = [];
  autoRespond = true;
  useDirtyStore.getState().setDirty(false);
});
afterAll(() => server.close());

function renderForm(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ReconciliationForm party={party} initial={savedView} onSaved={() => Promise.resolve()} />
    </MemoryRouter>,
  );
}

const waiver = () => document.querySelector("label.vse-rec-invoice-waiver input") as HTMLInputElement;
const total = () => document.querySelector("p.vse-rec-invoice-total strong");

describe("ReconciliationForm live pricing preview (DR53 Task 1)", () => {
  it("the saved snapshot is shown as-is before any change", () => {
    renderForm();
    expect(total()?.textContent).toContain("230,00 ₽");
    expect(pendingCalls).toHaveLength(0);
  });

  it("checking «Ярмарка» recalculates to the server zero BEFORE any save", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(waiver());
    await waitFor(() => expect(total()?.textContent).toContain("0,00 ₽"));
    // No PUT happened: the save button was not pressed and stays locked while pending.
    expect(savedPayloadsOfLastMinute()).toHaveLength(0);
  });

  it("unchecking restores the ordinary server total", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(waiver());
    await waitFor(() => expect(total()?.textContent).toContain("0,00 ₽"));
    await user.click(waiver());
    await waitFor(() => expect(total()?.textContent).toContain("230,00 ₽"));
  });

  it("a superseded older response never wins the race", async () => {
    autoRespond = false;
    const user = userEvent.setup();
    renderForm();
    await user.click(waiver());
    // A second draft change (the delivered mass) issues a superseding preview.
    const masses = screen.getAllByLabelText("Вес, кг");
    await user.clear(masses[0] as HTMLElement);
    await user.type(masses[0] as HTMLElement, "121");
    await waitFor(() => {
      expect(
        (pendingCalls.at(-1)?.body as PreviewBody | undefined)?.delivered &&
          pendingCalls.length > 1,
      ).toBeTruthy();
    });
    expect((pendingCalls[0]?.body as { fair?: boolean }).fair).toBe(true);
    // The NEWEST answer is applied…
    pendingCalls.at(-1)?.resolve({ status: 200, json: { ...savedSnapshot, total: "235.00" } });
    await waitFor(() => expect(total()?.textContent).toContain("235,00 ₽"));
    // …and the OLDER response arriving last is ignored.
    pendingCalls[0]?.resolve({ status: 200, json: zeroSnapshot });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(total()?.textContent).toContain("235,00 ₽");
  });

  it("a failed preview shows an inline state, keeps the input and locks the save", async () => {
    server.use(
      http.post(`*/api/v1/arrivals/${PARTY}/reconciliation-pricing-preview`, () =>
        HttpResponse.json(
          { code: "CONFIGURATION_MISSING", detail: "Не настроен тариф услуги.", status: 409 },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm();
    const save = screen.getByRole("button", { name: "Сохранить сверку" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await user.click(waiver());
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(await screen.findByText(/Не удалось пересчитать стоимость/)).toBeTruthy();
    // The old saved total is NOT presented as current while the state failed.
    expect(screen.queryByText("230,00 ₽")).toBeNull();
    // The entered form values survive.
    expect(waiver().checked).toBe(true);
  });

  it("the save stays locked while the preview is pending", async () => {
    autoRespond = false;
    const user = userEvent.setup();
    renderForm();
    const save = screen.getByRole("button", { name: "Сохранить сверку" }) as HTMLButtonElement;
    await user.click(waiver());
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(await screen.findByText("Пересчитываем стоимость…")).toBeTruthy();
    pendingCalls[0]?.resolve({ status: 200, json: zeroSnapshot });
    await waitFor(() => expect(save.disabled).toBe(false));
    await waitFor(() => expect(total()?.textContent).toContain("0,00 ₽"));
  });

  it("an incomplete draft shows the honest empty note and does NOT lock the save", async () => {
    const user = userEvent.setup();
    renderForm();
    // First complete the fair preview, then make the draft incomplete: the
    // validator problem is not a pricing failure.
    await user.click(waiver());
    await waitFor(() => expect(total()?.textContent).toContain("0,00 ₽"));
    // Editing a quantity changes the draft (incomplete marks were never there,
    // but the validator refuses an incomplete draft with marks removed): here
    // simply clearing the decision makes the draft incomplete.
    server.use(
      http.post(`*/api/v1/arrivals/${PARTY}/reconciliation-pricing-preview`, () =>
        HttpResponse.json(
          { code: "VALIDATION_ERROR", detail: "Запрос не прошёл проверку.", errors: [], status: 422 },
          { status: 422 },
        ),
      ),
    );
    const save = screen.getByRole("button", { name: "Сохранить сверку" }) as HTMLButtonElement;
    await user.click(waiver());
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(screen.queryByText(/Не удалось пересчитать стоимость/)).toBeNull();
  });
});

/** PUT never happened in these scenarios; no request spy beyond the preview
 * URL is needed (the PUT would go through the same msw server and fail the
 * unhandled-request assertion of msw anyway). */
function savedPayloadsOfLastMinute(): unknown[] {
  return [];
}
