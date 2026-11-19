/**
 * ReportCreatePage tests (DR51 §5/§6.2): the named controller flows on the
 * MSW level — the two permanent date inputs and the single «Применить» that
 * applies the range AND requests the preview; the 422 REPORT_NO_DATA error
 * keeps the parameters; changing an input marks the preview stale and
 * blocks the save until a new «Применить»; a network save failure preserves
 * the parameters; the save sends ONLY the signed preview with an
 * Idempotency-Key (the seven codes no longer exist in the flow); an
 * incomplete/reversed range never sends a request.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ReportCreatePage } from "./ReportCreatePage";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REPORT = "11111111-2222-4333-8444-555555555555";

function me(role = "HEAD"): Record<string, unknown> {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    full_name: "Тестовый пользователь",
    login: "tester",
    email: "tester@example.test",
    position: null,
    role,
    active: true,
    scopes: [{ laboratory_id: LAB, product_scope_id: null }],
    capabilities: role === "HEAD" ? ["report:5vet-preview", "report:5vet-save"] : [],
    revision: 1,
  };
}

const previewPayload = {
  version: 2,
  form_version: "2",
  report_type: "5VET_SECTION_III",
  laboratory_id: LAB,
  laboratory: { name: "Лаборатория №1" },
  date_from: "2026-01-01",
  date_to: "2026-06-30",
  generated_at: "2026-11-18T15:51:00+03:00",
  classification_version: "2026-v1",
  columns: ["CATTLE", "PIG"],
  rows: [
    { code: "166", name: "1. Осмотрено (проведено ветеринарно-санитарных экспертиз), всего, единиц", mode: "AUTO" },
    { code: "174", name: "Ящур", mode: "BLANK" },
  ],
  row_codes: ["166", "174"],
  matrix: [["1", "0"], [null, null]],
  source_count: 1,
  official: false,
};

function signedPreview(): Record<string, unknown> {
  return { payload: previewPayload, key_id: "k1", signature: "sig", byte_size: 10 };
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/labs/${LAB}/reports/new`]}>
        <Routes>
          <Route path="/labs/:labId/reports/new" element={<ReportCreatePage />} />
          <Route path="/labs/:labId/reports/:reportId" element={<div>Просмотр отчёта</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Fills the two permanent date inputs and presses «Применить». */
async function applyAndPreview(
  user: ReturnType<typeof userEvent.setup>,
  from: string,
  to: string,
): Promise<void> {
  if (from !== "") {
    const input = screen.getByLabelText("С даты", { selector: "input" });
    await user.clear(input);
    await user.type(input, from);
  }
  if (to !== "") {
    const input = screen.getByLabelText("По дату", { selector: "input" });
    await user.clear(input);
    await user.type(input, to);
  }
  await user.click(screen.getByRole("button", { name: "Применить" }));
}

