/**
 * DR32 (dorabotka/2026-11-16-dialog-top-layer-and-overlay.md): the modal
 * dialog layer is verified by COMPUTED styles and real hit-testing, not by
 * grepping the CSS text. The receipt confirmation dialog opens on the real
 * reconciliation route from a fixture preview — no real VetIS write happens
 * (every write endpoint is intercepted and counted).
 */
import { expect, test, type Page } from "@playwright/test";

const LAB = "11111111-2222-4333-8444-555555555555";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const FINGERPRINT = "a".repeat(64);

const arrival = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "CONFIRMED",
    fields: {
      documentNumber: "RU016:260812-005102",
      consignor: "ООО Агрофирма",
      consignee: "АттК ООО Птицефабрика",
      productItem: "Фарш куриный",
    },
  },
  classification: {
    product: { id: "p", name: "Полуфабрикаты" },
    subProduct: null,
    productItem: { id: "pi", name: "Фарш куриный" },
    unit: { id: "u", name: "кг" },
    productType: 1,
  },
  documentary: { mass_kg: "120", quantity: "4", unit_id: "u" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 2,
};

const reconciliation = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  party_id: PARTY,
  revision: 3,
  state: "OPEN",
  checks: {},
  inspection: { compartment: "COMPLIANT", jointCarriage: "NONE" },
  delivered: { mass_kg: "120", quantity: "4", unit_id: "u" },
  accepted: { mass_kg: "120", quantity: "4", unit_id: "u" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "u" },
  decision: "ACCEPT_ALL",
  return_reason: null,
  repeat: null,
  transaction: { planned: false, type: null },
  fair: false,
  services: [],
  actor_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  saved_at: "2026-11-10T06:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: "EXAMINATION",
  errors: [],
  complete: true,
};

/** VetIS write attempts observed by the receipt-write interceptor. */
let writes = 0;

async function baseRoutes(page: Page): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: "Кузнецова Алия Ринатовна",
        login: "vet",
        email: "vet@lab.test",
        position: "Ветеринарный врач",
        role: "VET",
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: ["receipt:submit"],
        revision: 1,
      }),
    }),
  );
  await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(arrival) }),
  );
  await page.route(`**/api/v1/arrivals/${PARTY}/reconciliation`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reconciliation),
    }),
  );
  await page.route(`**/api/v1/arrivals/${PARTY}/receipt-context`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        write_enabled: true,
        source_revision: 7,
        reconciliation_revision: 3,
        operation_id: null,
        operation_state: null,
      }),
    }),
  );
  await page.route(`**/api/v1/arrivals/${PARTY}/receipt-preview`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent: {
          decision: "ACCEPT_ALL",
          vet_inspection: "CORRESPONDS",
          source_revision: 7,
          reconciliation_revision: 3,
          delivery_date: "2026-11-10T09:30:00Z",
          doc_inspection: "CORRESPONDS",
          vet_inspection_details: null,
        },
        application_xml: "<offline-spy />",
        fingerprint: FINGERPRINT,
      }),
    }),
  );
  // A real VetIS write must never happen during a visual check: count and abort.
  writes = 0;
  await page.route(`**/api/v1/arrivals/${PARTY}/receipt`, (route) => {
    writes += 1;
    return route.abort();
  });
}

