/**
 * Examination lifecycle e2e (E04, MSW-style route mocks — the same honest
 * pattern as arrivals.spec.ts/samples.spec.ts; the real-API leg is not
 * available in this task's environment and is documented in the evidence
 * file): the strictly separate create actions (wait / complete), the
 * REUSE sample default, the WAITING card without a conclusion, the explicit
 * late outcome, the delete dialog with the 409 stale-refresh, the 409 that
 * preserves the input, the dirty-leave dialog and the journal tabs.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const EXAM = "e0000000-0000-4000-8000-000000000001";
const COLLECTION = "44444444-4444-4444-8444-444444444444";

function shot(page: Page, name: string): Promise<void> {
  return page.screenshot({ path: `test-results/e04-${name}.png`, fullPage: true }).then(() => undefined);
}

const partyView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentUuid: "1c0d1a2b-1111-4222-8333-444444444444",
      issuedOn: "2026-08-07",
      documentNumber: "RU016:260807-002914",
      documentIssuedOn: "2026-08-07",
      consignor: "КФХ Шайдуллин Азат Рашидович",
      consignorOwner: "Шайдуллин Азат Рашидович",
      consignee: "АО «Агропромышленный парк „Казань“»",
      consigneeOwner: "Хусаинова Зельфия Тимергалиевна",
    },
  },
  classification: {
    productType: "Мясо и субпродукты",
    product: { id: "p", name: "Мясо и мясопродукты" },
    subProduct: { id: "sp", name: "Говядина" },
    productItem: { id: "pi", name: "Говядина в четвертинах охлаждённая" },
    unit: { id: "u", name: "штука" },
  },
  documentary: { mass_kg: "140.5", quantity: "2", unit_id: "шт" },
  confirmation: {
    id: "c1000000-0000-4000-8000-000000000001",
    accepted_mass_kg: "140.5",
    accepted_quantity: "2",
    accepted_unit_id: "шт",
    returned_mass_kg: "0",
    returned_quantity: "0",
    confirmed_at: "2026-11-07T10:00:00Z",
  },
  queue: "WORK",
  examination_id: null as string | null,
  revision: 1,
};

function card(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EXAM,
    party_id: PARTY,
    laboratory_id: LAB,
    number: "№ 12/2026",
    stamp: "кл-1471",
    status: "WAITING",
    sent_to_lab: true,
    researches: [
      { indicatorId: "c8d1e50e-bf49-5475-bb82-860f6fc47e74", kind: "ENUM", value: "MATCH" },
      { indicatorId: "5410ca53-ffae-5a27-ab8d-51cb20fe4011", kind: "ENUM", value: "MATCH" },
      { indicatorId: "ec2fba68-e4d1-5c82-9591-92ee9da5293e", kind: "DECIMAL", value: "4.5" },
    ],
    invasive_findings: [],
    noncontagious_findings: [],
    pricing: { lines: [], total: "250.00", currency: "RUB", fair: false },
    sample_collection_id: COLLECTION,
    // DR44 Task 3: the linked physical sample fact of the card (GET contract).
    sample: {
      id: COLLECTION,
      collected_on: "2026-11-06",
      mass_kg: "12.6",
      revision: 1,
    },
    outcome: null,
    direction: null,
    reason: null,
    created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    created_at: new Date().toISOString(),
    first_completed_at: null,
    revision: 1,
    ...overrides,
  };
}

const collection = {
  id: COLLECTION,
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

async function mockMe(page: Page, role = "VET"): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: role === "VET" ? "Кузнецова Алиса Викторовна" : "Аналитик Татарстана",
        login: role === "VET" ? "kuznetsova" : "analyst",
        email: "user@lab.tatar",
        position: null,
        role,
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: [],
        revision: 3,
      }),
    }),
  );
}

/** The confirmed party (exact path) — registered LAST so it wins over the list glob. */
async function mockParty(page: Page): Promise<void> {
  await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(partyView) }),
  );
}

async function mockCollections(page: Page, items: unknown[]): Promise<void> {
  await page.route("**/api/v1/samples/collections*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, total: items.length, page: 1, page_size: 20 }),
    }),
  );
}

/** DR35 §4: the frozen reconciliation read model — the single read source of
 * the create page. Without this mock the page cannot render its form. */
