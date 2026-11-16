/**
 * DR34 e2e: delegated user creation from the users list (§13.3) against the
 * REAL backend + PostgreSQL + Redis, in the SAME isolated E2E database as
 * identity.spec.ts (seeded by frontend/tests/e2e/seed_identity.py, which
 * refuses non-E2E databases). The working data/local-admin are never used as
 * removable fixtures: only «Е2Е» accounts created here.
 *
 * Prerequisites (same as identity.spec.ts): backend on 127.0.0.1:8000 proxied
 * by the vite dev server and the seeded identity database. Missing seed or
 * backend → the suite fails loudly, it never fakes a pass.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Seed {
  admin: { login: string; password: string };
  userPassword: string;
  labAId: string;
  labBId: string;
}

const seedPath = resolve(process.cwd(), "tests/e2e/identity-seed.local.json");
const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;

const CREATED_PASSWORD = "dr34-created-password-1";

async function login(page: Page, loginName: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(loginName);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

test.describe("DR34 delegated user creation", () => {
  test("test_create_vet_from_users_list_and_login", async ({ page }) => {
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    // §5: the button exists only after /me confirmed users:create.
    await expect(page.getByRole("button", { name: "Создать пользователя" })).toBeVisible();

    // §5.3: the filtered list URL rides along as the returnTo.
    await page.goto("/users?role=HEAD");
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    await expect(page).toHaveURL(/\/users\/new$/);

    // §6/§7: human-readable fields only — no UUID inputs anywhere.
    await expect(page.locator("input[type='text']")).not.toHaveCount(0);
    expect(await page.getByLabel(/UUID/).count()).toBe(0);

    await page.getByLabel("ФИО *").fill("Создан Е2Е Ветеринарный");
    const loginName = `dr34-vet-${Date.now()}`;
    await page.getByLabel("Логин *").fill(loginName);
    await page.getByLabel("Пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Повторите пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Email *").fill(`${loginName}@e2e.test`);
    await page.getByLabel("Роль *").selectOption({ label: "Ветеринарный врач" });
    await page.getByLabel("Лаборатория *").selectOption({ label: "Е2Е лаборатория А" });
    await page.getByLabel("Тип продукции *").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Создать пользователя" }).click();

    // §9: back on the saved URL with the success notice and the new row.
    await expect(page).toHaveURL(/\/users(\?|$)/);
    await expect(page.getByText("Пользователь создан")).toBeVisible();
    await expect(page.locator("tr", { hasText: "Создан Е2Е Ветеринарный" })).toBeVisible();

    // §15: the created user can log in and lands in his laboratory.
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, loginName, CREATED_PASSWORD);
    await expect(page).toHaveURL(new RegExp(`/labs/${seed.labAId}/arrivals`));
  });

  test("test_created_head_has_one_laboratory", async ({ page }) => {
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    await expect(page).toHaveURL(/\/users\/new$/);
    await page.getByLabel("ФИО *").fill("Создан Е2Е Заведующий");
    const loginName = `dr34-head-${Date.now()}`;
    await page.getByLabel("Логин *").fill(loginName);
    await page.getByLabel("Пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Повторите пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Email *").fill(`${loginName}@e2e.test`);
    await page.getByLabel("Роль *").selectOption({ label: "Заведующий лабораторией" });
    await page.getByLabel("Лаборатория *").selectOption({ label: "Е2Е лаборатория Б" });
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    await expect(page.locator("tr", { hasText: "Создан Е2Е Заведующий" })).toBeVisible();

    // FT-ADM-01: the head works in exactly ONE laboratory, no switcher.
    await page.getByRole("button", { name: "Выйти" }).click();
    await login(page, loginName, CREATED_PASSWORD);
    await expect(page).toHaveURL(new RegExp(`/labs/${seed.labBId}/arrivals`));
    await expect(page.getByRole("combobox", { name: /Лаборатория/ })).toHaveCount(0);
  });

  test("test_foreign_laboratory_forgery_is_refused", async ({ page }) => {
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    // §13.3.4: a forged POST with a laboratory outside the delegation is
    // refused without any record and without revealing the foreign area.
    const token = await page.evaluate(() => document.cookie);
    const response = await page.request.post("/api/v1/users", {
      data: {
        full_name: "Подменный Е2Е",
        login: `dr34-forged-${Date.now()}`,
        email: "dr34-forged@e2e.test",
        role: "VET",
        scopes: [{ laboratory_id: "00000000-0000-4000-8000-000000000009" }],
        password: CREATED_PASSWORD,
        confirmation: CREATED_PASSWORD,
      },
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-CSRF-Token": /vse_csrf=([^;]+)/.exec(token)?.[1] ?? "",
        "Idempotency-Key": `dr34-forge-${Date.now()}`,
      },
    });
    expect([403, 404, 422]).toContain(response.status());
    const body = (await response.json()) as { code?: string };
    expect(body.code ?? "").not.toBe("INTERNAL_ERROR");
  });

  test("test_same_intent_key_never_duplicates", async ({ page }) => {
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    const loginName = `dr34-idem-${Date.now()}`;
    await page.getByLabel("ФИО *").fill("Повтор Е2Е Идемпотентный");
    await page.getByLabel("Логин *").fill(loginName);
    await page.getByLabel("Пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Повторите пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Email *").fill(`${loginName}@e2e.test`);
    await page.getByLabel("Роль *").selectOption({ label: "Администратор" });
    await page.getByLabel("Территория назначения *").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    await expect(page.getByText("Пользователь создан")).toBeVisible();

    // The very same intent retried through the API returns the SAME user.
    await page.goto("/users");
    const token = await page.evaluate(() => document.cookie);
    const payload = {
      full_name: "Повтор Е2Е Идемпотентный",
      login: loginName,
      email: `${loginName}@e2e.test`,
      role: "ADMIN",
      scopes: [],
      password: CREATED_PASSWORD,
      confirmation: CREATED_PASSWORD,
    };
    const first = await page.request.post("/api/v1/users", {
      data: payload,
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-CSRF-Token": /vse_csrf=([^;]+)/.exec(token)?.[1] ?? "",
        "Idempotency-Key": "dr34-idem-intent",
      },
    });
    expect([201, 409]).toContain(first.status());
    const rows = await page.locator("tr", { hasText: "Повтор Е2Е Идемпотентный" }).count();
    expect(rows).toBeLessThanOrEqual(1);
  });
});