/** Opens the confirmation dialog through the real user path (fixture preview). */
async function openConfirmationDialog(page: Page): Promise<void> {
  await baseRoutes(page);
  await page.goto(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
  await page.getByLabel("Результат ветеринарного осмотра").selectOption("CORRESPONDS");
  await page.getByRole("button", { name: "Подготовить гашение" }).click();
  await expect(page.getByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeVisible();
}

interface OverlayProbe {
  position: string;
  zIndex: string;
  background: string;
  box: { x: number; y: number; width: number; height: number };
}

interface ContentProbe {
  zIndex: string;
  background: string;
  color: string;
}

function parseAlpha(background: string): number | null {
  const match = /rgba?\(([^)]+)\)/.exec(background);
  if (match === null) return null;
  const parts = match[1].split(/[\s,/]+/).filter((part) => part !== "");
  if (parts.length >= 4) return Number(parts[3]);
  return parts.length === 3 ? 1 : null;
}

test.describe("DR32 dialog top layer", () => {
  test("computed styles, hit-testing, click blocking, focus trap, Escape", async ({ page }) => {
    await openConfirmationDialog(page);

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    const overlay = page.locator(".app-dialog-overlay");
    const content = page.locator(".app-dialog");
    await expect(overlay).toBeVisible();
    await expect(content).toBeVisible();

    // §9.2.2 — overlay computed styles: fixed, covers the viewport, opaque
    // enough to separate the page, above the header/sticky layers.
    const overlayProbe = await overlay.evaluate((el): OverlayProbe => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        position: style.position,
        zIndex: style.zIndex,
        background: style.backgroundColor,
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
    expect(overlayProbe.position).toBe("fixed");
    expect(overlayProbe.box.x).toBeLessThanOrEqual(0);
    expect(overlayProbe.box.y).toBeLessThanOrEqual(0);
    expect(overlayProbe.box.width).toBeGreaterThanOrEqual(viewport.width);
    expect(overlayProbe.box.height).toBeGreaterThanOrEqual(viewport.height);
    const overlayAlpha = parseAlpha(overlayProbe.background);
    expect(overlayProbe.background).not.toBe("transparent");
    expect(overlayAlpha ?? 0).toBeGreaterThan(0);
    const overlayZ = Number(overlayProbe.zIndex);
    expect(Number.isNaN(overlayZ)).toBe(false);

    // The overlay is above the app header (z-index 100) and every sticky panel.
    const headerZ = await page
      .locator("header")
      .first()
      .evaluate((el) => Number(getComputedStyle(el).zIndex) || 0);
    expect(overlayZ).toBeGreaterThan(headerZ);

    // §9.2.3 — content: fully opaque panel, defined ink colour, above overlay.
    const contentProbe = await content.evaluate((el): ContentProbe => {
      const style = getComputedStyle(el);
      return {
        zIndex: style.zIndex,
        background: style.backgroundColor,
        color: style.color,
      };
    });
    expect(parseAlpha(contentProbe.background)).toBe(1);
    expect(contentProbe.color).not.toBe("");
    expect(parseAlpha(contentProbe.color)).toBe(1);
    const contentZ = Number(contentProbe.zIndex);
    expect(contentZ).toBeGreaterThan(overlayZ);

    // §9.2.4 — the centre of the viewport belongs to the dialog subtree.
    const centreOwner = await page.evaluate(() => {
      const element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return element === null ? null : element.closest(".app-dialog") !== null;
    });
    expect(centreOwner).toBe(true);

    // §9.2.5 — a point outside the card belongs to the overlay, not the page.
    const cornerOwner = await page.evaluate(() => {
      const element = document.elementFromPoint(24, window.innerHeight / 2);
      return element === null ? null : element.className;
    });
    expect(String(cornerOwner)).toContain("app-dialog-overlay");

    // §9.2.7 — Tab keeps the focus inside the dialog (focus trap).
    for (let step = 0; step < 24; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        const dialog = document.querySelector(".app-dialog");
        return dialog !== null && active !== null && dialog.contains(active);
      });
      expect(inside, `Tab step ${step}`).toBe(true);
    }

    // §9.2.8 — Escape closes the dialog and focus is back in the main document.
    // In the real receipt flow the opener button is disabled during the async
    // preview fetch, so document.activeElement is body when the dialog opens —
    // there is no focused trigger to return to (the restoration mechanism
    // itself is covered by the unit test «test_dialog_focus_and_escape»).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Подтвердите гашение эВСД" })).toHaveCount(0);
    const focusBack = await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active === document.body || (active instanceof Element && active.closest(".app-dialog") === null)
      );
    });
    expect(focusBack).toBe(true);
    await expect(page.getByRole("button", { name: "Подготовить гашение" })).toBeEnabled();

    // §9.2.6 — a real click on a page link behind the overlay never reaches the
    // page. The overlay itself may dismiss the dialog (the current Radix
    // outside-interaction contract); the point is that NOTHING behind it acts.
    await page.getByRole("button", { name: "Подготовить гашение" }).click();
    await expect(page.getByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeVisible();
    const beforeUrl = page.url();
    const headerLink = page.locator("header a").first();
    if ((await headerLink.count()) > 0) {
      const linkBox = await headerLink.boundingBox();
      if (linkBox !== null) {
        await page.mouse.click(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);
        await page.waitForTimeout(300);
        expect(page.url()).toBe(beforeUrl);
      }
    }

    // No VetIS write left the application during the whole visual check.
    expect(writes).toBe(0);
  });

  test("responsive layer: screenshots 1440/1024/768/390, no horizontal scroll, readable fingerprint", async ({
    page,
  }) => {
    await baseRoutes(page);
    await page.goto(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
    await page.getByLabel("Результат ветеринарного осмотра").selectOption("CORRESPONDS");
    await page.getByRole("button", { name: "Подготовить гашение" }).click();
    await expect(page.getByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeVisible();

    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const content = page.locator(".app-dialog");
      await expect(content).toBeVisible();

      // §9.2.10 — no horizontal page scroll and the long fingerprint stays
      // inside the card (it wraps, it never widens the dialog).
      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.innerWidth);

      const boxes = await content.evaluate((el) => {
        const dialogRect = el.getBoundingClientRect();
        const fingerprint = el.querySelector(".vse-receipt-fingerprint");
        const fpRect = fingerprint?.getBoundingClientRect();
        return {
          dialogWidth: dialogRect.width,
          dialogRight: dialogRect.right,
          fingerprintWidth: fpRect?.width ?? null,
          fingerprintText: fingerprint?.textContent ?? "",
        };
      });
      expect(boxes.dialogRight).toBeLessThanOrEqual(width);
      expect(boxes.fingerprintText?.length ?? 0).toBeGreaterThanOrEqual(FINGERPRINT.length);
      expect(boxes.fingerprintWidth ?? 0).toBeLessThanOrEqual(boxes.dialogWidth);

      await page.screenshot({ path: `test-results/dr32-dialog-${width}.png` });
    }
  });
});
