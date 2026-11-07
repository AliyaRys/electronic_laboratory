/**
 * ExaminationForm tests (E04): the memory-only form, the strictly separate
 * wait/complete actions, the readable keyboard/accessible flows (research
 * add/remove, «Иное», disease rows), the honest conflict behaviour and the
 * absence assertions (no draft button, no parts/head/organs fields, no
 * conditional-fit option).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { ExaminationForm, initialSample } from "./ExaminationForm";
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
    fields: { documentNumber: "№ A-001234", consignor: "ООО «Мясопром»" },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: null,
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

function renderForm(collections: CollectionView[] = []): void {
  const client = new QueryClient();
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ExaminationForm
          party={party}
          view={null}
          today="2026-11-07"
          availableCollections={collections}
          onSaved={() => undefined}
          onCancel={() => undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ExaminationForm", () => {
  it("the sample defaults to 0.8 kg and REUSE when a collection exists", () => {
    expect(initialSample(null, [collection], "2026-11-07")).toMatchObject({
      mode: "REUSE",
      collectionId: collection.id,
    });
    expect(initialSample(null, [], "2026-11-07")).toMatchObject({ mode: "NEW", massKg: "0.8" });
  });

  it("renders two strictly separate create actions and never a draft button", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Отправить в ожидание результата" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Завершить ВСЭ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /черновик/i })).toBeNull();
    // No legacy parts/head/organs inputs exist anywhere (SC-035).
    expect(screen.queryByLabelText(/части туш|голов|органов/i)).toBeNull();
    // No conditional-fit option exists (rejected by the schema).
    expect(screen.queryByText(/Условно-пригодно/)).toBeNull();
  });

  it("adds and removes an optional research through accessible names", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Добавить бактериоскопию" }));
    expect(screen.getByRole("textbox", { name: "Бактериоскопия" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Удалить бактериоскопию" }));
    expect(screen.queryByRole("textbox", { name: "Бактериоскопия" })).toBeNull();
  });

  it("the «Иное» result requires an explanation text", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Добавить пробу варки" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Проба варки" }), "OTHER");
    await user.type(screen.getByRole("textbox", { name: "Номер ВСЭ *" }), "№ 1");
    await user.type(
      screen.getByRole("textbox", { name: "Маркировка — ветеринарное клеймо лаборатории *" }),
      "кл-1",
    );
    // Mandatory research cards are selects; choose «Соответствует» twice.
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Органолептическое исследование" }),
      "MATCH",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Идентификация продукции" }), "MATCH");
    await user.type(screen.getByRole("spinbutton", { name: "Температура в толще мышц, °C" }), "3.5");
    await user.click(screen.getByRole("button", { name: "Завершить ВСЭ" }));
    expect(await screen.findByText(/для «Иное» требуется пояснение/i)).toBeTruthy();
  });

  it("adds and removes a disease row through accessible names", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Добавить незаразное заболевание" }));
    expect(screen.getByRole("combobox", { name: "Незаразные болезни: наименование болезни" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Удалить незаразное заболевание 1" }));
    expect(screen.queryByRole("combobox", { name: "Незаразные болезни: наименование болезни" })).toBeNull();
  });

  it("WAITING without the sent-to-lab mark is refused with a readable message", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Органолептическое исследование" }),
      "MATCH",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Идентификация продукции" }), "MATCH");
    await user.type(screen.getByRole("spinbutton", { name: "Температура в толще мышц, °C" }), "2.0");
    await user.type(screen.getByRole("textbox", { name: "Номер ВСЭ *" }), "№ 5");
    await user.type(
      screen.getByRole("textbox", { name: "Маркировка — ветеринарное клеймо лаборатории *" }),
      "кл-5",
    );
    await user.click(screen.getByRole("button", { name: "Отправить в ожидание результата" }));
    expect(await screen.findByText(/Ожидание возможно только после отправки проб/)).toBeTruthy();
  });

  it("a 409 conflict preserves every entered value and offers the actual state", async () => {
    server.use(
      http.post(`*/api/v1/examinations/parties/${PARTY}`, () =>
        HttpResponse.json(
          {
            code: "REVISION_CONFLICT",
            title: "Revision conflict",
            status: 409,
            detail: "Карточка изменена другим пользователем.",
            instance: "",
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole("textbox", { name: "Номер ВСЭ *" }), "№ 777");
    await user.type(
      screen.getByRole("textbox", { name: "Маркировка — ветеринарное клеймо лаборатории *" }),
      "кл-7",
    );
    await user.click(screen.getByRole("checkbox", { name: /Пробы отправлены/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Органолептическое исследование" }),
      "MATCH",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Идентификация продукции" }), "MATCH");
    await user.type(screen.getByRole("spinbutton", { name: "Температура в толще мышц, °C" }), "2.0");
    await user.click(screen.getByRole("button", { name: "Отправить в ожидание результата" }));
    expect(
      (await screen.findAllByText(/Карточка изменена другим пользователем|Не удалось сохранить/)).length,
    ).toBeGreaterThan(0);
    expect((screen.getByRole("textbox", { name: "Номер ВСЭ *" }) as HTMLInputElement).value).toBe("№ 777");
    await waitFor(() => expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy());
  });

  it("a network error never claims success and keeps the input", async () => {
    server.use(http.post(`*/api/v1/examinations/parties/${PARTY}`, () => HttpResponse.error()));
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole("textbox", { name: "Номер ВСЭ *" }), "№ 900");
    await user.type(
      screen.getByRole("textbox", { name: "Маркировка — ветеринарное клеймо лаборатории *" }),
      "кл-9",
    );
    await user.click(screen.getByRole("checkbox", { name: /Пробы отправлены/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Органолептическое исследование" }),
      "MATCH",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Идентификация продукции" }), "MATCH");
    await user.type(screen.getByRole("spinbutton", { name: "Температура в толще мышц, °C" }), "2.0");
    await user.click(screen.getByRole("button", { name: "Отправить в ожидание результата" }));
    expect(await screen.findByText(/Не удалось сохранить ВСЭ|Ошибка соединения/)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Номер ВСЭ *" }) as HTMLInputElement).value).toBe("№ 900");
    expect(screen.queryByText(/сохранена/i)).toBeNull();
  });
});
