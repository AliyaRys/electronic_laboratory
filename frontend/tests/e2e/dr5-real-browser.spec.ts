/**
 * DR5 browser check on the REAL local incoming eVSD (read-only; ТЗ §15).
 *
 * Run against the local install (backend :8111, vite :4173) with the
 * diagnostic user from the gitignored `tests/e2e/dr5-real-browser.local.json`
 * (same channel as identity-seed.local.json — no credentials in Git). The
 * spec performs NO write actions: no receipt, no sync POST, no hide mutation
 * — only reads and screenshots.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const seedPath = resolve(process.cwd(), "tests/e2e/dr5-real-browser.local.json");
const seed = JSON.parse(readFileSync(seedPath, "utf8")) as {
  laboratoryId: string;
  partyId: string;
  uuidVsd: string;
  user: string;
  password: string;
};

const LAB = seed.laboratoryId;
const PARTY = seed.partyId;
const UUID_VSD = seed.uuidVsd;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(seed.user);
  await page.getByLabel("Пароль").fill(seed.password);
  await page.getByRole("button", { name: /Войти/ }).click();
  await expect(page).toHaveURL(/\/labs\//, { timeout: 15000 });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("DR5 real incoming document", () => {
  test("expected row shows the fixed requisites", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByText(UUID_VSD)).toBeVisible();
    await expect(page.getByText("03.11.2026")).toBeVisible();
    await expect(page.getByText("500.0 кг")).toBeVisible();
    await expect(page.getByRole("cell", { name: "8", exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: "docs/implementation/evidence/DR5-expected-1440.png", fullPage: true });

    // The search finds the document by its UUID (full or partial).
    await page.getByPlaceholder(/UUID ВСД/).fill("e13bda81");
    await expect(page.getByText(UUID_VSD)).toBeVisible();

    // Narrow screen (390 px) — no horizontal page overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: "docs/implementation/evidence/DR5-expected-390.png", fullPage: true });
  });

  test("reconciliation document block shows UUID/date/status/purpose", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
    await expect(page.getByRole("heading", { name: "Документ", exact: true })).toBeVisible();
    await expect(page.getByText(UUID_VSD)).toBeVisible();
    await expect(page.getByText("03.11.2026")).toBeVisible();
    await expect(page.getByText("Оформлен", { exact: true })).toBeVisible();
    await expect(page.getByText("реализация в пищу людям")).toBeVisible();
    // CHK-F20 quantity and CHK-F21 mass stay separate source values.
    await expect(page.getByText("Количество", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("8").first()).toBeVisible();
    await expect(page.getByText("500.0").first()).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: "docs/implementation/evidence/DR5-reconciliation-1440.png",
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: "docs/implementation/evidence/DR5-reconciliation-390.png",
      fullPage: true,
    });
  });
});
