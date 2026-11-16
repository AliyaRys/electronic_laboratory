/**
 * DR30 composition tests (ТЗ §11.2): the new mockup-parity composition of the
 * examination card — the six section headings, the readonly specialist (no
 * manual select), the strictly separate three actions without a draft button,
 * the real fixture values (never mockup demo data) and the payload contract
 * that an added optional research does not change.
 *
 * Pure jsdom cannot measure real box geometry, so the horizontal-scroll and
 * sticky-panel overlap checks are assertions about the shared composition
 * classes here; the real measurements run in tests/e2e/examinations.spec.ts.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ExaminationForm } from "./ExaminationForm";
import type { CollectionView } from "../samples/api";
import type { IncomingView } from "../arrivals/api";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const party: IncomingView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
      issuedOn: "2026-11-03",
      consignor: "ООО «Мясопром»",
      consignorOwner: "Петров Пётр Петрович, ИНН: 123456789012",
      consignee: "АО «Приёмка»",
      consigneeOwner: "Сидорова Анна Ивановна, ИНН: 123456789021",
    },
  },
  classification: {
    productType: 1,
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "Мясо и мясопродукты" },
    subProduct: { id: "sp", name: "говядина" },
    productItem: { id: "pi", name: "Говядина в четвертинах охлаждённая" },
    unit: null,
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "u1" },
  confirmation: {
    id: "c1000000-0000-4000-8000-000000000001",
    accepted_mass_kg: "100.0",
    accepted_quantity: "4",
    accepted_unit_id: "шт",
    returned_mass_kg: "0",
    returned_quantity: "0",
    confirmed_at: "2026-11-07T10:00:00Z",
  },
  queue: "WORK",
  examination_id: null,
  revision: 1,
  source_presence: "CURRENT_CONFIRMED",
};

const collection: CollectionView = {
  id: "44444444-4444-4444-8444-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  product_species_id: "33333333-3333-4333-8333-333333333333",
  classification_snapshot: { product: { id: "s", name: "говядина" } },
  collected_on: "2026-11-06",
  mass_kg: "12.6",
  collected_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  created_at: "2026-11-06T10:00:00Z",
  disposal_id: null,
  revision: 1,
};

function renderForm(overrides: Partial<Parameters<typeof ExaminationForm>[0]> = {}): void {
  const client = new QueryClient();
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ExaminationForm
          party={party}
          view={null}
          today="2026-11-07"
          availableCollections={[collection]}
          onSaved={() => undefined}
          onCancel={() => undefined}
          specialistName="Кузнецова Алиса Викторовна"
          {...overrides}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DR30 examination composition", () => {
  it("renders the six mockup section headings", () => {
    renderForm();
    for (const title of [
      "Сведения об экспертизе",
      "Участники и продукция",
      "Исследования ВСЭ",
      "Проба",
      "Итог экспертизы",
      "Расчёт стоимости услуг",
    ]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeTruthy();
    }
  });

  it("shows the specialist readonly and never as a select", () => {
    renderForm();
    const specialist = screen.getByLabelText("Специалист") as HTMLInputElement;
    expect(specialist.value).toBe("Кузнецова Алиса Викторовна");
    expect(specialist.readOnly).toBe(true);
    expect(screen.queryByRole("combobox", { name: /специалист/i })).toBeNull();
  });

  it("keeps the three working actions and no draft button", () => {
    renderForm();
    const panel = document.querySelector(".vse-exam-actions");
    expect(panel).not.toBeNull();
    const names = ["Отменить", "Отправить в ожидание результата", "Завершить ВСЭ"];
    for (const name of names) {
      const button = screen.getByRole("button", { name });
      expect(panel?.contains(button)).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /черновик/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Сохранить ВСЭ" })).toBeNull();
  });

  it("shows real fixture facts, never the mockup demo data", () => {
    renderForm();
    expect((screen.getByLabelText("UUID ВСД") as HTMLInputElement).value).toBe(
      "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
    );
    expect((screen.getAllByLabelText("Название предприятия")[0] as HTMLInputElement).value).toBe(
      "ООО «Мясопром»",
    );
    expect((screen.getByLabelText("Принятый вес, кг") as HTMLInputElement).value).toBe("100.0");
    expect((screen.getByLabelText("Принятое количество") as HTMLInputElement).value).toBe("4 шт");
    // The static mockup's demo names are forbidden on the working screen.
    for (const demo of ["Шайдуллин", "Хусаинова", "Молькеево", "Агропромышленный парк"]) {
      expect(screen.queryByDisplayValue(new RegExp(demo))).toBeNull();
    }
  });

  it("long participant data stays inside the wrap-safe composition", () => {
    renderForm({
      party: {
        ...party,
        external: {
          ...party.external,
          fields: {
            ...party.external.fields,
            consignor:
              "Общество с ограниченной ответственностью «Научно-производственное объединение по комплексной переработке мясного сырья и производству специализированных продуктов питания» (422336, Республика Татарстан, Кайбицкий район, с. Молькеево, стр. убойный пункт)",
          },
        },
      },
    });
    const textarea = screen.getAllByLabelText("Название предприятия")[0] as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    // The participant card and the field carry the wrap-safe composition
    // classes (min-width:0 + overflow-wrap in CSS); jsdom cannot compute the
    // real scroll geometry — the e2e suite measures it in a real browser.
    expect(textarea.closest(".vse-participant")).not.toBeNull();
    expect(textarea.closest(".app-readonly-field")).not.toBeNull();
  });

  it("an added optional research reaches the payload without contract changes", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`*/api/v1/examinations/parties/${PARTY}`, async ({ request }) => {
        bodies.push(((await request.json()) ?? {}) as Record<string, unknown>);
        return HttpResponse.json(
          {
            id: "e0000000-0000-4000-8000-000000000001",
            party_id: PARTY,
            laboratory_id: LAB,
            number: "№ 1",
            stamp: "кл-1",
            status: "COMPLETED",
            sent_to_lab: false,
            researches: [],
            invasive_findings: [],
            noncontagious_findings: [],
            pricing: { lines: [], total: "0.00", currency: "RUB", fair: false },
            sample_collection_id: "",
            outcome: "FIT",
            direction: "SALE",
            reason: null,
            created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
            created_at: "2026-11-07T10:00:00Z",
            first_completed_at: null,
            revision: 1,
          },
          { status: 200 },
        );
      }),
    );
    const user = userEvent.setup();
    renderForm({ availableCollections: [] });
    await user.type(screen.getByRole("textbox", { name: "Номер ВСЭ *" }), "№ 1");
    await user.type(
      screen.getByRole("textbox", { name: "Маркировка — ветеринарное клеймо лаборатории *" }),
      "кл-1",
    );
    await user.click(screen.getByRole("button", { name: "Добавить бактериоскопию" }));
    await user.type(screen.getByRole("textbox", { name: "Бактериоскопия" }), "стафилококк");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Органолептическое исследование" }),
      "MATCH",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Идентификация продукции" }), "MATCH");
    await user.type(screen.getByRole("spinbutton", { name: "Температура в толще мышц, °C" }), "3.0");
    await user.click(screen.getByRole("radio", { name: "Пригодно" }));
    await user.click(screen.getByRole("button", { name: "Завершить ВСЭ" }));
    expect(bodies).toHaveLength(1);
    const researches = (bodies[0] as { researches: { indicatorId: string; kind: string; value: unknown }[] })
      .researches;
    expect(researches).toContainEqual({
      indicatorId: "e6be5304-d6d2-5f49-86a3-8e1308b344d4",
      kind: "TEXT",
      value: "стафилококк",
    });
    expect(researches).toHaveLength(4);
  });

  it("the sticky action panel is the last element of the composition", () => {
    renderForm();
    const form = document.querySelector(".vse-exam-form");
    expect(form?.lastElementChild?.classList.contains("vse-exam-actions")).toBe(true);
  });
});