const REQUIRED_RESEARCH_IDS = [
  "c8d1e50e-bf49-5475-bb82-860f6fc47e74",
  "5410ca53-ffae-5a27-ab8d-51cb20fe4011",
  "ec2fba68-e4d1-5c82-9591-92ee9da5293e",
];

const formView = {
  party_id: PARTY,
  laboratory_id: LAB,
  participants: {
    senderOwner: { name: "Шайдуллин Азат Рашидович", state: "SOURCE_XML" },
    senderEnterprise: { name: "КФХ Шайдуллин Азат Рашидович", state: "SOURCE_XML" },
    receiverOwner: { name: "Хусаинова Зельфия Тимергалиевна", state: "SOURCE_XML" },
    receiverEnterprise: { name: "АО «Агропромышленный парк „Казань“»", state: "SOURCE_XML" },
  },
  product: { id: "p", name: "Мясо и мясопродукты" },
  sub_product: { id: "sp", name: "Говядина" },
  product_item: { id: "pi", name: "Говядина в четвертинах охлаждённая" },
  unit: { id: "u", name: "штука" },
  product_type: 1,
  product_type_label: "Мясо и мясопродукты",
  accepted: { massKg: "140.5", quantity: "2", unitId: "шт", unitName: "штука" },
  required_research_ids: REQUIRED_RESEARCH_IDS,
  eligible_specialists: [{ id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", fullName: "Кузнецова Алиса Викторовна" }],
  source_revision: "3f0e6d2a-1111-4222-8333-444444444444",
  reconciliation_revision: 1,
  revision: 1,
};

async function mockForm(page: Page): Promise<void> {
  await page.route(`**/api/v1/examinations/parties/${PARTY}/form`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(formView) }),
  );
}

/** ТЗ DR42 §13: the live pricing preview of the form (read/compute only). */
async function mockPricingPreview(page: Page): Promise<void> {
  await page.route(`**/api/v1/examinations/parties/${PARTY}/pricing-preview`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        snapshot: { lines: [], total: "0.00", currency: "RUB", fair: false },
        acceptedQuantity: "2",
        acceptedUnitId: "шт",
        fair: false,
        revision: 1,
      }),
    }),
  );
}

async function mockExamination(page: Page, view: Record<string, unknown>): Promise<void> {
  await page.route(`**/api/v1/examinations/${EXAM}`, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(view) });
    }
    return route.fulfill({ status: 405, contentType: "application/json", body: "{}" });
  });
}

async function openCreate(
  page: Page,
  posts: unknown[],
  collections: unknown[] = [collection],
  responseView: Record<string, unknown> = card(),
): Promise<void> {
  await mockMe(page);
  await mockCollections(page, collections);
  await mockForm(page);
  await mockPricingPreview(page);
  // The journal/list projection glob is registered first; the exact party
  // path handler wins for the single-party fetches.
  await page.route("**/api/v1/arrivals?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
    }),
  );
  await mockParty(page);
  await page.route(`**/api/v1/examinations/parties/${PARTY}`, (route) => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseView),
    });
  });
  await mockExamination(page, responseView);
  await page.goto(`/labs/${LAB}/arrivals/${PARTY}/examination/new`);
  await expect(page.getByRole("heading", { name: "Создание карточки ВСЭ" })).toBeVisible();
}

/** Fill the three mandatory researches of the create form. */
async function fillMandatory(page: Page): Promise<void> {
  await page.getByLabel("Номер ВСЭ *").fill("№ 12/2026");
  await page.getByLabel("Маркировка — ветеринарное клеймо лаборатории *").fill("кл-1471");
  await page.getByLabel("Органолептическое исследование").selectOption("MATCH");
  await page.getByLabel("Идентификация продукции").selectOption("MATCH");
  await page.getByLabel("Температура в толще мышц, °C").fill("4.5");
}

