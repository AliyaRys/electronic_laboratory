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
  await expect(page.getByRole("heading", { name: "Новая запись ВСЭ" })).toBeVisible();
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
  test("REUSE is the default sample mode and the create actions are strictly separate", async ({ page }) => {
    const posts: unknown[] = [];
    await openCreate(page, posts);
    // Header shows the session user; the party facts are readonly.
    await expect(page.getByText("Специалист: Кузнецова Алиса Викторовна")).toBeVisible();
    await expect(page.getByText("RU016:260807-002914")).toBeVisible();
    await expect(page.getByText("140.5").first()).toBeVisible();
    // REUSE is preselected with the available collection of the same party.
    await expect(page.getByLabel("Доступная проба")).toHaveValue(COLLECTION);
    await expect(page.getByLabel("Вес взятой пробы, кг")).toHaveCount(0);
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
    expect(payload["sample"]).toEqual({ mode: "REUSE", collectionId: COLLECTION });
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
    await expect(page.getByLabel("Использовать имеющуюся пробу")).toBeDisabled();
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
    await expect(page.getByLabel("Направление по результатам ВСЭ *")).toBeDisabled();
    await page.getByRole("radio", { name: "Пригодно", exact: true }).check();
    await expect(page.getByLabel("Направление по результатам ВСЭ *")).toHaveValue("SALE");
    await page.getByRole("button", { name: "Завершить ВСЭ" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/examinations/${EXAM}`));
    const payload = posts[0] as Record<string, unknown>;
    expect(payload["mode"]).toBe("COMPLETED");
    expect(payload["outcome"]).toBe("FIT");
    expect(payload["direction"]).toBe("SALE");
    expect(payload["reason"]).toBeNull();
    await expect(page.getByText("Пригодно · В реализацию без ограничений")).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Новая запись ВСЭ" })).toBeVisible();
    await page.getByLabel("Номер ВСЭ *").fill("№ 13/2026");
    await page.getByLabel("Маркировка — ветеринарное клеймо лаборатории *").fill("кл-2");
    await page.getByLabel("Органолептическое исследование").selectOption("MATCH");
    await page.getByLabel("Идентификация продукции").selectOption("MATCH");
    await page.getByLabel("Температура в толще мышц, °C").fill("3");
    await page.getByRole("radio", { name: "Пригодно", exact: true }).check();
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
    await expect(page.getByRole("heading", { name: "Карточка ВСЭ № 12/2026" })).toBeVisible();
    // No conclusion while WAITING (SC-047): no outcome text, no reason, no
    // print/download affordance, and an old card offers no edit/delete.
    await expect(page.getByText("В реализацию без ограничений")).toHaveCount(0);
    await expect(page.getByText("Условно-пригодно")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /заключени|печать|скачат/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Исправить карточку" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Удалить" })).toHaveCount(0);
    // The late outcome is one explicit action with its own payload only.
    await page.getByRole("radio", { name: "Пригодно", exact: true }).check();
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
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      const status = url.searchParams.get("result") ?? "WAITING";
      const items = status === "WAITING" ? [{ ...partyView, examination_id: EXAM }] : [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items, total: items.length, page: 1, page_size: 20 }),
      });
    });
    await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...partyView, examination_id: EXAM }),
      }),
    );
    await mockExamination(page, card());
    await page.goto(`/labs/${LAB}/examinations`);
    await expect(page.getByRole("heading", { name: "Журнал ВСЭ" })).toBeVisible();
    // The waiting tab lists the card with a visible status badge.
    await expect(page.getByRole("tab", { name: "Ожидание результатов" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("RU016:260807-002914")).toBeVisible();
    await expect(page.getByText("Ожидание результатов").nth(1)).toBeVisible();
    await page.getByRole("link", { name: /Просмотр карточки ВСЭ/ }).click();
    await expect(page).toHaveURL(new RegExp(`/examinations/${EXAM}`));
    // Back to the journal: the completed tab queries the other projection.
    await page.goBack();
    await page.getByRole("tab", { name: "Завершённые" }).click();
    await expect(page).toHaveURL(/status=COMPLETED/);
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
    await shot(page, "narrow-390");
  });
});
