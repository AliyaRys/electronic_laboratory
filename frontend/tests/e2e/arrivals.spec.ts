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

  // --- DR29 §3/§5/§6/§7 e2e: sync group geometry, focus scoping, dialog stacking ---

  test("sync status sits above the refresh button within its width (DR29 §3)", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByText("говядина")).toBeVisible();
    const status = page.locator(".arrivals-sync .arrivals-sync-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveText(/Автообновление из ВетИС каждые 15 минут/);
    const button = page.getByRole("button", { name: "Обновить" });

    const geometry = async (): Promise<{ ok: boolean; details: string }> =>
      page.evaluate(() => {
        const group = document.querySelector(".arrivals-sync");
        const status = group?.querySelector(".arrivals-sync-status");
        const button = group?.querySelector("button");
        if (!group || !(status instanceof HTMLElement) || !(button instanceof HTMLElement)) {
          return { ok: false, details: "missing nodes" };
        }
        const s = status.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        const rightGap = Math.abs(s.right - b.right);
        const withinWidth = s.width <= b.width + 1;
        const belowViewport = document.documentElement.scrollWidth > window.innerWidth;
        return {
          ok: rightGap <= 1 && withinWidth && !belowViewport,
          details: `status=${s.width.toFixed(1)} button=${b.width.toFixed(1)} rightGap=${rightGap.toFixed(1)} overflow=${belowViewport}`,
        };
      });

    for (const width of [1440, 1024, 800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(button).toBeVisible();
      const wide = await geometry();
      if (!wide.ok) throw new Error(`viewport ${width}: ${wide.details}`);
      await shot(page, `dr29-sync-${width}`);
    }

    // 200% zoom (half-size viewport, the layout equivalent): the text still
    // wraps inside the button width and the page never overflows.
    await page.setViewportSize({ width: 720, height: 900 });
    const zoomed = await geometry();
    if (!zoomed.ok) throw new Error(`zoom 200%: ${zoomed.details}`);

    // Busy state changes only the text — the group keeps its geometry source.
    await page.route("**/api/v1/arrivals/sync", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          operation_id: "aaaaaaaa-0000-4000-8000-00000000d001",
          state: "PENDING",
          status_url: "/api/v1/operations/aaaaaaaa-0000-4000-8000-00000000d001",
        }),
      }),
    );
    await page.route("**/api/v1/operations/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "aaaaaaaa-0000-4000-8000-00000000d001",
          kind: "vetis.sync",
          state: "PENDING",
          problem: "VETIS_TRANSPORT_ERROR",
          updated_at: "2026-11-13T10:00:00Z",
        }),
      }),
    );
    await button.click();
    await expect(page.locator(".arrivals-sync .arrivals-sync-status")).toHaveText(/Повторяем обновление/);
    const busy = await geometry();
    if (!busy.ok) throw new Error(`busy: ${busy.details}`);
  });

  test("hide action focus highlight stays on the danger button (DR29 §5.1)", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByText("говядина")).toBeVisible();
    const hide = page.getByRole("button", { name: "Скрыть поступление из очереди" });
    await hide.focus();
    const buttonOutline = await hide.evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(buttonOutline).toBe("solid");
    const group = hide.locator("xpath=..");
    expect(await group.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
    expect(await group.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe("0px");
    expect(await group.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    // The sibling «Сверить» link stays untouched while the button is focused.
    const reconcile = page.getByRole("link", { name: "Перейти к сверке данных" });
    expect(await reconcile.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
    expect(await reconcile.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
      "rgb(255, 255, 255)",
    );
  });

  test("delete dialog renders above the overlay and stays readable (DR29 §6)", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByText("говядина")).toBeVisible();
    await page.getByRole("button", { name: "Скрыть поступление из очереди" }).click();
    const dialog = page.getByRole("dialog", { name: "Скрыть поступление из очереди?" });
    await expect(dialog).toBeVisible();
    const stacking = await page.evaluate(() => {
      const overlay = document.querySelector(".app-dialog-overlay");
      const card = document.querySelector(".app-dialog");
      if (!(overlay instanceof HTMLElement) || !(card instanceof HTMLElement)) {
        return { ok: false, details: "missing nodes" };
      }
      const overlayZ = Number(getComputedStyle(overlay).zIndex);
      const cardZ = Number(getComputedStyle(card).zIndex);
      const overlayRect = overlay.getBoundingClientRect();
      return {
        ok: cardZ > overlayZ && overlayZ >= 1000,
        details: `overlay=${overlayZ} card=${cardZ} overlaySize=${overlayRect.width}x${overlayRect.height}`,
      };
    });
    if (!stacking.ok) throw new Error(stacking.details);
    await expect(dialog.getByRole("button", { name: "Отмена" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Скрыть поступление из очереди" })).toBeFocused();
    await shot(page, "dr29-dialog-1440");
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

  // --- ТЗ DR39 e2e: reconciliation metadata, queue-aware sort, date filter ----

  test("WORK shows the real frozen cost, author and completed date; sorting is server order with URL and F5", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await mockSessionAndArrivals(page);
    const workWithSummary = {
      ...workRowFixture(),
      reconciliation: {
        completed_at: "2026-11-05T07:10:00Z", // 10:10 мск
        author_name: "Иванова Анна Петровна",
        pricing: { lines: [], fair: false, total: "230.00", currency: "RUB" },
      },
    };
    const older = {
      ...workWithSummary,
      party_id: "9c1b2d3e-2222-4222-8333-444444444444",
      reconciliation: {
        completed_at: "2026-11-01T07:10:00Z",
        author_name: "Смирнов Пётр Васильевич",
        pricing: { lines: [], fair: false, total: "0.00", currency: "RUB" },
      },
    };
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("laboratory_id") !== LAB) {
        return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
      }
      const queue = url.searchParams.get("queue") ?? "EXPECTED";
      if (queue !== "WORK") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
        });
      }
      // The SERVER answers in its own order; the page must never re-sort.
      const items =
        url.searchParams.get("sort") === "asc" ? [older, workWithSummary] : [workWithSummary, older];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items, total: 2, page: 1, page_size: 20 }),
      });
    });

    await page.goto(`/labs/${LAB}/arrivals?queue=work&sort=asc`);
    await expect(page.getByText("230,00 ₽")).toBeVisible();
    await expect(page.getByText("Иванова Анна Петровна")).toBeVisible();
    await expect(page.getByText("05.11.2026 10:10")).toBeVisible();
    await expect(page.getByRole("cell", { name: "0,00 ₽", exact: true })).toBeVisible(); // a zero is DATA
    // asc order: the older сверка first (server order kept).
    const cells = await page.locator("tbody tr td:first-child").allTextContents();
    expect(cells).toEqual(["01.11.2026 10:10", "05.11.2026 10:10"]);

    // Switch to desc: URL updates, the order flips.
    await page.getByLabel("Сортировка").selectOption("desc");
    await expect(page).toHaveURL(/queue=work/);
    await expect(page).not.toHaveURL(/sort=asc/);
    await expect(page.locator("tbody tr td:first-child").first()).toHaveText("05.11.2026 10:10");
    // F5 keeps the filter state (desc default: the URL stays clean).
    await page.reload();
    await expect(page.locator("tbody tr td:first-child").first()).toHaveText("05.11.2026 10:10");
    await expect(page.getByText("Иванова Анна Петровна")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("ACCEPTED: apply one день, a range and сбросить; URL and rows survive F5", async ({ page }) => {
    const listReads: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await mockSessionAndArrivals(page);
    const accepted = {
      ...acceptedRowFixture(),
      reconciliation: {
        completed_at: "2026-11-05T21:00:00Z", // 00:00 мск 06.11
        author_name: "Иванова Анна Петровна",
        pricing: { lines: [], fair: false, total: "230.00", currency: "RUB" },
      },
    };
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("laboratory_id") !== LAB) {
        return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
      }
      const queue = url.searchParams.get("queue") ?? "EXPECTED";
      if (queue === "ACCEPTED" && url.searchParams.has("page") === false) listReads.push(url.search);
      if (queue !== "ACCEPTED") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
        });
      }
      // One день exactly: the mock honours the wire filter.
      const on = url.searchParams.get("reconciled_on");
      const filtered = on === "2026-11-06" ? [] : [accepted];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: filtered, total: filtered.length, page: 1, page_size: 20 }),
      });
    });

    await page.goto(`/labs/${LAB}/arrivals?queue=accepted`);
    await expect(page.getByText("06.11.2026 00:00")).toBeVisible();
    await expect(page.getByText("Иванова Анна Петровна")).toBeVisible();

    // Apply one день: the row leaves the result, the URL carries the param.
    await page.getByRole("button", { name: /Дата сверки данных/ }).click();
    await page.getByRole("textbox", { name: "Дата", exact: true }).fill("2026-11-06");
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(page).toHaveURL(/reconciled_on=2026-11-06/);
    await expect(page.getByText(/06\.11\.2026/)).toBeVisible(); // Russian summary
    await expect(page.getByText(/не найдены/)).toBeVisible(); // the honest empty state

    // F5: the filter survives and still filters.
    await page.reload();
    await expect(page).toHaveURL(/reconciled_on=2026-11-06/);
    await expect(page.getByText(/не найдены/)).toBeVisible();

    // Сбросить: all reconciled_* disappear from the URL, the row returns.
    await page.getByRole("button", { name: /Дата сверки данных/ }).click();
    await page.getByRole("button", { name: "Сбросить" }).click();
    await expect(page).not.toHaveURL(/reconciled/);
    await expect(page.getByText("06.11.2026 00:00")).toBeVisible();

    // A range: both bounds go to the wire in the offset ISO form.
    await page.getByRole("button", { name: /Дата сверки данных/ }).click();
    await page.getByRole("radio", { name: "Диапазон" }).click();
    await page.getByLabel("С", { exact: true }).fill("2026-11-05T10:00");
    await page.getByLabel("По", { exact: true }).fill("2026-11-06T18:30");
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(page).toHaveURL(/reconciled_from=2026-11-05T10/);
    await expect(page).toHaveURL(/reconciled_to=/);
    expect(errors).toEqual([]);
  });

  test("the date never leaves ACCEPTED: other queues and tab counters stay clean", async ({ page }) => {
    const reads: string[] = [];
    await mockSessionAndArrivals(page);
    await mockStageRows(page);
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      const queue = url.searchParams.get("queue") ?? "EXPECTED";
      reads.push(url.search);
      const item = queue === "EXPECTED" ? singleView : queue === "WORK" ? workRowFixture() : null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: item ? [item] : [], total: item ? 1 : 0, page: 1, page_size: 20 }),
      });
    });
    // A stale deep link: the params are stripped from the URL and the reads.
    await page.goto(
      `/labs/${LAB}/arrivals?queue=work&reconciled_on=2026-11-06&reconciled_from=2026-11-05T10%3A00%3A00%2B03%3A00`,
    );
    await expect(page.getByText("говядина")).toBeVisible();
    await expect(page).not.toHaveURL(/reconciled/);
    expect(reads.every((entry) => !entry.includes("reconciled"))).toBe(true);
  });

  test("ACCEPTED date filter works on 390 px with the keyboard", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await mockSessionAndArrivals(page);
    await mockStageRows(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/labs/${LAB}/arrivals?queue=accepted`);
    await page.goto(`/labs/${LAB}/arrivals?queue=accepted`);
    await expect(page.getByText("говядина")).toBeVisible();
    const trigger = page.getByRole("button", { name: /Дата сверки данных/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Дата сверки данных" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Дата сверки данных" })).toBeHidden();
    await expect(trigger).toBeFocused();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test("an empty result and a network error keep the honest states", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("queue") === "ACCEPTED") {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "NETWORK", detail: "Сеть недоступна." }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
      });
    });
    await page.goto(`/labs/${LAB}/arrivals?queue=accepted`);
    await expect(page.getByText(/Не удалось загрузить поступления/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  });

  // --- ТЗ DR44 §3 e2e: the completed arrivals row and the saved card -----------

  const EXAM_ID = "77777777-1111-4222-8333-444444444444";

  /** DR44 §2: the compact server-side summary attached to one accepted row. */
  function examSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: EXAM_ID,
      number: "№ 154/2026",
      status: "COMPLETED",
      outcome: "FIT",
      specialist_name: "Сафина Гульнара Ильдаровна",
      pricing: { lines: [], total: "250.00", currency: "RUB", fair: false },
      combined_total: "480.00",
      currency: "RUB",
      ...overrides,
    };
  }

  /** An accepted row whose expiry is an INTERVAL (the type survives the trip). */
  function acceptedWithExam(summary: Record<string, unknown>, fields: Record<string, unknown> = {}) {
    return {
      ...acceptedRowFixture(),
      examination_id: EXAM_ID,
      examination: summary,
      external: {
        ...singleView.external,
        fields: {
          ...singleView.external.fields,
          documentUuid: "1f0e6d2a-1111-4222-8333-444444444444",
          expiresOnFrom: "2026-11-01",
          expiresOnTo: "2026-11-10",
          ...fields,
        },
      },
    };
  }

  function examCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: EXAM_ID,
      party_id: PARTY,
      laboratory_id: LAB,
      number: "№ 154/2026",
      stamp: "кл-1471",
      status: "COMPLETED",
      sent_to_lab: false,
      researches: [{ indicatorId: "c8d1e50e-bf49-5475-bb82-860f6fc47e74", kind: "ENUM", value: "MATCH" }],
      invasive_findings: [],
      noncontagious_findings: [],
      pricing: { lines: [], total: "250.00", currency: "RUB", fair: false },
      sample_collection_id: "44444444-4444-4444-8444-444444444444",
      sample: {
        id: "44444444-4444-4444-8444-444444444444",
        collected_on: "2026-11-05",
        mass_kg: "0.800000",
        revision: 1,
      },
      outcome: "FIT",
      direction: "SALE",
      reason: null,
      specialist_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
      specialist_name: "Сафина Гульнара Ильдаровна",
      created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
      created_at: "2026-11-06T10:00:00Z",
      first_completed_at: "2026-11-06T12:00:00Z",
      revision: 1,
      ...overrides,
    };
  }

  async function mockExaminationRead(page: Page, view: Record<string, unknown>): Promise<void> {
    await page.route(`**/api/v1/examinations/${EXAM_ID}`, (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(view) });
      }
      return route.fulfill({ status: 405, contentType: "application/json", body: "{}" });
    });
  }

  test("DR44: the FIT row carries all five values and opens the saved card, then returns to ACCEPTED", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await mockSessionAndArrivals(page);
    const row = acceptedWithExam(examSummary());
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("laboratory_id") !== LAB) {
        return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
      }
      const queue = url.searchParams.get("queue") ?? "EXPECTED";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: queue === "ACCEPTED" ? [row] : [],
          total: queue === "ACCEPTED" ? 1 : 0,
          page: 1,
          page_size: 20,
        }),
      });
    });
    await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row) }),
    );
    await mockExaminationRead(page, examCard());

    await page.goto(`/labs/${LAB}/arrivals?queue=accepted`);
    // The five DR44 §3 column values of one row.
    await expect(page.getByRole("cell", { name: "Пригодно", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "480,00 ₽", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "с 01.11.2026 по 10.11.2026" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Сафина Гульнара Ильдаровна" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "№ 154/2026" })).toBeVisible();
    // The accessible cost hint stays with the header.
    await expect(page.getByRole("button", { name: "Что входит в стоимость" })).toBeVisible();

    // The eye action opens the SAVED card (the real examination id).
    await page.getByRole("link", { name: "Открыть карточку ВСЭ" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/examinations/${EXAM_ID}`));
    await expect(page.getByRole("heading", { name: "ВСЭ № 154/2026" })).toBeVisible();
    await expect(page.getByLabel("Результат")).toHaveValue("Пригодно · В реализацию без ограничений");
    await expect(page.getByLabel("Специалист Госветслужбы")).toHaveValue("Сафина Гульнара Ильдаровна");

    // Back: the ACCEPTED row keeps all five values (no refetch fabrication).
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/arrivals\\?queue=accepted`));
    await expect(page.getByRole("cell", { name: "Пригодно", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "480,00 ₽", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "№ 154/2026" })).toBeVisible();
    expect(errors).toEqual([]);
    await shot(page, "dr44-accepted-fit-row");
  });

  test("DR44: UNFIT shows «Непригодно» in the row; direction and reason live only in the card", async ({
    page,
  }) => {
    await mockSessionAndArrivals(page);
    const summary = examSummary({
      outcome: "UNFIT",
      pricing: { lines: [], total: "300.00", currency: "RUB", fair: false },
      combined_total: "530.00",
    });
    const row = acceptedWithExam(summary);
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("laboratory_id") !== LAB) {
        return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
      }
      const queue = url.searchParams.get("queue") ?? "EXPECTED";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: queue === "ACCEPTED" ? [row] : [],
          total: queue === "ACCEPTED" ? 1 : 0,
          page: 1,
          page_size: 20,
        }),
      });
    });
    await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row) }),
    );
    await mockExaminationRead(
      page,
      examCard({
        outcome: "UNFIT",
        direction: "DISPOSAL",
        reason: "Посторонние включения",
      }),
    );

    await page.goto(`/labs/${LAB}/arrivals?queue=accepted`);
    await expect(page.getByRole("cell", { name: "Непригодно", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "530,00 ₽", exact: true })).toBeVisible();
    // The compact column never carries the direction or the reason.
    await expect(page.getByText("На утилизацию")).toHaveCount(0);
    await expect(page.getByText("Посторонние включения")).toHaveCount(0);

    // The card itself carries the direction and the reason.
    await page.getByRole("link", { name: "Открыть карточку ВСЭ" }).click();
    await expect(page.getByLabel("Результат")).toHaveValue("Непригодно · На утилизацию");
    await expect(page.getByLabel("Причина направления")).toHaveValue("Посторонние включения");
    await shot(page, "dr44-unfit-card");
  });

  test("DR44: a WAITING card fabricates no outcome and stays out of ACCEPTED", async ({ page }) => {
    await mockSessionAndArrivals(page);
    const waitingRow = {
      ...acceptedRowFixture(),
      queue: "WORK",
      examination_id: EXAM_ID,
      examination: examSummary({
        status: "WAITING",
        outcome: null,
        specialist_name: null,
        combined_total: null,
      }),
    };
    await page.route("**/api/v1/arrivals?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("laboratory_id") !== LAB) {
        return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
      }
      const queue = url.searchParams.get("queue") ?? "EXPECTED";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: queue === "WORK" ? [waitingRow] : [],
          total: queue === "WORK" ? 1 : 0,
          page: 1,
          page_size: 20,
        }),
      });
    });
    await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(waitingRow),
      }),
    );
    await mockExaminationRead(page, examCard({ status: "WAITING", outcome: null, direction: null }));

    // ACCEPTED lists nothing: a waiting card is not a completed arrival.
    await page.goto(`/labs/${LAB}/arrivals?queue=accepted`);
    await expect(page.getByText("По заданным условиям завершенные поступления не найдены")).toBeVisible();
    await expect(page.getByText("Пригодно")).toHaveCount(0);
    await expect(page.getByText("Непригодно")).toHaveCount(0);

    // The waiting card itself shows no fabricated conclusion.
    await page.goto(`/labs/${LAB}/examinations/${EXAM_ID}`);
    await expect(page.getByRole("heading", { name: "ВСЭ № 154/2026" })).toBeVisible();
    await expect(page.getByText("Итог не указан: карточка ожидает ответа лаборатории.")).toBeVisible();
    await expect(page.getByText("Пригодно · В реализацию без ограничений")).toHaveCount(0);
    await shot(page, "dr44-waiting-honest");
  });
});
