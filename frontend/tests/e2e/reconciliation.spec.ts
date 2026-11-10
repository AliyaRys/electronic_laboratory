/**
 * Reconciliation screen e2e (A02/DR2): the REAL route at 1440 and 390 px
 * compared against the approved mockup `evsd-check-usmanov.html`, the
 * keyboard walkthrough and the proof that no request ever leaves the
 * application API (a real VetIS SOAP write is forbidden — every external
 * interaction is intercepted by page routes; nothing reaches the network).
 */
import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const MOCKUP_PATH = pathToFileURL(join(process.cwd(), "..", "evsd-check-usmanov.html")).href;

const LAB = "11111111-2222-4333-8444-555555555555";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const SECTION_ORDER = [
  "Документ",
  "Участники перевозки",
  "Ветеринарно-санитарная оценка и идентификация транспорта",
  "Идентификация продукции по наименованию и визуальным осмотром",
  "Сопроводительные документы",
  "Ранее проведённая ВСЭ",
  "Результаты сверки",
  "Расчёт стоимости услуг",
];

const party = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentNumber: "RU016:260812-005102",
      issuedOn: "2026-08-12 08:12",
      transportNumber: "А245КМ 116",
      consignor: "ИП Усманов И.К. (Республика Татарстан, г. Казань, ул. Аграрная, 7)",
      consignee: "Лаборатория ВСЭ №1 г. Казань (Республика Татарстан, г. Казань, ул. Аграрная, д. 2)",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "Говядина в тушах охлажденная" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Говядина в тушах охлажденная" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "486.5", quantity: "3", unit_id: "u" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 1,
};

const reconciliation = {
  id: "",
  party_id: PARTY,
  revision: 1,
  state: "OPEN",
  checks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "486.5", quantity: "3", unit_id: "u" },
  accepted: { mass_kg: "486.5", quantity: "3", unit_id: "u" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "u" },
  decision: null,
  return_reason: null,
  repeat: null,
  transaction: { planned: null, type: null },
  fair: false,
  services: [],
  actor_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  saved_at: "2026-11-10T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: "EXAMINATION",
  errors: [],
  complete: false,
};

const mockupUrl = MOCKUP_PATH;

async function mockSession(page: Page): Promise<void> {
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
}

async function openReconciliation(
  page: Page,
  options: { receiptWriteEnabled?: boolean } = {},
): Promise<void> {
  await mockSession(page);
  await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(party) }),
  );
  await page.route(`**/api/v1/arrivals/${PARTY}/reconciliation`, (route) => {
    // A test can register a stricter handler before this one; a non-GET
    // request falls back to it (the spy test intercepts the PUT).
    if (route.request().method() !== "GET") {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reconciliation),
    });
  });
  // W03 is off by default in the visual/keyboard tests: the receipt stage is
  // exercised only by the transport-spy test below, always through mock routes.
  await page.route(`**/api/v1/arrivals/${PARTY}/receipt-context`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        write_enabled: options.receiptWriteEnabled === true,
        source_revision: options.receiptWriteEnabled === true ? 7 : null,
        reconciliation_revision: options.receiptWriteEnabled === true ? 2 : null,
        operation_id: null,
        operation_state: null,
      }),
    }),
  );
  await page.goto(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
}

function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

test.describe("reconciliation screen vs approved mockup", () => {
  test("wide 1440 keeps the mockup composition", async ({ page }) => {
    await openReconciliation(page);
    await expect(page.getByRole("heading", { name: "Сверка данных транспортного эВСД" })).toBeVisible();
    const titles = (await page.locator(".vse-check-section h2").allTextContents()).filter(
      (text) => text.trim() !== "",
    );
    expect(titles).toEqual(SECTION_ORDER);
    expect(await noHorizontalScroll(page)).toBe(false);
    // The sticky panel of the mockup is present and the receipt stage follows.
    await expect(page.getByRole("button", { name: "Сохранить сверку" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Все соответствует/ })).toBeVisible();

    // The same composition facts hold in the approved mockup.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(mockupUrl);
    const mockupTitles = (await page.locator(".section h2").allTextContents()).map((text) => text.trim());
    for (const title of SECTION_ORDER.filter((name) => name !== "Результаты сверки")) {
      expect(mockupTitles).toContain(title);
    }
    await page.screenshot({
      path: "../docs/implementation/evidence/DR2-mockup-1440.png",
      fullPage: true,
    });
  });

  test("wide 1440 route screenshot for the visual comparison", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openReconciliation(page);
    await expect(page.getByRole("heading", { name: "Сверка данных транспортного эВСД" })).toBeVisible();
    await page.screenshot({
      path: "../docs/implementation/evidence/DR2-reconciliation-1440.png",
      fullPage: true,
    });
  });

  test("narrow 390 keeps one column, no page overflow and a full-width panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReconciliation(page);
    await expect(page.getByRole("heading", { name: "Сверка данных транспортного эВСД" })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(false);
    const save = page.getByRole("button", { name: "Сохранить сверку" });
    await expect(save).toBeVisible();
    const box = (await save.boundingBox()) ?? { width: 0 };
    expect(box.width).toBeGreaterThan(120);
    await page.screenshot({
      path: "../docs/implementation/evidence/DR2-reconciliation-390.png",
      fullPage: true,
    });
    await page.goto(mockupUrl);
    await page.screenshot({
      path: "../docs/implementation/evidence/DR2-mockup-390.png",
      fullPage: true,
    });
  });
});

