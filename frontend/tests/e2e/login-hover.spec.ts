/**
 * DR15 §4.3 login hover regression (built Storybook, no backend): the enabled
 * «Войти» button keeps its base appearance under the mouse — the same
 * background gradient, text colour, border, box-shadow and box size — while
 * the Tab focus ring stays visible and submit still works.
 */
import { expect, test, type Page } from "@playwright/test";

const STORYBOOK = process.env.E2E_STORYBOOK_URL ?? "http://localhost:6006";
const AUTH_SCREEN = `${STORYBOOK}/iframe.html?id=${encodeURIComponent("f03-loginform--auth-screen")}&viewMode=story`;

/** The computed properties the base state is compared on (§4.1). */
const PROPERTIES = ["background", "color", "border", "box-shadow", "width", "height"] as const;

async function computed(page: Page, selector: string): Promise<Record<string, string>> {
  return page.evaluate((sel: string) => {
    const element = document.querySelector(sel) as HTMLElement;
    const style = getComputedStyle(element);
    return Object.fromEntries(
      ["background", "color", "border", "boxShadow", "width", "height"].map((property) => [
        property,
        style.getPropertyValue(property),
      ]),
    );
  }, selector);
}

test("hover does not change the enabled «Войти» button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(AUTH_SCREEN);
  const button = page.getByRole("button", { name: "Войти", exact: true });
  await expect(button).toBeVisible();
  const before = await computed(page, "button[type=submit]");
  // The hover is a real pointer hover, not the :hover pseudo-only CSS check.
  await page.hover("button[type=submit]");
  const after = await computed(page, "button[type=submit]");
  for (const property of PROPERTIES) {
    expect(after[property], property).toBe(before[property]);
  }
  // The base state is the auth gradient, not the white working-button look.
  expect(before.background).toContain("linear-gradient");
  expect(before.color).toBe("rgb(255, 255, 255)");
  const base = await button.boundingBox();
  expect(base?.width).toBe(await (await page.locator("button[type=submit]").boundingBox())?.width);
});

test("Tab focus stays visible and submit still runs the login command", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(AUTH_SCREEN);
  await page.getByLabel("Логин").fill("e2e-hover");
  await page.getByLabel("Пароль").fill("demo-password-long");
  await page.getByLabel("Пароль").press("Tab");
  const button = page.getByRole("button", { name: "Войти", exact: true });
  await expect(button).toBeFocused();
  const outline = await page.evaluate(
    () => getComputedStyle(document.activeElement as HTMLElement).outlineWidth,
  );
  expect(outline).not.toBe("0px");
  // Submit runs the (story-injected) command: the 401 problem text appears.
  await button.click();
  await expect(page.getByText("Неверный логин или пароль.")).toBeVisible();
});
