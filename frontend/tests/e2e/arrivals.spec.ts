/**
 * Arrivals e2e (A01, MSW-style route mocks — real API e2e is not required in
 * this task): URL-context queues, real-ID navigation into the real A02
 * reconciliation screen and back, the VET/HEAD-only sync button, and the
 * 390/1440 screens.
 */
import { expect, test, type Page } from "@playwright/test";

const LAB = "11111111-2222-4333-8444-555555555555";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const singleView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentNumber: "RU016:260812-005102",
      issuedOn: "2026-08-12T08:40:00",
      transportNumber: "А245КМ 116",
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
  documentary: { mass_kg: "486.5", quantity: "3", unit_id: "u" },
  confirmation: null,
  queue: "EXPECTED",
  examination_id: null,
  revision: 1,
};

const reconciliationView = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001",
  party_id: PARTY,
  revision: 1,
  state: "OPEN",
  checks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "0", quantity: "0", unit_id: "u" },
  accepted: { mass_kg: "0", quantity: "0", unit_id: "u" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "u" },
  decision: null,
  returnReason: null,
  repeat: null,
  transaction: { planned: null, type: null },
  fair: false,
  services: [],
  actor_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  saved_at: "2026-11-09T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: "EXAMINATION",
  errors: [],
  complete: false,
};

function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: `test-results/a01-${name}.png`, fullPage: true });
}

async function mockSessionAndArrivals(page: Page): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: "Кузнецова Алиса Викторовна",
        login: "kuznetsova",
        email: "kuznetsova@lab.tatar",
        position: "Ветеринарный врач",
        role: "VET",
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: ["arrivals:read"],
        revision: 3,
      }),
    }),
  );
  await page.route("**/api/v1/arrivals?*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("laboratory_id") !== LAB) {
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "ACCESS_DENIED" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: url.searchParams.get("queue") === "EXPECTED" ? [singleView] : [],
        total: url.searchParams.get("queue") === "EXPECTED" ? 1 : 0,
        page: 1,
        page_size: 20,
      }),
    });
  });
  // The A02 reconciliation screen reads the W03 receipt stage on mount; with
  // the real backend running an unmocked call answers 401 and kills the
  // session, so the stage is mocked here like every other arrival read.
  await page.route("**/api/v1/arrivals/*/receipt-context", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        write_enabled: false,
        source_revision: null,
        reconciliation_revision: null,
        operation_id: null,
        operation_state: null,
      }),
    }),
  );
}

