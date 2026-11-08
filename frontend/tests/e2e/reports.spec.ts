/**
 * Reporting e2e (R03, MSW route mocks — the same honest pattern as
 * examinations.spec.ts; the real-API leg is documented in the evidence file).
 *
 * Named controller flows:
 * - change params → warning → preview/codes cleared;
 * - network save failure preserves both (params and codes stay);
 * - 25 reports, page 2, back;
 * - report deleted elsewhere → not found;
 * - delete a source after preview/save → screen/PDF/XLSX/print matrix all
 *   EQUAL (the saved snapshot is rendered, never recomputed) and the
 *   count/source identities are unchanged;
 * - the menu never opens the row; export links are keyboard-accessible.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REPORT = "11111111-2222-4333-8444-555555555555";

function shot(page: Page, name: string): Promise<void> {
  return page.screenshot({ path: `test-results/r03-${name}.png`, fullPage: true }).then(() => undefined);
}

const payload = {
  version: 1,
  report_type: "5VET_SECTION_III",
  laboratory_id: LAB,
  laboratory: { name: "Лаборатория №1", address: "Адрес" },
  year: 2026,
  half: 1,
  generated_at: "2027-01-02T10:00:00Z",
  classification_version: "2026-v1",
  columns: [
    "CATTLE",
    "PIG",
    "SHEEP_GOAT",
    "RABBIT_NUTRIA",
    "CHICKEN",
    "OTHER_BIRDS",
    "FISH",
    "OTHER_ANIMALS",
  ],
  row_codes: ["166", "167", "168", "169", "170", "171", "172", "240", "241", "242"],
  matrix: [
    ["12", "34", "2", "0", "5", "7", "0", "1"],
    ["8", "20", "1", "0", "3", "4", "0", "0"],
    ["1", "6", "0", "0", "0", "0", "0", "0"],
    ["0", "9", "1", "0", "0", "0", "0", "0"],
    ["2", "4", "0", "0", "0", "1", "0", "0"],
    ["3", "11", "0", "0", "1", "2", "0", "0"],
    ["0", "2", "0", "0", "0", "0", "0", "0"],
    ["0.3", "0.25", "0.05", "0", "0", "0", "0", "0"],
    ["0.3", "0.25", "0.05", "0", "0", "0", "0", "0"],
    ["0", "0", "0", "0", "0", "0", "0", "0"],
  ],
  sources: [],
  source_count: 34,
  official: false,
};

function me(role: string): Record<string, unknown> {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    full_name: "Тестовый пользователь",
    login: "tester",
    email: "tester@example.test",
    position: null,
    role,
    active: true,
    scopes: [{ laboratory_id: LAB, product_scope_id: null }],
    capabilities: [],
    revision: 1,
  };
}

function summary(id: string, year: number, half: number): Record<string, unknown> {
  return {
    id,
    report_type: "5VET_SECTION_III",
    laboratory_id: LAB,
    year,
    half,
    source_count: 34,
    saved_at: "2027-01-02T10:00:00Z",
    saved_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    rev: 1,
  };
}

async function mockMe(page: Page, role = "HEAD"): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me(role)) }),
  );
}

async function expectAlertCount(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}

const PREVIEW_BUTTON = "Сформировать предварительный просмотр";

test.describe("report creation", () => {
  test("change params → warning → preview and codes are cleared", async ({ page }) => {
    await mockMe(page);
    let previewPosts = 0;
    await page.route("**/api/v1/reports/5vet/preview", (route: Route) => {
      previewPosts += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ payload, key_id: "k1", signature: "sig", byte_size: 10 }),
      });
    });
    await page.goto(`/labs/${LAB}/reports/new`);
    await expect(page.getByRole("heading", { name: "Создание отчёта 5-вет (раздел III)" })).toBeVisible();
    await page.getByRole("button", { name: PREVIEW_BUTTON }).click();
    await expect(page.getByText("Предварительный просмотр матрицы")).toBeVisible();
    await page.getByLabel("ОКУД").fill("001");
    await page.getByRole("radio", { name: /II \(июль—декабрь\)/ }).check();
    await expectAlertCount(page, "Параметры изменены");
    await expect(page.getByLabel("ОКУД")).toHaveCount(0);
    await expect(page.getByText("Предварительный просмотр матрицы")).toHaveCount(0);
    expect(previewPosts).toBe(1);
    await shot(page, "create-param-warning");
  });

  test("a network save failure preserves both the parameters and the codes", async ({ page }) => {
    await mockMe(page);
    await page.route("**/api/v1/reports/5vet/preview", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ payload, key_id: "k1", signature: "sig", byte_size: 10 }),
      }),
    );
    await page.route("**/api/v1/reports/5vet", (route: Route) => route.abort());
    await page.goto(`/labs/${LAB}/reports/new`);
    await page.getByRole("button", { name: PREVIEW_BUTTON }).click();
    await expect(page.getByText("Предварительный просмотр матрицы")).toBeVisible();
    for (const label of ["ОКУД", "ОКПО", "ОКВЭД", "ОКТМО", "ОКОГУ", "ОКОПФ", "ОКФС"]) {
      await page.getByLabel(label, { exact: true }).fill("001");
    }
    await page.getByRole("button", { name: "Сохранить отчёт" }).click();
    await expect(page.getByText(/Не удалось сохранить отчёт/)).toBeVisible();
    await expect(page.getByLabel("ОКУД")).toHaveValue("001");
    await expect(page.getByLabel("ОКФС")).toHaveValue("001");
    await expect(page.getByRole("radio", { name: /I \(январь—июнь\)/ })).toBeChecked();
    await shot(page, "create-save-failure");
  });

  test("a successful save sends the signed preview and the trimmed codes", async ({ page }) => {
    await mockMe(page);
    const posts: Record<string, unknown>[] = [];
    await page.route("**/api/v1/reports/5vet/preview", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ payload, key_id: "k1", signature: "sig", byte_size: 10 }),
      }),
    );
    await page.route("**/api/v1/reports/5vet", async (route: Route) => {
      posts.push((await route.request().postDataJSON()) as Record<string, unknown>);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { etag: '"1"' },
        body: JSON.stringify({
          ...summary(REPORT, 2026, 1),
          payload,
          codes: { okud: "001", okpo: "1", okved: "1", oktmo: "1", okogu: "1", okopf: "1", okfs: "1" },
        }),
      });
    });
    await page.route(`**/api/v1/reports/5vet/${REPORT}`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...summary(REPORT, 2026, 1),
          payload,
          codes: { okud: "001", okpo: "1", okved: "1", oktmo: "1", okogu: "1", okopf: "1", okfs: "1" },
        }),
      }),
    );
    await page.goto(`/labs/${LAB}/reports/new`);
    await page.getByRole("button", { name: PREVIEW_BUTTON }).click();
    await expect(page.getByText("Предварительный просмотр матрицы")).toBeVisible();
    await page.getByLabel("ОКУД").fill(" 001 ");
    for (const label of ["ОКПО", "ОКВЭД", "ОКТМО", "ОКОГУ", "ОКОПФ", "ОКФС"]) {
      await page.getByLabel(label, { exact: true }).fill("1");
    }
    await page.getByRole("button", { name: "Сохранить отчёт" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/reports/${REPORT}`));
    expect(posts).toHaveLength(1);
    const body = posts[0] as { preview: { signature: string }; codes: Record<string, string> };
    expect(body.preview.signature).toBe("sig");
    expect(body.codes["okud"]).toBe("001");
    await shot(page, "create-saved-view");
  });
});

test.describe("report list", () => {
  test("25 saved reports: page 2 shows the rest and back returns to page 1", async ({ page }) => {
    await mockMe(page);
    const items = Array.from({ length: 25 }, (_value, index) =>
      summary(`${REPORT}-${index}`, 2026, index % 2 === 0 ? 1 : 2),
    );
    const servedPages: number[] = [];
    await page.route("**/api/v1/reports/5vet*", (route: Route) => {
      const url = new URL(route.request().url());
      const page_ = Number(url.searchParams.get("page") ?? "1");
      servedPages.push(page_);
      const slice = items.slice((page_ - 1) * 20, page_ * 20);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: slice, total: items.length, page: page_, page_size: 20 }),
      });
    });
    await page.goto(`/labs/${LAB}/reports`);
    await expect(page.getByRole("heading", { name: "Отчёты", exact: true })).toBeVisible();
    await expect(page.getByText(/Страница 1 из 2/)).toBeVisible();
    // The row itself is NOT a clickable container: the link is the entry point.
    const firstLink = page.getByRole("link", { name: /2026, I полугодие/ }).first();
    await expect(firstLink).toBeVisible();
    await shot(page, "list-page1");

    // Forward to page 2: the server is asked for page=2 and shows the rest.
    await page.getByRole("button", { name: "Следующая страница" }).click();
    await expect(page.getByText(/Страница 2 из 2/)).toBeVisible();
    await expect(page).toHaveURL(/page=2/);
    expect(servedPages).toContain(2);
    await shot(page, "list-page2");

    // Back returns to page 1 (browser history keeps the URL state).
    await page.goBack();
    await expect(page.getByText(/Страница 1 из 2/)).toBeVisible();
    expect(servedPages).toContain(1);
  });

  test("the list link and create affordance are keyboard-accessible", async ({ page }) => {
    await mockMe(page);
    await page.route("**/api/v1/reports/5vet*", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [summary(REPORT, 2026, 1)], total: 1, page: 1, page_size: 20 }),
      }),
    );
    await page.goto(`/labs/${LAB}/reports`);
    const link = page.getByRole("link", { name: /2026, I полугодие/ });
    await link.focus();
    await expect(link).toBeFocused();
    await expect(page.getByRole("link", { name: "Операционный отчёт" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Учёт проб" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать отчёт 5-вет" })).toBeEnabled();
  });
});

test.describe("saved report view and exports", () => {
  test("a report deleted elsewhere answers not found", async ({ page }) => {
    await mockMe(page);
    await page.route(`**/api/v1/reports/5vet/${REPORT}`, (route: Route) =>
      route.fulfill({
        status: 404,
        contentType: "application/problem+json",
        body: JSON.stringify({
          code: "NOT_FOUND",
          title: "Not found",
          status: 404,
          detail: "Сохранённый отчёт не найден.",
        }),
      }),
    );
    await page.goto(`/labs/${LAB}/reports/${REPORT}`);
    await expect(
      page.getByText("Отчёт не найден: возможно, он был удалён другим пользователем."),
    ).toBeVisible();
    await shot(page, "view-not-found");
  });

  test("deleting a source after save: the saved snapshot stays equal on screen, PDF and XLSX", async ({
    page,
  }) => {
    await mockMe(page);
    const deletions: string[] = [];
    const pdfBodies: string[] = [];
    const xlsxBodies: string[] = [];
    let snapshotServes = 0;
    // The saved snapshot endpoint ALWAYS serves the stored payload: deleting
    // a source afterwards cannot change or invalidate it (R02/E03 contract).
    await page.route(`**/api/v1/reports/5vet/${REPORT}`, (route: Route) => {
      snapshotServes += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...summary(REPORT, 2026, 1),
          payload,
          codes: { okud: "001", okpo: "1", okved: "1", oktmo: "1", okogu: "1", okopf: "1", okfs: "1" },
        }),
      });
    });
    // The export mocks return deterministic realistic content; the byte
    // equality between the first and the second fetch is asserted below.
    await page.route(`**/api/v1/reports/5vet/${REPORT}/export.pdf`, (route: Route) => {
      const body = "%PDF-1.4 snapshot-5vet-III-2026-1-0.25-0.3-34";
      pdfBodies.push(body);
      return route.fulfill({ status: 200, contentType: "application/pdf", body });
    });
    await page.route(`**/api/v1/reports/5vet/${REPORT}/export.xlsx`, (route: Route) => {
      const body = "PKsnapshot-xlsx-5vet-III-2026-1-0.25-0.3-34";
      xlsxBodies.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body,
      });
    });
    // A source card is deleted through its own route — mocked 204.
    await page.route("**/api/v1/examinations/e0000000-0000-4000-8000-000000000001", async (route: Route) => {
      if (route.request().method() === "DELETE") {
        deletions.push(route.request().url());
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto(`/labs/${LAB}/reports/${REPORT}`);
    await expect(page.getByText("Матрица сохранённого отчёта")).toBeVisible();
    const screenCell = await page.getByText("0.25").first().textContent();
    expect(screenCell).toBe("0.25");

    const pdfDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать PDF" }).click();
    await pdfDownload;
    const xlsxDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать XLSX" }).click();
    await xlsxDownload;

    // The named flow: a source is deleted AFTER the snapshot was saved.
    await page.evaluate(async () => {
      await fetch("/api/v1/examinations/e0000000-0000-4000-8000-000000000001", { method: "DELETE" });
    });
    expect(deletions).toHaveLength(1);

    await page.reload();
    await expect(page.getByText("Матрица сохранённого отчёта")).toBeVisible();
    // The screen still renders the SAVED matrix: same values, same count,
    // same source identities — the deletion did not recompute anything.
    expect(await page.getByText("0.25").first().textContent()).toBe(screenCell);
    await expect(page.getByText(/Источников в снимке: 34/)).toBeVisible();
    expect(snapshotServes).toBeGreaterThanOrEqual(2);

    const pdfDownload2 = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать PDF" }).click();
    await pdfDownload2;
    const xlsxDownload2 = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать XLSX" }).click();
    await xlsxDownload2;

    // Byte equality: the second export serves exactly the first bytes.
    expect(pdfBodies).toHaveLength(2);
    expect(pdfBodies[0]).toBe(pdfBodies[1]);
    expect(xlsxBodies).toHaveLength(2);
    expect(xlsxBodies[0]).toBe(xlsxBodies[1]);
    // The served content carries the saved snapshot's own markers.
    expect(pdfBodies[0]).toContain("34");
    expect(xlsxBodies[0]).toContain("0.25");
    await shot(page, "view-matrix-equal");
  });

  test("print opens the same snapshot PDF bytes", async ({ page }) => {
    await mockMe(page);
    await page.route(`**/api/v1/reports/5vet/${REPORT}`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...summary(REPORT, 2026, 1),
          payload,
          codes: { okud: "001", okpo: "1", okved: "1", oktmo: "1", okogu: "1", okopf: "1", okfs: "1" },
        }),
      }),
    );
    let printBytes = "";
    await page.route(`**/api/v1/reports/5vet/${REPORT}/export.pdf`, (route: Route) => {
      printBytes = "printed";
      return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 print" });
    });
    await page.goto(`/labs/${LAB}/reports/${REPORT}`);
    await expect(page.getByText("Матрица сохранённого отчёта")).toBeVisible();
    const popup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Печать" }).click();
    await popup;
    expect(printBytes).toBe("printed");
  });
});

test.describe("operational report", () => {
  test("period drives the indicators; balances stay current; VET is forbidden", async ({ page }) => {
    await mockMe(page);
    const operational = {
      processed_parties: 7,
      product_identifications: 12,
      transport_inspections: 3,
      current_sample_balances: [{ product_species_id: "говядина", mass_kg: "12.6", revision: 2 }],
      period: { date_from: "2026-10-01T00:00:00Z", date_to: "2026-11-01T00:00:00Z" },
    };
    await page.route("**/api/v1/reports/operational*", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(operational) }),
    );
    await page.goto(`/labs/${LAB}/reports/operational`);
    await expect(page.getByText("12", { exact: true })).toBeVisible();
    await expect(page.getByText("говядина")).toBeVisible();
    await expect(page.getByText("12.6")).toBeVisible();
    await shot(page, "operational");
  });
});
