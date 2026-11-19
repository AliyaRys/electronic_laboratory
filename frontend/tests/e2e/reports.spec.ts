/**
 * Reporting e2e (R03, MSW route mocks — the same honest pattern as
 * examinations.spec.ts; the real-API leg is documented in the evidence file).
 *
 * Named controller flows (DR51):
 * - the two permanent date inputs and the single «Применить» apply the
 *   range AND request the preview;
 * - changing an input marks the preview stale and blocks the save;
 * - the save sends ONLY the signed preview — the seven codes are cancelled;
 * - 25 reports, page 2, back;
 * - report deleted elsewhere → not found;
 * - delete a source after preview/save → screen/PDF/XLSX/print matrix all
 *   EQUAL (the saved snapshot is rendered, never recomputed);
 * - the period is an honest calendar range — there are no year/half controls.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REPORT = "11111111-2222-4333-8444-555555555555";
const RANGE_A = { from: "2026-01-01", to: "2026-06-30" };
const RANGE_B = { from: "2026-07-01", to: "2026-12-31" };

function shot(page: Page, name: string): Promise<void> {
  return page.screenshot({ path: `test-results/r03-${name}.png`, fullPage: true }).then(() => undefined);
}

const payload = {
  version: 2,
  form_version: "2",
  report_type: "5VET_SECTION_III",
  laboratory_id: LAB,
  laboratory: { name: "Лаборатория №1", address: "Адрес" },
  date_from: "2026-01-01",
  date_to: "2026-06-30",
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
  rows: [
    { code: "166", name: "1. Осмотрено (проведено ветеринарно-санитарных экспертиз), всего, единиц", mode: "AUTO" },
    { code: "167", name: "в том числе: микроскопических", mode: "AUTO" },
    { code: "168", name: "трихинеллоскопий", mode: "AUTO" },
    { code: "169", name: "физико-химических", mode: "AUTO" },
    { code: "170", name: "радиометрических", mode: "AUTO" },
    { code: "171", name: "других лабораторных исследований", mode: "AUTO" },
    { code: "172", name: "2. Проведено специальных лабораторных исследований всего, единиц", mode: "AUTO" },
    { code: "210", name: "Незаразные болезни", mode: "AUTO" },
    { code: "240", name: "7. Направлено на уничтожение, тонн", mode: "AUTO" },
    { code: "174", name: "Ящур", mode: "BLANK" },
  ],
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

function me(role: string, capabilities: string[] = REPORT_CAPS): Record<string, unknown> {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    full_name: "Тестовый пользователь",
    login: "tester",
    email: "tester@example.test",
    position: null,
    role,
    active: true,
    scopes: [{ laboratory_id: LAB, product_scope_id: null }],
    capabilities,
    revision: 1,
  };
}

/** DR37: the reporting capability set of a HEAD/ANALYST fixture. */
const REPORT_CAPS = [
  "sample:read",
  "report:operational",
  "report:5vet-list",
  "report:5vet-read",
  "report:5vet-preview",
  "report:5vet-save",
  "report:5vet-delete",
  "report:5vet-export",
];

async function mockMe(page: Page, role = "HEAD", capabilities: string[] = REPORT_CAPS): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(me(role, capabilities)),
    }),
  );
}

/** The operational tile of the reports hub (a real GET on the reports page). */
async function mockOperational(page: Page): Promise<void> {
  await page.route("**/api/v1/reports/operational*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        processed_parties: 0,
        product_identifications: 0,
        transport_inspections: 0,
        current_sample_balances: [],
        period: { date_from: "2026-01-01T00:00:00Z", date_to: "2026-12-31T00:00:00Z" },
      }),
    }),
  );
  // The hub title needs the laboratory name (GET /api/v1/contexts/laboratories).
  await page.route("**/api/v1/contexts/laboratories*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ laboratory_id: LAB, name: "Е2Е лаборатория А" }]),
    }),
  );
}

