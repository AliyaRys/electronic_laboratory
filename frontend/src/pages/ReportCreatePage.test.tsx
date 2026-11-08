/**
 * ReportCreatePage tests (R03): the named controller flows on the MSW level —
 * the 422 REPORT_NO_DATA preview error keeps the parameters; changing a
 * parameter clears the preview and the codes with a warning; a network save
 * failure preserves both the parameters and the codes; the save sends the
 * signed preview and the seven trimmed codes with an Idempotency-Key.
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
    capabilities: [],
    revision: 1,
  };
}

const previewPayload = {
  version: 1,
  report_type: "5VET_SECTION_III",
  laboratory_id: LAB,
  laboratory: { name: "Лаборатория №1" },
  year: 2026,
  half: 1,
  classification_version: "2026-v1",
  columns: ["PIG"],
  row_codes: ["166"],
  matrix: [["1"]],
  source_count: 1,
  official: false,
};

function signedPreview(): Record<string, unknown> {
  return { payload: previewPayload, key_id: "k1", signature: "sig", byte_size: 10 };
}

function renderPage(): { savedViews: string[] } {
  const savedViews: string[] = [];
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
  void savedViews;
  return { savedViews };
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
            detail: "За выбранное полугодие нет завершённых источников отчёта.",
          },
          { status: 422 },
        ),
      ),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await user.click(screen.getByRole("button", { name: "Сформировать предварительный просмотр" }));
    const message = await screen.findByText(/За выбранное полугодие нет завершённых источников/, {
      selector: ".app-status-detail",
    });
    expect(message).toBeVisible();
    // The parameters stay selected.
    expect(screen.getByLabelText("Год")).toBeEnabled();
    expect(screen.getByRole("radio", { name: /I \(январь—июнь\)/ })).toBeChecked();
  });

  it("a parameter change clears the preview and the codes with a warning", async () => {
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
    await user.click(screen.getByRole("button", { name: "Сформировать предварительный просмотр" }));
    await screen.findByText("Предварительный просмотр матрицы");
    await user.type(screen.getByLabelText("ОКУД"), "001");
    expect(screen.getByLabelText("ОКУД")).toHaveValue("001");
    // Changing the half clears preview + codes and shows the warning.
    await user.click(screen.getByRole("radio", { name: /II \(июль—декабрь\)/ }));
    expect(await screen.findByText(/Параметры изменены/)).toBeVisible();
    // The cleared state removes the preview matrix and the code inputs.
    expect(screen.queryByLabelText("ОКУД")).toBeNull();
    expect(screen.queryByText("Предварительный просмотр матрицы")).toBeNull();
    expect(previewCounter).toBe(1);
  });

  it("a network save failure preserves both the parameters and the codes", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post("*/api/v1/reports/5vet/preview", () => HttpResponse.json(signedPreview())),
      http.post("*/api/v1/reports/5vet", () => HttpResponse.error()),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await user.click(screen.getByRole("button", { name: "Сформировать предварительный просмотр" }));
    await screen.findByText("Предварительный просмотр матрицы");
    for (const label of ["ОКУД", "ОКПО", "ОКВЭД", "ОКТМО", "ОКОГУ", "ОКОПФ", "ОКФС"]) {
      await user.type(screen.getByLabelText(label), "001");
    }
    await user.click(screen.getByRole("button", { name: "Сохранить отчёт" }));
    expect(
      await screen.findByText(/Не удалось сохранить отчёт. Введённые параметры и коды сохранены./),
    ).toBeVisible();
    expect(screen.getByLabelText("ОКУД")).toHaveValue("001");
    expect(screen.getByLabelText("ОКФС")).toHaveValue("001");
    // The parameters are still on screen and unchanged.
    expect(screen.getByRole("radio", { name: /I \(январь—июнь\)/ })).toBeChecked();
  });

  it("a successful save sends the signed preview and the trimmed codes, then navigates", async () => {
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
            year: 2026,
            half: 1,
            payload: previewPayload,
            codes: { okud: "001" },
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
    await user.click(screen.getByRole("button", { name: "Сформировать предварительный просмотр" }));
    await screen.findByText("Предварительный просмотр матрицы");
    await user.type(screen.getByLabelText("ОКУД"), " 001 ");
    for (const label of ["ОКПО", "ОКВЭД", "ОКТМО", "ОКОГУ", "ОКОПФ", "ОКФС"]) {
      await user.type(screen.getByLabelText(label), "1");
    }
    await user.click(screen.getByRole("button", { name: "Сохранить отчёт" }));
    await screen.findByText("Просмотр отчёта");
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.headers.get("idempotency-key")).toBeTruthy();
    const body = posts[0]?.body as { preview: { signature: string }; codes: Record<string, string> };
    expect(body.preview.signature).toBe("sig");
    expect(body.codes["okud"]).toBe("001"); // trimmed, leading zero kept
  });

  it("blank codes block the save without a network call", async () => {
    const user = userEvent.setup();
    let saveCounter = 0;
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.post("*/api/v1/reports/5vet/preview", () => HttpResponse.json(signedPreview())),
      http.post("*/api/v1/reports/5vet", () => {
        saveCounter += 1;
        return HttpResponse.json({});
      }),
    );
    renderPage();
    await screen.findByText("Параметры отчёта");
    await user.click(screen.getByRole("button", { name: "Сформировать предварительный просмотр" }));
    await screen.findByText("Предварительный просмотр матрицы");
    await user.click(screen.getByRole("button", { name: "Сохранить отчёт" }));
    const codeErrors = await screen.findAllByText("Код обязателен и не может быть пустым.");
    expect(codeErrors.length).toBe(7);
    expect(saveCounter).toBe(0);
  });
});