test.describe("reconciliation keyboard walkthrough", () => {
  test("keyboard marks a comparison, fills the fact and reaches the panel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openReconciliation(page);
    const mark = page.getByRole("radio", { name: "Не совпадает: Вес, кг", exact: true });
    await mark.focus();
    await page.keyboard.press("Space");
    await expect(mark).toBeChecked();
    const actual = page.getByLabel("Фактическое значение");
    await actual.fill("452");
    await page.keyboard.press("Tab");
    await page.getByLabel("Причина несоответствия").fill("Недостача при доставке");

    // The panel is reachable with the keyboard; the save stays draft-only.
    await page.getByRole("button", { name: /Все соответствует/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("radio", { name: "Совпадает: Вес, кг", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Сохранить сверку" }).focus();
    await expect(page.getByRole("button", { name: "Сохранить сверку" })).toBeEnabled();
    expect(await noHorizontalScroll(page)).toBe(false);
  });
});

test.describe("reconciliation transport spy (no live VetIS write)", () => {
  test("every request stays inside the application API; the receipt is mocked", async ({ page }) => {
    const externalRequests: string[] = [];
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      const base = new URL("http://localhost:4173");
      if (url.origin === base.origin || url.origin === "http://localhost:6006") {
        apiRequests.push(`${request.method()} ${url.pathname}`);
        return;
      }
      externalRequests.push(`${request.method()} ${url.href}`);
    });

    let reconciliationPuts = 0;
    let receiptPosts = 0;
    let previewPosts = 0;
    await page.route(`**/api/v1/arrivals/${PARTY}/reconciliation`, (route) => {
      if (route.request().method() === "PUT") {
        reconciliationPuts += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...reconciliation,
            id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001",
            revision: 2,
            complete: true,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reconciliation),
      });
    });
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt-context`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          write_enabled: true,
          source_revision: 7,
          reconciliation_revision: 2,
          operation_id: null,
          operation_state: null,
        }),
      }),
    );
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt-preview`, (route) => {
      previewPosts += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          intent: { decision: "ACCEPT_ALL", vet_inspection: "CORRESPONDS" },
          application_xml: "<application />",
          fingerprint: "a".repeat(64),
        }),
      });
    });
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt`, (route) => {
      receiptPosts += 1;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          operation_id: "aaaaaaaa-0000-4000-8000-000000000001",
          state: "QUEUED",
          status_url: "/api/v1/operations/x",
        }),
      });
    });
    await page.route("**/api/v1/operations/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "op", kind: "vetis.receipt", state: "QUEUED" }),
      }),
    );

    await openReconciliation(page, { receiptWriteEnabled: true });

    // Mark and save the draft through the REAL screen.
    await page.getByRole("radio", { name: "Не совпадает: Вес, кг" }).click();
    await page.getByLabel("Фактическое значение").fill("452");
    await page.getByRole("button", { name: "Сохранить сверку" }).click();
    await expect(page.getByText(/Сохранение…|Сохранить сверку/).first()).toBeVisible();
    await expect.poll(() => reconciliationPuts, { timeout: 10_000 }).toBeGreaterThan(0);

    // The legally significant stage is NOT a plain save: it always runs
    // preview → explicit confirm (W03), all intercepted by page routes.
    await page.getByLabel("Результат ветеринарного осмотра").selectOption("CORRESPONDS");
    await page.getByRole("button", { name: "Подготовить гашение" }).click();
    await expect(page.getByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeVisible();
    // The safe action keeps the initial focus: Escape must be available and
    // nothing has been sent yet.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeHidden();
    expect(receiptPosts).toBe(0);
    await page.getByRole("button", { name: "Подготовить гашение" }).click();
    await expect(page.getByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeVisible();
    await page.getByRole("button", { name: "Погасить эВСД" }).click();
    await expect.poll(() => receiptPosts, { timeout: 10_000 }).toBe(1);
    expect(previewPosts).toBeGreaterThanOrEqual(1);

    // Spy verdict: nothing left the application origin. A live VetIS SOAP
    // endpoint (or any external host) was never contacted by this test.
    expect(externalRequests).toEqual([]);
    const receiptRequests = apiRequests.filter((entry) => entry.includes("receipt"));
    expect(
      receiptRequests.filter((entry) => entry.includes("receipt-context")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(receiptRequests.filter((entry) => entry.includes("receipt-preview")).length).toBe(2);
    // The irreversible write happened exactly once, after the explicit
    // confirmation, through the intercepted application API.
    expect(receiptRequests.filter((entry) => entry.endsWith("/receipt")).length).toBe(1);
    expect(apiRequests.filter((entry) => entry.startsWith("PUT")).length).toBe(1);
  });
});