test.describe("examination lifecycle", () => {
  test("a create performs a fresh NEW sample and the create actions are strictly separate", async ({ page }) => {
    const posts: unknown[] = [];
    const today = new Date().toISOString().slice(0, 10);
    await openCreate(page, posts);
    // The party facts are readonly; the specialist is a session fact.
    await expect(page.getByText("Новая запись")).toBeVisible();
    await expect(page.getByLabel("UUID ВСД")).toHaveValue("1c0d1a2b-1111-4222-8333-444444444444");
    await expect(page.getByLabel("Принятый вес, кг")).toHaveValue("140,5");
    await expect(page.getByLabel("Предприятие").first()).toHaveValue(/Шайдуллин/);
    // DR35 §11.2: a create is always a fresh NEW sampling, 0.8 kg by default.
    await expect(page.getByLabel("Вес взятой пробы, кг")).toHaveValue("0.8");
    await expect(page.getByLabel("Дата отбора проб")).toHaveValue(today);
    await expect(page.getByLabel(/использовать имеющуюся пробу/i)).toHaveCount(0);
    // No draft, no outgoing-document field, no parts/head/organs, no
    // «Условно-пригодно» anywhere on the screen.
    await expect(page.getByRole("button", { name: /черновик/i })).toHaveCount(0);
    await expect(page.getByLabel(/исходящ/i)).toHaveCount(0);
    await expect(page.getByLabel(/части тушки|головы|внутренние органы/i)).toHaveCount(0);
    await expect(page.getByText("Условно-пригодно")).toHaveCount(0);
    await fillMandatory(page);
    // Wait is a separate action: sentToLab must be checked by the doctor, and
    // the mandatory researches must be filled before any create.
    await page
      .getByRole("checkbox", { name: "Пробы отправлены на специальные лабораторные исследования" })
      .check();
    // Wait is a separate action from complete.
    await page.getByRole("button", { name: "Отправить в ожидание результата" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/examinations/${EXAM}`));
    const payload = posts[0] as Record<string, unknown>;
    expect(payload["mode"]).toBe("WAITING");
    expect(payload["sentToLab"]).toBe(true);
    expect(payload["outcome"]).toBeNull();
    expect(payload["direction"]).toBeNull();
    expect(payload["reason"]).toBeNull();
    expect(payload["sample"]).toEqual({ mode: "NEW", collectedOn: today, massKg: "0.8" });
    await shot(page, "create-waiting-view");
  });

  test("a fresh NEW sample defaults to 0.8 кг and today's date when no collection exists", async ({
    page,
  }) => {
    const posts: unknown[] = [];
    await openCreate(page, posts, []);
    const today = new Date().toISOString().slice(0, 10);
    await expect(page.getByLabel("Дата отбора проб")).toHaveValue(today);
    await expect(page.getByLabel("Вес взятой пробы, кг")).toHaveValue("0.8");
    await expect(page.getByLabel(/использовать имеющуюся пробу/i)).toHaveCount(0);
    await shot(page, "create-new-sample");
  });

  test("a COMPLETED create sends the outcome matrix and the view shows the saved result", async ({
    page,
  }) => {
    const posts: unknown[] = [];
    await openCreate(
      page,
      posts,
      [collection],
      card({
        status: "COMPLETED",
        outcome: "FIT",
        direction: "SALE",
        first_completed_at: "2026-11-07T11:00:00Z",
      }),
    );
    await fillMandatory(page);
    // No auto outcome: the block starts empty and the direction is locked.
    await expect(page.getByRole("button", { name: "Направление по результатам ВСЭ * Выберите направление" })).toBeDisabled();
    await page.getByRole("button", { name: /Результат ВСЭ/ }).click();
    await page.getByRole("option", { name: "Пригодно", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Направление по результатам ВСЭ * В реализацию без ограничений" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Завершить ВСЭ" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/examinations/${EXAM}`));
    const payload = posts[0] as Record<string, unknown>;
    expect(payload["mode"]).toBe("COMPLETED");
    expect(payload["outcome"]).toBe("FIT");
    expect(payload["direction"]).toBe("SALE");
    expect(payload["reason"]).toBeNull();
    // The saved card leaves the form: the vse-view renders the honest result.
    await expect(page.getByText("Просмотр записи")).toBeVisible();
    await expect(page.getByLabel("Результат")).toHaveValue("Пригодно · В реализацию без ограничений");
    await shot(page, "completed-view");
  });

  test("a submit without the mandatory researches stays on the form and sends nothing", async ({ page }) => {
    const posts: unknown[] = [];
    await openCreate(page, posts);
    await page.getByLabel("Номер ВСЭ *").fill("№ 12/2026");
    await page.getByRole("button", { name: "Завершить ВСЭ" }).click();
    await expect(page.getByText("Проверьте введённые значения.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/examination/new`));
    expect(posts).toHaveLength(0);
    await shot(page, "validation-error");
  });

  test("a 409 keeps every typed value and offers the actual state", async ({ page }) => {
    const posts: unknown[] = [];
    await mockMe(page);
    await mockCollections(page, []);
    await mockForm(page);
    await mockPricingPreview(page);
    await page.route("**/api/v1/arrivals?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
      }),
    );
    await mockParty(page);
    await page.route(`**/api/v1/examinations/parties/${PARTY}`, (route) => {
      posts.push(route.request().postDataJSON());
      return route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Конфликт ревизии",
          status: 409,
          code: "REVISION_CONFLICT",
          detail: "Партия изменена другим пользователем.",
          trace_id: "t-409",
        }),
      });
    });
    await page.goto(`/labs/${LAB}/arrivals/${PARTY}/examination/new`);
    await expect(page.getByRole("heading", { name: "Создание карточки ВСЭ" })).toBeVisible();
    await page.getByLabel("Номер ВСЭ *").fill("№ 13/2026");
    await page.getByLabel("Маркировка — ветеринарное клеймо лаборатории *").fill("кл-2");
    await page.getByLabel("Органолептическое исследование").selectOption("MATCH");
    await page.getByLabel("Идентификация продукции").selectOption("MATCH");
    await page.getByLabel("Температура в толще мышц, °C").fill("3");
    await page.getByRole("button", { name: /Результат ВСЭ/ }).click();
    await page.getByRole("option", { name: "Пригодно", exact: true }).click();
    await page.getByRole("button", { name: "Завершить ВСЭ" }).click();
    await expect(page.getByText("Карточка изменена другим пользователем.")).toBeVisible(); // The input is never merged or cleared: the doctor sees the typed values.
    await expect(page.getByLabel("Номер ВСЭ *")).toHaveValue("№ 13/2026");
    expect(posts).toHaveLength(1);
    await shot(page, "conflict-409");
  });

  test("a WAITING card shows no conclusion and the late outcome is one separate action", async ({ page }) => {
    const posts: unknown[] = [];
    await mockMe(page);
    await mockCollections(page, []);
    await mockParty(page);
    await mockExamination(page, card({ created_at: "2026-11-01T10:00:00Z" }));
    await page.route(`**/api/v1/examinations/${EXAM}/complete-waiting`, (route) => {
      posts.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          card({
            status: "COMPLETED",
            outcome: "FIT",
            direction: "SALE",
            first_completed_at: "2026-11-07T12:00:00Z",
          }),
        ),
      });
    });
    await page.goto(`/labs/${LAB}/examinations/${EXAM}`);
    // The vse-view title row: eyebrow + «ВСЭ № 12/2026».
    await expect(page.getByText("Просмотр записи")).toBeVisible();
    await expect(page.getByRole("heading", { name: "ВСЭ № 12/2026" })).toBeVisible();
    // No conclusion while WAITING (SC-047): no outcome text, no reason, no
    // print/download affordance, an old card offers no edit/delete, and the
    // honest «итог не указан» note stands in the «Итог экспертизы» section.
    await expect(page.getByText("Итог не указан: карточка ожидает ответа лаборатории.")).toBeVisible();
    await expect(page.getByText("В реализацию без ограничений")).toHaveCount(0);
    await expect(page.getByText("Условно-пригодно")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /заключени|печать|скачат/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Исправить карточку" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Удалить" })).toHaveCount(0);
    // The late outcome is one explicit action with its own payload only.
    await page.getByRole("button", { name: /Результат специальной лаборатории/ }).click();
    await page.getByRole("option", { name: "Пригодно", exact: true }).click();
    await page.getByRole("button", { name: "Завершить ожидание", exact: true }).click();
    await expect(page.getByText("Завершено").first()).toBeVisible();
    expect(posts).toEqual([{ outcome: "FIT", direction: "SALE" }]);
    await shot(page, "late-outcome");
  });

  test("the delete dialog keeps the safe cancel focused and refreshes after a 409", async ({ page }) => {
    let deletes = 0;
    await mockMe(page);
    await mockCollections(page, []);
    await mockParty(page);
    await page.route(`**/api/v1/examinations/${EXAM}`, async (route: Route) => {
      if (route.request().method() !== "DELETE") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(card()) });
      }
      deletes += 1;
      if (deletes === 1) {
        return route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "about:blank",
            title: "Конфликт",
            status: 409,
            code: "REVISION_CONFLICT",
            detail: "Карточка изменена другим пользователем.",
          }),
        });
      }
      return route.fulfill({ status: 204, body: "" });
    });
    await page.goto(`/labs/${LAB}/examinations/${EXAM}`);
    await expect(page.getByRole("button", { name: "Удалить" })).toBeVisible();
    await page.getByRole("button", { name: "Удалить" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The dialog explains irreversibility AND what survives the deletion.
    await expect(dialog.getByText(/Удаление необратимо/)).toBeVisible();
    await expect(
      dialog.getByText(/Внешние документы, физические факты отбора проб и отчёты сохраняются/),
    ).toBeVisible();
    // The safe cancel holds the initial focus.
    await expect(dialog.getByRole("button", { name: "Отмена" })).toBeFocused();
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(dialog).toBeHidden();
    // Reopen and confirm: first a 409 (stale, no silent resend), then success.
    await page.getByRole("button", { name: "Удалить" }).click();
    await dialog.getByRole("button", { name: "Удалить" }).click();
    await expect(dialog.getByText("Карточка изменена другим пользователем.").first()).toBeVisible();
    await expect(dialog.getByText(/Прежнее подтверждение не применено/)).toBeVisible();
    await dialog.getByRole("button", { name: "Подтвердить удаление заново" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/examinations$`));
    expect(deletes).toBe(2);
    await shot(page, "delete-409-then-204");
  });

  test("deleting the card makes the party creatable again and REUSE is the default", async ({ page }) => {
    // The party carries the card until it is deleted; then it is creatable.
    let partyExamId: string | null = EXAM;
    let deleted = false;
    await mockMe(page);
    await mockCollections(page, [collection]);
    await page.route("**/api/v1/arrivals?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
      }),
    );
    await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...partyView, examination_id: partyExamId }),
      }),
    );
    await page.route(`**/api/v1/examinations/${EXAM}`, async (route: Route) => {
      if (route.request().method() !== "DELETE") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(card()) });
      }
      deleted = true;
      partyExamId = null;
      return route.fulfill({ status: 204, body: "" });
    });
    await mockForm(page);
    await mockPricingPreview(page);
    // Step 1: delete the WAITING card through the dialog.
    await page.goto(`/labs/${LAB}/examinations/${EXAM}`);
    await expect(page.getByRole("button", { name: "Удалить" })).toBeVisible();
    await page.getByRole("button", { name: "Удалить" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/examinations$`));
    expect(deleted).toBe(true);
    // Step 2: the party is creatable again — open the create form.
    await page.goto(`/labs/${LAB}/arrivals/${PARTY}/examination/new`);
    await expect(page.getByRole("heading", { name: "Создание карточки ВСЭ" })).toBeVisible();
    // Step 3: DR35 §11.2 — a create is always a fresh NEW sampling (0.8 kg).
    await expect(page.getByLabel("Вес взятой пробы, кг")).toHaveValue("0.8");
    await expect(page.getByLabel(/использовать имеющуюся пробу/i)).toHaveCount(0);
    await shot(page, "delete-then-reuse-create");
  });

  test("a dirty form asks before leaving and the cancel keeps the work", async ({ page }) => {
    const posts: unknown[] = [];
    await openCreate(page, posts);
    await page.getByLabel("Номер ВСЭ *").fill("№ 14/2026");
    await page.getByRole("link", { name: "← Сверка эВСД" }).click();
    const dialog = page.getByRole("dialog", { name: "Несохранённый ввод" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Карточка ВСЭ не сохранён/)).toBeVisible();
    // The safe first action (Остаться) keeps the typed value on the page.
    await dialog.getByRole("button", { name: "Остаться" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("Номер ВСЭ *")).toHaveValue("№ 14/2026");
    // Leaving explicitly proceeds without any hidden save.
    await page.getByRole("link", { name: "← Сверка эВСД" }).click();
    await page
      .getByRole("dialog", { name: "Несохранённый ввод" })
      .getByRole("button", { name: "Покинуть без сохранения" })
      .click();
    await expect(page.getByRole("dialog", { name: "Несохранённый ввод" })).toBeHidden();
    expect(posts).toHaveLength(0);
    await shot(page, "dirty-leave");
  });

  test("the journal shows only real cards and the tabs switch the status", async ({ page }) => {
    await mockMe(page);
    // DR45 §2: the journal projection is GET /api/v1/examinations?…
    const journalItem = {
      examination_id: EXAM,
      party_id: PARTY,
      laboratory_id: LAB,
      number: "№ 12/2026",
      stamp: "кл-1471",
      status: "WAITING",
      created_at: "2026-11-07T10:00:00Z",
      first_completed_at: null,
      outcome: null,
      specialist_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
      specialist_name: "Кузнецова Алиса Викторовна",
      evsd_uuid: "1c0d1a2b-1111-4222-8333-444444444444",
      consignor_name: "КФХ Шайдуллин Азат Рашидович",
    };
    await page.route(/\/api\/v1\/examinations\/authors\?/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route(/\/api\/v1\/examinations\?/, (route) => {
      const url = new URL(route.request().url());
      const status = url.searchParams.get("status") ?? "COMPLETED";
      const items = status === "WAITING" ? [journalItem] : [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items, total: items.length, page: 1, page_size: 20 }),
      });
    });
    await mockExamination(page, card());
    // The journal defaults to COMPLETED; the waiting projection is explicit.
    await page.goto(`/labs/${LAB}/examinations?status=WAITING`);
    await expect(page.getByRole("heading", { name: "Журнал ВСЭ мяса и мясопродуктов" })).toBeVisible();
    // The waiting tab lists the card with a visible status badge.
    await expect(page.getByRole("tab", { name: "Ожидание результатов" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("1c0d1a2b-1111-4222-8333-444444444444")).toBeVisible();
    await page.getByRole("link", { name: /Просмотр карточки ВСЭ/ }).click();
    await expect(page).toHaveURL(new RegExp(`/examinations/${EXAM}`));
    // Back to the journal: the completed tab queries the other projection and
    // is honest about the empty result (the plain URL carries no status).
    await page.goto(`/labs/${LAB}/examinations`);
    await expect(page.getByRole("tab", { name: "Завершённые" })).toHaveAttribute("aria-selected", "true");
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByText("Карточек в этом статусе нет.")).toBeVisible();
    await shot(page, "journal-completed");
  });

  test("narrow width keeps the form blocks stacked and reachable", async ({ page }) => {
    const posts: unknown[] = [];
    await openCreate(page, posts);
    await page.setViewportSize({ width: 390, height: 844 });
    const research = await page.getByRole("heading", { name: "Исследования ВСЭ" }).boundingBox();
    const sample = await page.getByRole("heading", { name: "Проба", exact: true }).boundingBox();
    const outcome = await page.getByRole("heading", { name: "Итог экспертизы" }).boundingBox();
    expect(research).not.toBeNull();
    expect(sample).not.toBeNull();
    expect(outcome).not.toBeNull();
    expect((sample as { y: number }).y).toBeGreaterThan((research as { y: number }).y);
    expect((outcome as { y: number }).y).toBeGreaterThan((sample as { y: number }).y);
    // DR30 §7.3: no horizontal page scroll at 390px.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, "narrow-390");
  });

  test("DR30 design parity: mockup composition at 1440 without covered fields", async ({ page }) => {
    const posts: unknown[] = [];
    await openCreate(page, posts);
    // The six mockup sections, in order.
    const titles = [
      "Сведения об экспертизе",
      "Участники и продукция",
      "Исследования ВСЭ",
      "Проба",
      "Итог экспертизы",
      "Расчёт стоимости услуг",
    ];
    let previousY = -1;
    for (const title of titles) {
      const heading = page.getByRole("heading", { name: title, level: 2 });
      await expect(heading).toBeVisible();
      const box = (await heading.boundingBox()) as { y: number };
      expect(box.y).toBeGreaterThan(previousY);
      previousY = box.y;
    }
    // Content width stays inside the mockup's ~1180px working area.
    const width = await page.evaluate(
      () => document.querySelector(".vse-exam-page")?.getBoundingClientRect().width ?? 0,
    );
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(1181);
    // The specialist is a readonly session fact, never a manual select.
    await expect(page.getByRole("button", { name: /Специалист Госветслужбы/ })).toBeDisabled();
    expect(await page.getByRole("combobox", { name: /специалист/i }).count()).toBe(0);
    await expect(page.getByRole("button", { name: /черновик/i })).toHaveCount(0);
    // The sticky action panel never covers the page content at its end.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const inputBox = await page.getByLabel("Принятое количество мест, шт.").boundingBox();
    const panelBox = await page.locator(".vse-exam-actions").boundingBox();
    if (inputBox === null || panelBox === null) throw new Error("panel or input not found");
    expect(panelBox.y - (inputBox.y + inputBox.height)).toBeGreaterThanOrEqual(-1);
    await shot(page, "dr30-parity-1440");
  });

  // --- ТЗ DR44 §4 e2e: the saved-card view matches vse-view -------------------

  test("DR44: the saved COMPLETED FIT view shows sections, researches, sample, outcome, specialist and frozen pricing", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await mockMe(page);
    await mockParty(page);
    await mockExamination(
      page,
      card({
        status: "COMPLETED",
        outcome: "FIT",
        direction: "SALE",
        specialist_name: "Сафина Гульнара Ильдаровна",
        first_completed_at: "2026-11-07T11:00:00Z",
        pricing: {
          lines: [
            {
              service_code: "ec2fba68-e4d1-5c82-9591-92ee9da5293e",
              name: "Температура в толще мышц",
              quantity: "1",
              unit_id: "service",
              unit_price: "5.00",
              amount: "5.00",
            },
          ],
          total: "255.00",
          currency: "RUB",
          fair: false,
        },
      }),
    );
    await page.goto(`/labs/${LAB}/examinations/${EXAM}`);

    // The mockup title row: eyebrow + «ВСЭ № 12/2026».
    await expect(page.getByText("Просмотр записи")).toBeVisible();
    await expect(page.getByRole("heading", { name: "ВСЭ № 12/2026" })).toBeVisible();

    // The six mockup sections, in order.
    const titles = [
      "Сведения об экспертизе",
      "Участники и продукция",
      "Исследования ВСЭ",
      "Проба",
      "Итог экспертизы",
      "Расчёт стоимости услуг",
    ];
    let previousY = -1;
    for (const title of titles) {
      const heading = page.getByRole("heading", { name: title, level: 2 });
      await expect(heading).toBeVisible();
      const box = (await heading.boundingBox()) as { y: number };
      expect(box.y).toBeGreaterThan(previousY);
      previousY = box.y;
    }

    // Researches carry the canonical Russian names, never «Показатель <uuid>».
    await expect(page.getByText("Органолептическое исследование").first()).toBeVisible();
    await expect(page.getByText("Идентификация продукции").first()).toBeVisible();
    await expect(page.getByText("Температура в толще мышц").first()).toBeVisible();
    await expect(page.getByText(/Показатель /)).toHaveCount(0);
    // Typed value formatting matches the create form (4,5 °C).
    await expect(
      page
        .locator('article[data-indicator-id="ec2fba68-e4d1-5c82-9591-92ee9da5293e"]')
        .getByLabel("Сохранённое значение"),
    ).toHaveValue("4,5 °C");

    // The linked physical sample (view.sample), not a generic phrase.
    await expect(page.getByLabel("Дата отбора пробы")).toHaveValue("06.11.2026");
    await expect(page.getByLabel("Масса пробы, кг")).toHaveValue("12,6");
    await expect(page.getByText("Отбор пробы этой партии")).toHaveCount(0);

    // The saved outcome, direction, specialist and first completion.
    await expect(page.getByLabel("Результат")).toHaveValue("Пригодно · В реализацию без ограничений");
    await expect(page.getByLabel("Специалист Госветслужбы")).toHaveValue("Сафина Гульнара Ильдаровна");
    await expect(page.getByLabel("Дата первого завершения")).toHaveValue("07.11.2026 14:00"); // 11:00Z → мск

    // The frozen pricing snapshot: the line and the frozen total, no preview.
    await expect(page.getByText("Итого к оплате")).toBeVisible();
    await expect(page.getByText("255,00 ₽").first()).toBeVisible();
    expect(errors).toEqual([]);
    await shot(page, "dr44-completed-fit-view");
  });
});