test.describe("arrivals", () => {
  test("test_real_id_navigation_preserves_url_context", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByRole("heading", { name: "Поступления" })).toBeVisible();
    await expect(page.getByText("говядина")).toBeVisible();
    await shot(page, "list-1440");

    // The sync button is VET/HEAD only; the job itself is e2e-proven in
    // vetis-read.spec.ts (ТЗ-10 V02).
    const update = page.getByRole("button", { name: "Обновить" });
    await expect(update).toBeEnabled();

    // Row navigation by the REAL party id; the real A02 reconciliation screen
    // loads the single read (mocked here) and renders the CHK form.
    await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(singleView) }),
    );
    await page.route(`**/api/v1/arrivals/${PARTY}/reconciliation`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reconciliationView),
      }),
    );
    await page.getByRole("link", { name: "12.08.2026 08:40" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`));
    await expect(page.getByRole("heading", { name: "Сверка данных транспортного эВСД" })).toBeVisible();
    await shot(page, "reconciliation-placeholder-1440");

    // Back: the URL context (queue filter) survives.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/arrivals\\?queue=expected`));
    await expect(page.getByText("говядина")).toBeVisible();
  });

  test("narrow screen keeps the controls stacked", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/labs/${LAB}/arrivals`);
    await expect(page.getByText("говядина")).toBeVisible();
    const search = page.getByLabel("Поиск");
    const box = (await search.boundingBox()) ?? { width: 0 };
    expect(box.width).toBeGreaterThan(200);
    await shot(page, "list-390");
  });

  test("test_explicit_reconciliation_action_mouse_keyboard_and_narrow", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(singleView) }),
    );
    await page.route(`**/api/v1/arrivals/${PARTY}/reconciliation`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reconciliationView),
      }),
    );

    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByRole("heading", { name: "Поступления" })).toBeVisible();

    // The explicit action in the last column; the hide button is separate.
    const action = page.getByRole("link", { name: "Перейти к сверке данных" });
    await expect(action).toBeVisible();
    // The icon action renders as the mockup's square icon button (40×40, r11),
    // not as a bare inline SVG.
    const actionBox = (await action.boundingBox())!;
    expect(Math.round(actionBox.width)).toBe(40);
    expect(Math.round(actionBox.height)).toBe(40);
    expect(await action.evaluate((node) => getComputedStyle(node).borderRadius)).toBe("11px");
    expect(await action.evaluate((node) => getComputedStyle(node).borderStyle)).toBe("solid");
    await expect(page.getByRole("button", { name: "Скрыть поступление из очереди" })).toBeVisible();
    await page.screenshot({
      path: "../docs/implementation/evidence/DR-arrivals-action-row-1440.png",
      fullPage: true,
    });

    // Mouse click → the reconciliation route of the SAME party (real party_id).
    await action.click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`));
    await expect(page.getByRole("heading", { name: "Сверка данных транспортного эВСД" })).toBeVisible();
    await expect(page.getByText("Отруба говяжьи")).toBeVisible();
    await page.screenshot({
      path: "../docs/implementation/evidence/DR-arrivals-action-reconciliation-1440.png",
      fullPage: true,
    });

    // Return with queue/search/page preserved (FT-COM-02).
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/arrivals\\?queue=expected`));
    await expect(page.getByText("говядина")).toBeVisible();

    // Keyboard: sequential focus reaches the action; Enter navigates.
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`));
  });

  test("narrow screen keeps the explicit action reachable with long values", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("laboratory_id") !== LAB) {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: "ACCESS_DENIED" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              ...singleView,
              external: {
                ...singleView.external,
                fields: {
                  ...singleView.external.fields,
                  consignor:
                    "Общество с ограниченной ответственностью «Агрофирма Свободный Труд имени двадцатилетия Татарской Автономной Советской Социалистической Республики»",
                },
              },
            },
          ],
          total: 1,
          page: 1,
          page_size: 20,
        }),
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    const action = page.getByRole("link", { name: "Перейти к сверке данных" });
    await expect(action).toBeVisible();
    await page.screenshot({
      path: "../docs/implementation/evidence/DR-arrivals-action-row-390.png",
      fullPage: true,
    });
    // The action stays clickable: horizontal scroll belongs to the table, not the page.
    expect((await action.boundingBox())!.width).toBeGreaterThan(0);
    await expect(page.getByText(/Агрофирма Свободный Труд/)).toBeVisible();
  });

  /** Queue-aware /arrivals override: one row per stage for control shots. */
  function workRowFixture() {
    return {
      ...singleView,
      queue: "WORK",
      confirmation: {
        id: "55555555-1111-4222-8333-444444444444",
        accepted_mass_kg: "486.500000",
        accepted_quantity: "3.000000",
        accepted_unit_id: "u",
        returned_mass_kg: "0.000000",
        returned_quantity: "0.000000",
        confirmed_at: "2026-08-12T11:40:00Z",
      },
      examination_id: null,
    };
  }

  function acceptedRowFixture() {
    return {
      ...singleView,
      queue: "ACCEPTED",
      confirmation: workRowFixture().confirmation,
      examination_id: "77777777-1111-4222-8333-444444444444",
    };
  }

  async function mockStageRows(page: Page): Promise<void> {
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("laboratory_id") !== LAB) {
        return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
      }
      const queue = url.searchParams.get("queue") ?? "EXPECTED";
      const item =
        queue === "EXPECTED" ? singleView : queue === "WORK" ? workRowFixture() : acceptedRowFixture();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [item], total: 1, page: 1, page_size: 20 }),
      });
    });
  }

  test("control screenshots of the three stages, wide and narrow, no document overflow", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await mockStageRows(page);

    for (const [stage, label] of [
      ["expected", "expected"],
      ["work", "work"],
      ["accepted", "accepted"],
    ] as const) {
      await page.goto(`/labs/${LAB}/arrivals?queue=${stage}`);
      await expect(page.getByText("RU016:260812-005102")).toBeVisible();
      await page.screenshot({
        path: `../docs/implementation/evidence/DR3-arrivals-${label}-1440.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      // No horizontal document overflow on the narrow screen.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: `../docs/implementation/evidence/DR3-arrivals-${label}-390.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });

  test("the accepted stage keeps the column chooser keyboard-accessible", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await mockStageRows(page);
    await page.goto(`/labs/${LAB}/arrivals?queue=accepted`);
    await expect(page.getByText("RU016:260812-005102")).toBeVisible();
    const trigger = page.getByRole("button", { name: "Выбрать столбцы таблицы" });
    await trigger.click();
    await expect(page.getByRole("group", { name: "Столбцы таблицы" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Столбцы таблицы" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  // --- DR7 §10.3 e2e: ALL matching incoming VSDs are displayed -----------------

  test("two matching incoming VSDs render two rows from the two-item fixture", async ({ page }) => {
    await mockSessionAndArrivals(page);
    const second = {
      ...singleView,
      party_id: "9c1b2d3e-2222-4222-8333-444444444444",
      external: {
        ...singleView.external,
        evsd_uuid: "2f0e6d2a-1111-4222-8333-444444444444",
        fields: { ...singleView.external.fields, documentNumber: "RU016:260812-005103" },
      },
      classification: {
        ...singleView.classification,
        product: { ...singleView.classification.product, name: "свинина" },
      },
    };
    await page.route("**/api/v1/arrivals?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [singleView, second], total: 2, page: 1, page_size: 20 }),
      }),
    );
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByText("говядина")).toBeVisible();
    await expect(page.getByText("свинина")).toBeVisible();
  });

  test("21 records paginate: page 2 keeps the remaining row", async ({ page }) => {
    await mockSessionAndArrivals(page);
    const twenty = Array.from({ length: 20 }, (_unused, index) => ({
      ...singleView,
      party_id: `9c1b2d3e-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    const last = {
      ...singleView,
      party_id: "9c1b2d3e-0000-4000-8000-999999999999",
      classification: {
        ...singleView.classification,
        product: { ...singleView.classification.product, name: "свинина" },
      },
    };
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: pageNumber === 1 ? twenty : [last],
          total: 21,
          page: pageNumber,
          page_size: 20,
        }),
      });
    });
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByText("говядина")).toHaveCount(20);
    await page.getByRole("button", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("свинина")).toBeVisible();
  });
});