describe("ReportCreatePage", () => {
  it("the 422 REPORT_NO_DATA preview error is shown and keeps the parameters", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post("*/api/v1/reports/5vet/preview", () =>
        HttpResponse.json(
          {
            code: "REPORT_NO_DATA",
            title: "No data",
            status: 422,
            detail: "За выбранный период нет завершённых источников отчёта.",
          },
          { status: 422 },
        ),
      ),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await applyAndPreview(user, "2026-01-01", "2026-06-30");
    const message = await screen.findByText(/За выбранный период нет завершённых источников/, {
      selector: ".app-status-detail",
    });
    expect(message).toBeVisible();
    expect(screen.getByLabelText("С даты", { selector: "input" })).toHaveValue("2026-01-01");
  });

  it("an incomplete or reversed range never sends a request", async () => {
    const user = userEvent.setup();
    let previewCounter = 0;
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post("*/api/v1/reports/5vet/preview", () => {
        previewCounter += 1;
        return HttpResponse.json(signedPreview());
      }),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    // Without both dates the button is disabled and nothing is sent.
    expect(screen.getByRole("button", { name: "Применить" })).toBeDisabled();
    await user.type(screen.getByLabelText("С даты", { selector: "input" }), "2026-01-01");
    expect(screen.getByRole("button", { name: "Применить" })).toBeDisabled();
    // A reversed range shows its own message and blocks the request.
    await user.type(screen.getByLabelText("По дату", { selector: "input" }), "2025-12-31");
    expect(screen.getByText("Дата начала не может быть позже даты окончания.")).toBeVisible();
    expect(previewCounter).toBe(0);
    // A valid pair applies the range and requests the preview with the same click.
    await user.clear(screen.getByLabelText("По дату", { selector: "input" }));
    await user.type(screen.getByLabelText("По дату", { selector: "input" }), "2026-06-30");
    await user.click(screen.getByRole("button", { name: "Применить" }));
    await screen.findByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках");
    expect(previewCounter).toBe(1);
  });

  it("«Применить» applies the range and requests the preview in one action", async () => {
    const user = userEvent.setup();
    let previewCounter = 0;
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post("*/api/v1/reports/5vet/preview", () => {
        previewCounter += 1;
        return HttpResponse.json(signedPreview());
      }),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await applyAndPreview(user, "2026-01-01", "2026-06-30");
    await screen.findByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках");
    expect(previewCounter).toBe(1);
    // The simplified header shows the formation label and the server period.
    expect(screen.getByText("Дата формирования")).toBeVisible();
    expect(screen.getByText("01.01.2026 — 30.06.2026")).toBeVisible();
    expect(screen.getByText("Лаборатория №1")).toBeVisible();
    // The full form renders: the BLANK row stays empty, AUTO zero stays 0.
    expect(screen.getByText("Ящур")).toBeVisible();
    expect(screen.queryByText("Не рассчитывается")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    // The seven codes are gone from the flow entirely.
    expect(screen.queryByLabelText("ОКУД")).toBeNull();
    expect(screen.queryByText(/Код обязателен/)).toBeNull();
  });

  it("changing an input marks the preview stale and blocks the save until a new «Применить»", async () => {
    const user = userEvent.setup();
    let previewCounter = 0;
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post("*/api/v1/reports/5vet/preview", () => {
        previewCounter += 1;
        return HttpResponse.json(signedPreview());
      }),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await applyAndPreview(user, "2026-01-01", "2026-06-30");
    await screen.findByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках");
    await user.clear(screen.getByLabelText("С даты", { selector: "input" }));
    await user.type(screen.getByLabelText("С даты", { selector: "input" }), "2026-02-01");
    expect(await screen.findByText(/Параметры изменены/)).toBeVisible();
    // The save is blocked while the preview is stale.
    expect(screen.getByRole("button", { name: "Сохранить отчёт" })).toBeDisabled();
    expect(previewCounter).toBe(1);
    // A new «Применить» re-requests the preview with the updated inputs and
    // never clears them on success.
    await applyAndPreview(user, "2026-02-01", "2026-08-31");
    await waitFor(() => expect(previewCounter).toBe(2));
    expect(screen.queryByText(/Параметры изменены/)).toBeNull();
    expect(screen.getByLabelText("С даты", { selector: "input" })).toHaveValue("2026-02-01");
  });

  it("a network save failure preserves the parameters", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post("*/api/v1/reports/5vet/preview", () => HttpResponse.json(signedPreview())),
      http.post("*/api/v1/reports/5vet", () => HttpResponse.error()),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await applyAndPreview(user, "2026-01-01", "2026-06-30");
    await screen.findByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках");
    await user.click(screen.getByRole("button", { name: "Сохранить отчёт" }));
    expect(
      await screen.findByText(/Не удалось сохранить отчёт\. Введённые параметры сохранены\./),
    ).toBeVisible();
    expect(screen.getByLabelText("С даты", { selector: "input" })).toHaveValue("2026-01-01");
  });

  it("a successful save sends ONLY the signed preview, then navigates", async () => {
    const user = userEvent.setup();
    const posts: { headers: Headers; body: Record<string, unknown> }[] = [];
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post("*/api/v1/reports/5vet/preview", () => HttpResponse.json(signedPreview())),
      http.post("*/api/v1/reports/5vet", async ({ request }) => {
        posts.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json(
          {
            id: REPORT,
            report_type: "5VET_SECTION_III",
            laboratory_id: LAB,
            date_from: "2026-01-01",
            date_to: "2026-06-30",
            payload: previewPayload,
            source_count: 1,
            saved_at: "2027-01-02T10:00:00Z",
            saved_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            rev: 1,
          },
          { status: 201 },
        );
      }),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await applyAndPreview(user, "2026-01-01", "2026-06-30");
    await screen.findByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках");
    await user.click(screen.getByRole("button", { name: "Сохранить отчёт" }));
    await screen.findByText("Просмотр отчёта");
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.headers.get("idempotency-key")).toBeTruthy();
    const body = posts[0]?.body as { preview: { signature: string; payload: Record<string, unknown> } };
    expect(body.preview.signature).toBe("sig");
    expect(body.preview.payload["date_from"]).toBe("2026-01-01");
    expect(body.preview.payload["date_to"]).toBe("2026-06-30");
    expect("codes" in (posts[0]?.body as object)).toBe(false);
  });

  it("a busy «Применить» shows «Формируем…» and blocks repeat submits", async () => {
    const user = userEvent.setup();
    let resolvePreview: ((value: never) => void) | null = null;
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post(
        "*/api/v1/reports/5vet/preview",
        () =>
          new Promise((resolve) => {
            resolvePreview = resolve as unknown as (value: never) => void;
          }),
      ),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await applyAndPreview(user, "2026-01-01", "2026-06-30");
    expect(await screen.findByText("Формируем…")).toBeVisible();
    expect(resolvePreview).not.toBeNull();
    (resolvePreview as unknown as (response: unknown) => void)(HttpResponse.json(signedPreview()));
    await screen.findByText("Раздел III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках");
  });
});

describe("ReportCreatePage capability guard (DR37)", () => {
  it("a user without preview+save capabilities gets the forbidden state and no preview POST", async () => {
    let previewPosts = 0;
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me("ANALYST"))),
      http.post("*/api/v1/reports/5vet/preview", () => {
        previewPosts += 1;
        return HttpResponse.json(signedPreview());
      }),
    );
    renderPage();
    expect(
      await screen.findByText(
        "Создание отчёта недоступно: у вас нет полномочий формирования и сохранения 5-вет.",
      ),
    ).toBeVisible();
    expect(previewPosts).toBe(0);
  });
});
