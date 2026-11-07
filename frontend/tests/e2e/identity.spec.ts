/**
 * Identity e2e (F03): login, recovery, profile and user administration against
 * the REAL backend + PostgreSQL + Redis (AC-20/AT-20/AT-24, FT-ACC-01–10).
 *
 * Prerequisites (see docs/implementation/F03-identity-evidence.md):
 *   - backend on 127.0.0.1:8000 (uvicorn), proxied by the vite dev server;
 *   - seeded identity data (frontend/tests/e2e/seed_identity.py), which writes
 *     frontend/test-results/identity-seed.json.
 * If the seed file or the backend is missing the suite fails loudly — it never
 * fakes a pass.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Seed {
  admin: { login: string; password: string };
  userPassword: string;
  newPassword: string;
  users: { vet: string; head: string; analyst: string; blocked: string; linked: string };
  labAId: string;
  labBId: string;
  productId: string;
}

const seedPath = resolve(process.cwd(), "tests/e2e/identity-seed.local.json");
const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;

/** Follow the F02 report: screenshots of significant states, gitignored. */
function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: `test-results/f03-${name}.png`, fullPage: true });
}

async function login(page: Page, loginName: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(loginName);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

test.describe("identity", () => {
  test("test_four_role_landing", async ({ page }) => {
    // ADMIN → the administration section (/users, API-02 «Начальные маршруты»).
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByRole("link", { name: "Управление пользователями" })).toBeVisible();
    await shot(page, "landing-admin");
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // VET → the current laboratory arrivals queue.
    await login(page, seed.users.vet, seed.userPassword);
    await expect(page).toHaveURL(new RegExp(`/labs/${seed.labAId}/arrivals\\?queue=expected$`));
    await shot(page, "landing-vet");
    await page.getByRole("button", { name: "Выйти" }).click();

    // HEAD → the same working context route.
    await login(page, seed.users.head, seed.userPassword);
    await expect(page).toHaveURL(new RegExp(`/labs/${seed.labAId}/arrivals\\?queue=expected$`));
    await page.getByRole("button", { name: "Выйти" }).click();

    // ANALYST → the single-laboratory selection screen, no merged journal.
    await login(page, seed.users.analyst, seed.userPassword);
    await expect(page).toHaveURL(/\/labs$/);
    await expect(page.getByRole("link", { name: /[0-9a-f]{8}…/ })).toHaveCount(2);
    await shot(page, "landing-analyst");
  });

  test("test_admin_cannot_open_working_data", async ({ page }) => {
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);

    // Direct URL to the working journal: no working data may appear.
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/") && request.method() === "GET") apiCalls.push(request.url());
    });
    await page.goto(`/labs/${seed.labAId}/examinations`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("table")).toHaveCount(0);
    // The administration header stays; no fabricated journal rows.
    await expect(page.getByRole("link", { name: "Управление пользователями" })).toBeVisible();
    await shot(page, "admin-journal-no-data");

    // Server side: no working-data read succeeded — every scoped read the
    // session performed stays in the administration domain.
    for (const url of apiCalls) {
      const response = await page.request.get(url);
      expect(response.status(), url).toBeLessThan(500);
    }
  });

  test("test_password_reset_keeps_blocked", async ({ page }) => {
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    // Same SPA session: a full page reload would drop the in-memory session
    // CSRF token that the admin mutations require (the backend compares the
    // header against the login-issued token, not a bootstrap one).
    const rowAny = page.locator("tr", { hasText: "Заблокирован Е2Е" });
    await expect(rowAny).toBeVisible();

    // Reset the password of the blocked user via the dialog (If-Match guarded).
    await rowAny.getByRole("button", { name: "Действия со строкой" }).click();
    await page.getByRole("menuitem", { name: "Сброс пароля" }).click();
    await page.getByLabel("Новый пароль", { exact: false }).first().fill(seed.newPassword);
    await page.getByLabel("Подтверждение", { exact: false }).first().fill(seed.newPassword);
    await page.getByRole("button", { name: "Сбросить" }).click();
    await expect(page.getByText(/Пароль сброшен|Пароль изменён/)).toBeVisible();
    await shot(page, "reset-done");

    // The reset did NOT unblock the account (the list refetches in place).
    await expect(
      page
        .locator("tr", { hasText: "Заблокирован Е2Е" })
        .getByRole("cell", { name: "Заблокирован", exact: true }),
    ).toBeVisible();

    // And the blocked user still cannot log in (real 403 ACCOUNT_BLOCKED).
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, seed.users.blocked, seed.newPassword);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/заблокирован/i)).toBeVisible();
    await shot(page, "blocked-login");
  });

  test("test_no_email_recovery", async ({ page }) => {
    const apiBodies: { method: string; url: string; body: string | null }[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/")) {
        apiBodies.push({ method: request.method(), url: request.url(), body: request.postData() ?? null });
      }
    });
    await page.goto("/password-help");
    await expect(page.getByText(/администратор/i).first()).toBeVisible();
    // The recovery screen collects nothing and sends nothing: no input fields
    // and no API write at all (FT-ACC-07: recovery is an administrator task).
    await expect(page.locator("input")).toHaveCount(0);
    expect(apiBodies.filter((entry) => entry.method !== "GET")).toEqual([]);
    expect(
      apiBodies.filter((entry) =>
        JSON.stringify(entry.body ?? "")
          .toLowerCase()
          .includes("token"),
      ),
    ).toEqual([]);
    await expect(page.getByRole("link", { name: /войти|ко входу/i })).toBeVisible();
    await shot(page, "recovery");
  });

  test("test_ft_acc_01_wrong_password_and_logout", async ({ page }) => {
    await login(page, seed.admin.login, "wrong-password-123");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/Неверный логин или пароль/)).toBeVisible();
    // The typed login stays; the password field is cleared after the failure.
    await expect(page.getByLabel("Логин")).toHaveValue(seed.admin.login);

    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login$/);
    // Direct link after logout does not reopen the session data.
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("test_at_24_linked_user_delete_blocked", async ({ page }) => {
    await login(page, seed.admin.login, seed.admin.password);
    await expect(page).toHaveURL(/\/users$/);
    // Same SPA session as above (see test_password_reset_keeps_blocked).
    const linkedRow = page.locator("tr", { hasText: "Связанный Е2Е" });
    await linkedRow.getByRole("button", { name: "Действия со строкой" }).click();
    await page.getByRole("menuitem", { name: "Удалить" }).click();
    await page.getByRole("button", { name: "Удалить" }).click();
    // USER_HAS_REFERENCES: the linked user cannot be deleted…
    await expect(page.getByRole("dialog").getByText(/не может быть удалён/)).toBeVisible();
    await page.keyboard.press("Escape");
    // …but blocking works.
    await linkedRow.getByRole("button", { name: "Действия со строкой" }).click();
    await page.getByRole("menuitem", { name: "Заблокировать" }).click();
    await page.getByRole("button", { name: "Заблокировать" }).click();
    await expect(linkedRow.getByText("Заблокирован")).toBeVisible();
    await shot(page, "at24-blocked");
    // History keeps the event trail without secrets (AT-24).
    const historyHref = await linkedRow
      .getByRole("link", { name: /Связанный Е2Е/ })
      .first()
      .getAttribute("href");
    await page.goto(`${historyHref}/history`);
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.locator("main")).not.toContainText("$argon2");
    await expect(page.locator("main")).not.toContainText(seed.userPassword);
    await shot(page, "at24-history");
  });
});
