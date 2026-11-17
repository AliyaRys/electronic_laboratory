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
  // The redirect finishes the login: ADMIN → /users, scoped roles → /labs/….
  await page.waitForURL(/\/(labs|users)/, { timeout: 15000 });
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

    const fullName = `Создан Е2Е Ветеринарный ${Date.now()}`;
    await page.getByLabel("ФИО *").fill(fullName);
    const loginName = `dr34-vet-${Date.now()}`;
    await page.getByLabel("Логин *").fill(loginName);
    await page.getByLabel("Пароль *", { exact: true }).fill(CREATED_PASSWORD);
    await page.getByLabel("Повторите пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Email *").fill(`${loginName}@e2e.test`);
    await page.getByLabel("Роль *", { exact: true }).selectOption({ label: "Ветеринарный врач" });
    await page.getByLabel("Лаборатория *").selectOption({ label: "Е2Е лаборатория А" });
    await page.getByLabel("Тип продукции *").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    // §11 current UX: after the save the form clears the secret, so the dirty
    // guard asks once on the way back; leaving is safe (the creation saved).
    await page
      .getByRole("dialog", { name: "Несохранённый ввод" })
      .getByRole("button", { name: "Покинуть без сохранения" })
      .click({ timeout: 5000 })
      .catch(() => undefined);

    // §9: back on the saved URL with the success notice and the new row. The
    // returnTo keeps ?role=HEAD, so after the notice the list search (§5)
    // brings the new VET row into view instead of the filtered page 1.
    await expect(page).toHaveURL(/\/users(\?|$)/);
    await expect(page.getByText("Пользователь создан")).toBeVisible();
    await page.goto("/users");
    await page.getByLabel("Поиск (ФИО, логин, email)").fill(fullName);
    await page.getByLabel("Поиск (ФИО, логин, email)").press("Enter");
    await expect(page).toHaveURL(/q=/);
    await expect(page.locator("tr", { hasText: fullName })).toBeVisible();

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
    const fullName = `Создан Е2Е Заведующий ${Date.now()}`;
    await page.getByLabel("ФИО *").fill(fullName);
    const loginName = `dr34-head-${Date.now()}`;
    await page.getByLabel("Логин *").fill(loginName);
    await page.getByLabel("Пароль *", { exact: true }).fill(CREATED_PASSWORD);
    await page.getByLabel("Повторите пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Email *").fill(`${loginName}@e2e.test`);
    await page.getByLabel("Роль *", { exact: true }).selectOption({ label: "Заведующий лабораторией" });
    await page.getByLabel("Лаборатория *").selectOption({ label: "Е2Е лаборатория Б" });
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    await page
      .getByRole("dialog", { name: "Несохранённый ввод" })
      .getByRole("button", { name: "Покинуть без сохранения" })
      .click({ timeout: 5000 })
      .catch(() => undefined);
    await expect(page.locator("tr", { hasText: fullName })).toBeVisible();

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
        // The dev server origin: a mismatched Origin is answered 403
        // CSRF_REJECTED before the delegation check ever runs, which would
        // fake this refusal instead of testing it.
        Origin: "http://localhost:4173",
        "X-CSRF-Token": /vse_csrf=([^;]+)/.exec(token)?.[1] ?? "",
        "Idempotency-Key": `dr34-forge-${Date.now()}`,
      },
    });
    expect([403, 404, 422]).toContain(response.status());
    const body = (await response.json()) as { code?: string };
    expect(body.code ?? "").not.toBe("INTERNAL_ERROR");
    // The refusal must come from the delegation check, not from CSRF.
    expect(body.code ?? "").not.toBe("CSRF_REJECTED");
  });

  test("test_same_intent_key_never_duplicates", async ({ page }) => {
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    // The replayed intent must be the REAL request the form sends, so the
    // exact payload (including the ADMIN territory) and the Idempotency-Key
    // the client chose are captured from the live POST.
    const captured: { key: string; body: object; userId: string }[] = [];
    await page.route("**/api/v1/users", async (route) => {
      if (route.request().method() === "POST") {
        const response = await route.fetch();
        if (response.status() === 201) {
          const body = (await response.json()) as { id: string };
          captured.push({
            key: route.request().headers()["idempotency-key"] ?? "",
            body: route.request().postDataJSON() as object,
            userId: body.id,
          });
        }
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    const loginName = `dr34-idem-${Date.now()}`;
    const fullName = `Повтор Е2Е Идемпотентный ${Date.now()}`;
    await page.getByLabel("ФИО *").fill(fullName);
    await page.getByLabel("Логин *").fill(loginName);
    await page.getByLabel("Пароль *", { exact: true }).fill(CREATED_PASSWORD);
    await page.getByLabel("Повторите пароль *").fill(CREATED_PASSWORD);
    await page.getByLabel("Email *").fill(`${loginName}@e2e.test`);
    await page.getByLabel("Роль *", { exact: true }).selectOption({ label: "Администратор" });
    await page.getByLabel("Территория назначения *").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Создать пользователя" }).click();
    await page
      .getByRole("dialog", { name: "Несохранённый ввод" })
      .getByRole("button", { name: "Покинуть без сохранения" })
      .click({ timeout: 5000 })
      .catch(() => undefined);
    await expect(page.getByText("Пользователь создан")).toBeVisible();
    expect(captured).toHaveLength(1);
    const intent = captured[0];

    // The very same intent retried through the API (same Idempotency-Key and
    // payload) replays the SAME user instead of writing a duplicate.
    await page.goto("/users");
    const token = await page.evaluate(() => document.cookie);
    const replayed = await page.request.post("/api/v1/users", {
      data: intent.body,
      headers: {
        Origin: "http://localhost:4173",
        "X-CSRF-Token": /vse_csrf=([^;]+)/.exec(token)?.[1] ?? "",
        "Idempotency-Key": intent.key,
      },
    });
    expect(replayed.status()).toBe(201);
    expect(((await replayed.json()) as { id: string }).id).toBe(intent.userId);
    const rows = await page.locator("tr", { hasText: fullName }).count();
    expect(rows).toBeLessThanOrEqual(1);
  });
});
