/**
 * ExaminationForm tests (E04, DR35): the memory-only form, the strictly
 * separate wait/complete actions, the readable keyboard/accessible flows, the
 * honest conflict behaviour and the DR35 data rules: NEW-only sample, scoped
 * specialist choice, no confirm-note, participant labels and honest product
 * type / number presentation.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ExaminationForm, initialSample, toResearchValue } from "./ExaminationForm";
import type { CollectionView } from "../samples/api";
import type { IncomingView } from "../arrivals/api";
import type { ExaminationFormView } from "./api";
import { INDICATORS } from "./indicators";

const TRICHINELLA_INDICATOR_ID = INDICATORS.find((def) => def.code === "VSE-F21")?.id ?? "";
const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const ME = "77777777-7777-4777-8777-777777777777";

/** DR52 §7: the research dropdowns use the shared SelectDropdown — an option
 * is chosen through the listbox trigger click and the option click. */
type User = Awaited<ReturnType<typeof userEvent.setup>>;
async function chooseOption(user: User, label: RegExp, optionText: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: label }));
  await user.click(await screen.findByRole("option", { name: optionText }));
}

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
    fields: { documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac", consignor: "ООО «Мясопром»" },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: null,
    unit: null,
    productType: 1,
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

const formView: ExaminationFormView = {
  party_id: PARTY,
  laboratory_id: LAB,
  participants: {
    senderOwner: { name: "ХС-1", state: "SOURCE_XML" },
    senderEnterprise: { name: "Предприятие-1", state: "SOURCE_XML" },
    receiverOwner: { name: "ХС-2", state: "SOURCE_XML" },
    receiverEnterprise: { name: "Предприятие-2", state: "SOURCE_XML" },
  },
  product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
  sub_product: null,
  product_item: null,
  unit: null,
  product_type: 1,
  product_type_label: "Мясо и мясопродукты",
  accepted: { massKg: "100.0", quantity: "4", unitId: "шт", unitName: null },
  required_research_ids: [],
  eligible_specialists: [{ id: ME, fullName: "Врач Ветеринарный" }],
  reconciliation_fair: false,
  source_revision: "1f0e6d2a-1111-4222-8333-444444444444",
  reconciliation_revision: 1,
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
  product_name: "Говядина",
  evsd_uuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
  collected_by_name: "Ветеринарный врач",
  created_at: "2026-11-06T10:00:00Z",
  disposal_id: null,
  revision: 1,
};

function renderForm(
  collections: CollectionView[] = [],
  overrides: { formView?: ExaminationFormView } = {},
): void {
  const client = new QueryClient();
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ExaminationForm
          party={party}
          view={null}
          today="2026-11-07"
          availableCollections={collections}
          formView={overrides.formView ?? formView}
          currentUserId={ME}
          onSaved={() => undefined}
          onCancel={() => undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ExaminationForm", () => {
  it("DR35 §11: the sample is ALWAYS a new selection — no REUSE default", () => {
    expect(initialSample(null, [collection], "2026-11-07")).toMatchObject({
      mode: "NEW",
      massKg: "0.8",
      collectedOn: "2026-11-07",
    });
    expect(initialSample(null, [], "2026-11-07")).toMatchObject({ mode: "NEW", massKg: "0.8" });
  });

  it("DR55 §5.2: the date, the mass and the checkbox live in «Проба», not «Итог экспертизы»", () => {
    renderForm();
    const sample = within(screen.getByLabelText("Проба"));
    expect(sample.getByLabelText("Дата отбора проб")).toBeTruthy();
    expect((sample.getByLabelText("Дата отбора проб") as HTMLInputElement).max).toBe("2026-11-07");
    expect(sample.getByLabelText("Вес взятой пробы, кг")).toBeTruthy();
    expect(sample.getByRole("checkbox", { name: /Пробы отправлены/ })).toBeTruthy();
    const outcome = within(screen.getByLabelText("Итог экспертизы"));
    expect(outcome.queryByLabelText("Дата отбора проб")).toBeNull();
    expect(outcome.queryByRole("checkbox", { name: /Пробы отправлены/ })).toBeNull();
    // The stale hint of the moved field is gone.
    expect(screen.queryByText(/Дата отбора указывается в секции/)).toBeNull();
  });

  it("renders two strictly separate create actions and never a draft button", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Отправить в ожидание результата" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Завершить ВСЭ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /черновик/i })).toBeNull();
    expect(screen.queryByLabelText(/части туш|голов|органов/i)).toBeNull();
    expect(screen.queryByText(/Условно-пригодно/)).toBeNull();
  });

  it("DR35 §11: the «Использовать имеющуюся пробу» mode is gone", () => {
    renderForm([collection]);
    expect(screen.queryByText(/Использовать имеющуюся пробу/)).toBeNull();
    expect(screen.queryByRole("radio", { name: /имеющуюся пробу/ })).toBeNull();
    expect(screen.getByText("Новый отбор пробы этой партии.")).toBeTruthy();
  });

  it("DR35 §8: the confirm-note phrase is gone", () => {
    renderForm();
    expect(screen.queryByText("Партия подтверждена внешним результатом")).toBeNull();
  });

  it("DR35 §5: both participant cards use Предприятие/Хозяйствующий субъект", () => {
    renderForm();
    const sender = screen.getByLabelText("Сведения об отправителе");
    const receiver = screen.getByLabelText("Сведения о получателе");
    // The mockup readonly facts are readonly inputs; the value lives on the control.
    expect((within(sender).getByLabelText("Предприятие") as HTMLInputElement).value).toBe("Предприятие-1");
    expect((within(sender).getByLabelText("Хозяйствующий субъект") as HTMLInputElement).value).toBe("ХС-1");
    expect((within(receiver).getByLabelText("Предприятие") as HTMLInputElement).value).toBe("Предприятие-2");
    expect((within(receiver).getByLabelText("Хозяйствующий субъект") as HTMLInputElement).value).toBe("ХС-2");
  });

  it("DR35 §6/§7: the product type is Russian and the accepted numbers are human-readable", () => {
    renderForm();
    expect((screen.getByLabelText("Тип продукции") as HTMLInputElement).value).toBe("Мясо и мясопродукты");
    expect((screen.getByLabelText("Принятый вес, кг") as HTMLInputElement).value).toBe("100");
    expect((screen.getByLabelText("Принятое количество мест, шт.") as HTMLInputElement).value).toBe("4");
    // No technical GUID anywhere near the accepted quantity.
    expect(screen.queryByText(/bbbbbbbb-bbbb/)).toBeNull();
  });

  it("DR35 §9: a required trichinelloscopy card cannot be removed and is not in the add zone", () => {
    renderForm([], {
      formView: {
        ...formView,
        required_research_ids: [TRICHINELLA_INDICATOR_ID],
      },
    });
    const select = screen.getByRole("button", { name: /Трихинеллоскопия/ });
    expect(select).toBeTruthy();
    expect(select.textContent).toContain("Выберите результат");
    expect(screen.queryByRole("button", { name: "Удалить трихинеллоскопию" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Добавить трихинеллоскопию" })).toBeNull();
  });

  it("adds and removes an optional research through accessible names", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Добавить бактериоскопию" }));
    expect(screen.getByRole("textbox", { name: "Бактериоскопия" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Удалить бактериоскопию" }));
    expect(screen.queryByRole("textbox", { name: "Бактериоскопия" })).toBeNull();
  });

  it("the cooking test offers exactly five variants and no «Иное» (ТЗ DR54 Task 6)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Добавить пробу варки" }));
    // The five allowed variants are in the shared SelectDropdown; «Иное
    // (указать)» and the «Поясните результат» input no longer exist.
    await user.click(screen.getByRole("button", { name: /Проба варки/ }));
    const options = await screen.findAllByRole("option");
    const labels = options.map((node) => node.textContent ?? "");
    expect(labels.filter((label) => label.trim() !== "")).toEqual([
      "Бульон прозрачный, аромат специфический",
      "Бульон мутный",
      "Бульон с хлопьями",
      "Бульон с осадком",
      "Нехарактерный / неприятный запах",
    ]);
    expect(labels.some((label) => label.includes("Иное"))).toBe(false);
    await user.click(options[1]);
    expect(screen.queryByRole("textbox", { name: /Поясните результат|пояснение/ })).toBeNull();
  });

  it("adds and removes a disease row through accessible names", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Добавить незаразное заболевание" }));
    expect(screen.getByRole("button", { name: /Незаразные болезни: наименование болезни/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Удалить незаразное заболевание 1" }));
    expect(screen.queryByRole("button", { name: /Незаразные болезни: наименование болезни/ })).toBeNull();
  });

  it("DR35 §12.3: the scoped specialist is prefilled and visible without UUIDs", () => {
    renderForm();
    const select = screen.getByRole("button", { name: /Специалист Госветслужбы/ });
    expect((select as HTMLElement).className).not.toContain("is-placeholder");
    expect(select.textContent).toContain("Врач Ветеринарный");
    expect(screen.queryByText(new RegExp(ME))).toBeNull();
  });

  it("WAITING without the sent-to-lab mark is refused with a readable message", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseOption(user, /Органолептическое исследование/, "Соответствует");
    await chooseOption(user, /Идентификация продукции/, "Соответствует");
    await user.type(screen.getByRole("textbox", { name: "Температура в толще мышц, °C" }), "2.0");
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
    await chooseOption(user, /Органолептическое исследование/, "Соответствует");
    await chooseOption(user, /Идентификация продукции/, "Соответствует");
    await user.type(screen.getByRole("textbox", { name: "Температура в толще мышц, °C" }), "2.0");
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
    await chooseOption(user, /Органолептическое исследование/, "Соответствует");
    await chooseOption(user, /Идентификация продукции/, "Соответствует");
    await user.type(screen.getByRole("textbox", { name: "Температура в толще мышц, °C" }), "2.0");
    await user.click(screen.getByRole("button", { name: "Отправить в ожидание результата" }));
    expect(await screen.findByText(/Не удалось сохранить ВСЭ|Ошибка соединения/)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Номер ВСЭ *" }) as HTMLInputElement).value).toBe("№ 900");
    expect(screen.queryByText(/сохранена/i)).toBeNull();
  });

  it("DR42 fix-loop: an intermediate decimal input never travels into the preview", () => {
    const temperatureId = INDICATORS.find((def) => def.code === "VSE-F20")?.id ?? "";
    // «2,» is the user still typing the fraction — nothing is sent.
    expect(toResearchValue(temperatureId, "DECIMAL", "2,", "")).toBeNull();
    expect(toResearchValue(temperatureId, "DECIMAL", "2.", "")).toBeNull();
    expect(toResearchValue(temperatureId, "DECIMAL", "2, ", "")).toBeNull();
    // A completed value keeps the comma→dot normalization.
    expect(toResearchValue(temperatureId, "DECIMAL", "2,5", "")).toMatchObject({
      indicatorId: temperatureId,
      kind: "DECIMAL",
      value: "2.5",
    });
    expect(toResearchValue(temperatureId, "DECIMAL", "2", "")).toMatchObject({ value: "2" });
  });
});

describe("ExaminationForm VSE-only waiver (ТЗ DR52 §3)", () => {
  const previewBodies: { vseFair?: boolean }[] = [];

  function usePreviewHandler(total: string, delay = 0): void {
    server.use(
      http.post(
        "*/api/v1/examinations/parties/*/pricing-preview",
        async ({ request }) => {
          const body = (await request.json()) as { vseFair?: boolean };
          previewBodies.push(body);
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          return HttpResponse.json(
            {
              snapshot: { lines: [], total, currency: "RUB", fair: body.vseFair ?? false },
              accepted_quantity: "4",
              accepted_unit_id: "шт",
              fair: body.vseFair ?? false,
              fair_source: body.vseFair ? "EXAMINATION" : "NONE",
              revision: 1,
            },
            { status: 200 },
          );
        },
      ),
    );
  }

  it("the checkbox is available, speaks honestly and toggles a NEW preview with vseFair", async () => {
    const user = userEvent.setup();
    usePreviewHandler("120.00");
    renderForm();
    await user.type(screen.getByRole("textbox", { name: /Температура в толще мышц/ }), "2.5");
    const waiver = (await screen.findByTestId("pricing-waiver")).querySelector("input");
    expect(waiver).not.toBeNull();
    expect(waiver?.checked).toBe(false);
    expect(screen.getByText(/Стоимость сверки данных не изменится/)).toBeTruthy();
    await user.click(waiver as HTMLElement);
    await screen.findByText(/0,00 ₽/);
    await waitFor(() => expect(previewBodies.some((body) => body.vseFair === true)).toBe(true));
    // Toggling back restores the regular server total, not a fabricated zero.
    await user.click(waiver as HTMLElement);
    await screen.findByText(/120,00 ₽/);
    await waitFor(() =>
      expect(previewBodies[previewBodies.length - 1]?.vseFair).toBe(false),
    );
  });

  it("the save is disabled while the preview recalculates", async () => {
    const user = userEvent.setup();
    usePreviewHandler("0.00", 500);
    renderForm();
    await user.type(screen.getByRole("textbox", { name: /Температура в толще мышц/ }), "2.5");
    const waiver = await screen.findByTestId("pricing-waiver");
    await user.click(waiver.querySelector("input") as HTMLElement);
    await waitFor(() => expect(screen.getByRole("button", { name: "Завершить ВСЭ" })).toBeDisabled());
    await screen.findByText(/0,00 ₽/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Завершить ВСЭ" })).not.toBeDisabled());
  });

  it("the inherited free rule is checked, disabled and separately explained", async () => {
    const user = userEvent.setup();
    usePreviewHandler("0.00");
    renderForm([], { formView: { ...formView, reconciliation_fair: true } });
    await user.type(screen.getByRole("textbox", { name: /Температура в толще мышц/ }), "2.5");
    const waiver = (await screen.findByTestId("pricing-waiver")).querySelector("input");
    expect(waiver?.checked).toBe(true);
    expect(waiver?.disabled).toBe(true);
    expect(screen.getByText(/Бесплатность установлена при сверке данных/)).toBeTruthy();
  });
});