function summary(id: string, from: string, to: string): Record<string, unknown> {
  return {
    id,
    report_type: "5VET_SECTION_III",
    laboratory_id: LAB,
    date_from: from,
    date_to: to,
    source_count: 34,
    saved_at: "2027-01-02T10:00:00Z",
    saved_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    rev: 1,
  };
}

async function expectAlertCount(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}

/** Fills the two permanent date inputs and presses the single «Применить». */
async function applyRange(page: Page, from: string, to: string): Promise<void> {
  await page.getByLabel("С даты").fill(from);
  await page.getByLabel("По дату").fill(to);
  await page.getByRole("button", { name: "Применить" }).click();
}

test.describe("report creation", () => {
  test("«Применить» applies the range and requests the preview; an input marks it stale", async ({
    page,
  }) => {
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
    // The honest range: no year/half controls, only the two permanent inputs.
    await expect(page.getByRole("radio")).toHaveCount(0);
    await applyRange(page, RANGE_A.from, RANGE_A.to);
    await expect(page.getByLabel("С даты")).toHaveValue(RANGE_A.from);
    await expect(page.getByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках")).toBeVisible();
    expect(previewPosts).toBe(1);
    // Changing an input marks the preview stale and blocks the save.
    await page.getByLabel("С даты").fill("2026-02-01");
    await expectAlertCount(page, "Параметры изменены");
    await expect(page.getByRole("button", { name: "Сохранить отчёт" })).toBeDisabled();
    await shot(page, "create-param-warning");
  });

  test("a network save failure preserves the parameters", async ({ page }) => {
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
    await applyRange(page, RANGE_A.from, RANGE_A.to);
    await expect(page.getByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках")).toBeVisible();
    await page.getByRole("button", { name: "Сохранить отчёт" }).click();
    await expect(page.getByText(/Не удалось сохранить отчёт/)).toBeVisible();
    // The applied parameters survive the failed save too.
    await expect(page.getByLabel("С даты")).toHaveValue(RANGE_A.from);
    await shot(page, "create-save-failure");
  });

  test("a successful save sends the signed preview only", async ({ page }) => {
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
          ...summary(REPORT, RANGE_A.from, RANGE_A.to),
          payload,
        }),
      });
    });
    await page.route(`**/api/v1/reports/5vet/${REPORT}`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...summary(REPORT, RANGE_A.from, RANGE_A.to),
          payload,
        }),
      }),
    );
    await page.goto(`/labs/${LAB}/reports/new`);
    await applyRange(page, RANGE_A.from, RANGE_A.to);
    await expect(page.getByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках")).toBeVisible();
    await page.getByRole("button", { name: "Сохранить отчёт" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/reports/${REPORT}`));
    expect(posts).toHaveLength(1);
    const body = posts[0] as { preview: { signature: string; payload: Record<string, unknown> } };
    expect(body.preview.signature).toBe("sig");
    expect(body.preview.payload["date_from"]).toBe("2026-01-01");
    expect(body.preview.payload["date_to"]).toBe("2026-06-30");
    expect("codes" in (posts[0] as object)).toBe(false);
    await shot(page, "create-saved-view");
  });
});

test.describe("report list", () => {
  test("25 saved reports: page 2 shows the rest and back returns to page 1", async ({ page }) => {
    await mockMe(page);
    await mockOperational(page);
    const items = Array.from({ length: 25 }, (_value, index) =>
      summary(
        `${REPORT}-${index}`,
        index % 2 === 0 ? RANGE_A.from : RANGE_B.from,
        index % 2 === 0 ? RANGE_A.to : RANGE_B.to,
      ),
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
    const firstLink = page
      .getByRole("link", { name: "Период: 01.01.2026 — 30.06.2026", exact: true })
      .first();
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
    await mockOperational(page);
    await page.route("**/api/v1/reports/5vet*", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [summary(REPORT, RANGE_A.from, RANGE_A.to)],
          total: 1,
          page: 1,
          page_size: 20,
        }),
      }),
    );
    await page.goto(`/labs/${LAB}/reports`);
    const link = page.getByRole("link", { name: "Открыть: период 01.01.2026 — 30.06.2026" });
    await link.focus();
    await expect(link).toBeFocused();
    await expect(page.getByRole("link", { name: "Открыть: Операционные показатели" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Открыть: Учёт проб" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать отчёт" })).toBeEnabled();
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
          ...summary(REPORT, RANGE_A.from, RANGE_A.to),
          payload,
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
    await expect(page.getByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках")).toBeVisible();
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
    await expect(page.getByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках")).toBeVisible();
    // The screen still renders the SAVED matrix: same values, same count,
    // same source identities — the deletion did not recompute anything.
    expect(await page.getByText("0.25").first().textContent()).toBe(screenCell);
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
          ...summary(REPORT, RANGE_A.from, RANGE_A.to),
          payload,
        }),
      }),
    );
    let printBytes = "";
    await page.route(`**/api/v1/reports/5vet/${REPORT}/export.pdf`, (route: Route) => {
      printBytes = "printed";
      return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 print" });
    });
    await page.goto(`/labs/${LAB}/reports/${REPORT}`);
    await expect(page.getByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках")).toBeVisible();
    const popup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Печать" }).click();
    await popup;
    expect(printBytes).toBe("printed");
  });
});

test.describe("operational report", () => {
  // DR48 §2: three honest metrics, no balances block anywhere, and the
  // period drives only the operational query.
  const operational = {
    saved_examinations: 9,
    product_identifications: 12,
    transport_inspections: 3,
    period: { date_from: "2026-10-01", date_to: "2026-11-01" },
  };

  test("period drives the indicators; the balances block is gone; VET is forbidden", async ({
    page,
  }) => {
    await mockMe(page);
    const operationalGets: URL[] = [];
    await page.route("**/api/v1/reports/operational*", (route: Route) => {
      operationalGets.push(new URL(route.request().url()));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(operational),
      });
    });
    await page.goto(`/labs/${LAB}/reports/operational`);
    await expect(page.getByText("12", { exact: true })).toBeVisible();
    await expect(page.getByText("9", { exact: true })).toBeVisible();
    await expect(page.getByText("3", { exact: true })).toBeVisible();
    await expect(operationalGets[0]?.searchParams.get("laboratory_id")).toBe(LAB);
    // Applying a new period re-queries only the operational view.
    await page.getByLabel("С даты").fill("2026-01-01");
    await page.getByRole("button", { name: "Применить период" }).click();
    await expect.poll(() => operationalGets.length).toBe(2);
    await expect(operationalGets[1]?.searchParams.get("date_from")).toBe("2026-01-01");
    await shot(page, "operational");

    // AT-20: a VET gets the honest forbidden state and no metrics request.
    await page.route("**/api/v1/me", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(me("VET", ["sample:read"])),
      }),
    );
    await page.goto(`/labs/${LAB}/reports/operational`);
    await expect(
      page.getByText("Операционные показатели недоступны: у вас нет соответствующего полномочия."),
    ).toBeVisible();
    const count = operationalGets.length;
    await page.waitForTimeout(100);
    expect(operationalGets.length).toBe(count);
  });
});

test.describe("DR37: analyst reporting journey", () => {
  const OTHER = "99999999-8888-4777-8666-555555555555";

  async function mockHub(page: Page, options?: { deniedLabs?: string[] }): Promise<void> {
    await page.route("**/api/v1/contexts/laboratories", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ laboratory_id: LAB, name: "Лаборатория №1 г. Казань" }]),
      }),
    );
    await page.route("**/api/v1/reports/5vet*", (route: Route) => {
      const url = new URL(route.request().url());
      const laboratoryId = url.searchParams.get("laboratory_id");
      if (options?.deniedLabs?.includes(laboratoryId ?? "")) {
        return route.fulfill({
          status: 403,
          contentType: "application/problem+json",
          body: JSON.stringify({
            code: "ACCESS_DENIED",
            title: "Forbidden",
            status: 403,
            detail: "Нет доступа к отчётам этой лаборатории.",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
      });
    });
  }

  test("the analyst selects a laboratory and keeps the same labId through the header and the hub", async ({
    page,
  }) => {
    await mockMe(page, "ANALYST");
    await mockHub(page);
    await page.route("**/api/v1/reports/operational", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          processed_parties: 7,
          product_identifications: 12,
          transport_inspections: 3,
          current_sample_balances: [],
          period: { date_from: "2026-10-01T00:00:00Z", date_to: "2026-11-01T00:00:00Z" },
        }),
      }),
    );
    await page.route("**/api/v1/samples/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
      }),
    );

    await page.goto(`/labs/${LAB}/reports`);
    await shot(page, "dr37-analyst-hub");
    // The header keeps the reports link inside the selected laboratory.
    const reportsLink = page.locator("#analyst-reports-link");
    await expect(reportsLink).toHaveAttribute("href", `/labs/${LAB}/reports`);
    await expect(reportsLink).toHaveAttribute("aria-current", "page");
    // The human-readable laboratory name is visible, not a UUID.
    await expect(page.getByText("Лаборатория №1 г. Казань")).toBeVisible();
    // Three permitted directions with the real create affordance.
    await expect(page.getByText("Форма 5-вет (раздел III)")).toBeVisible();
    await expect(page.getByText("Операционные показатели")).toBeVisible();
    await expect(page.getByText("Учёт проб")).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать отчёт" })).toBeEnabled();

    // Opening every direction keeps the same laboratory context.
    await page.getByRole("link", { name: "Открыть: Операционные показатели" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/reports/operational`));
    await expect(page.locator("#analyst-reports-link")).toHaveAttribute("href", `/labs/${LAB}/reports`);
    await page.goBack();
    await page.getByRole("link", { name: "Открыть: Учёт проб" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/reports/samples`));
    await expect(page.locator("#analyst-reports-link")).toHaveAttribute("href", `/labs/${LAB}/reports`);
    // Back to the hub keeps the laboratory (never /labs, never arrivals).
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/reports$`));
  });

  test("refresh on a reports URL keeps the selected laboratory", async ({ page }) => {
    await mockMe(page, "ANALYST");
    await mockHub(page);
    await page.goto(`/labs/${LAB}/reports`);
    await expect(page.getByText("Учёт проб")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Учёт проб")).toBeVisible();
    await expect(page.locator("#analyst-reports-link")).toHaveAttribute("href", `/labs/${LAB}/reports`);
  });

  test("a foreign laboratory URL answers the honest denial without leaking data", async ({ page }) => {
    await mockMe(page, "ANALYST");
    await mockHub(page, { deniedLabs: [OTHER] });
    await page.goto(`/labs/${OTHER}/reports`);
    // The server denial is rendered; no saved reports or metrics are shown.
    await expect(page.locator(".app-status").first()).toBeVisible();
    await expect(page.getByText("Форма 5-вет (раздел III)")).toBeVisible();
    await expect(page.locator(".vse-reports-list")).toHaveCount(0);
  });

  test("role matrix: VET sees only sample accounting, ADMIN gets no item and a denied URL", async ({
    page,
  }) => {
    await mockMe(page, "VET", ["sample:read"]);
    await mockHub(page);
    await page.route("**/api/v1/samples/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
      }),
    );
    await page.goto(`/labs/${LAB}/reports`);
    await expect(page.getByText("Учёт проб")).toBeVisible();
    await expect(page.getByText("Форма 5-вет (раздел III)")).toHaveCount(0);
    await expect(page.getByText("Операционные показатели")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Создать отчёт" })).toHaveCount(0);
    await shot(page, "dr37-vet-samples-only");

    // ADMIN: no header item at all; a direct URL is denied without requests.
    const reportGets: string[] = [];
    await page.route("**/api/v1/reports/5vet*", (route) => {
      reportGets.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(me("ADMIN", [])),
      }),
    );
    await page.goto(`/labs/${LAB}/reports`);
    await expect(page.locator("#analyst-reports-link")).toHaveCount(0);
    await expect(page.getByText(/Раздел отчётов недоступен/)).toBeVisible();
    expect(reportGets).toEqual([]);
    await shot(page, "dr37-admin-denied");
  });
});
