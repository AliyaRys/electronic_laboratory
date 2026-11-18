/**
 * SampleExportActions tests (DR49 §10.3): applied query parameters, busy
 * states, the Problem check before any Blob/download, the server filename,
 * the compact error with «Повторить» and the unmount abort.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SampleExportActions } from "./SampleExportActions";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function renderActions(dateFrom = "", dateTo = ""): void {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <SampleExportActions laboratoryId={LAB} dateFrom={dateFrom} dateTo={dateTo} />
    </QueryClientProvider>,
  );
}

describe("SampleExportActions (DR49 §10)", () => {
  it("sends laboratory_id and the applied dates; empty bounds are omitted", async () => {
    const user = userEvent.setup();
    const gets: URL[] = [];
    server.use(
      http.get("*/api/v1/samples/accounting/export.pdf", ({ request }) => {
        gets.push(new URL(request.url));
        return new HttpResponse(new Blob(["%PDF-fake"], { type: "application/pdf" }), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("Учёт_проб_Лаб_01.11.2026_30.11.2026.pdf")}`,
          },
        });
      }),
    );
    const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderActions("2026-11-01", "2026-11-30");
    await user.click(await screen.findByRole("button", { name: "Скачать PDF" }));
    await waitFor(() => expect(gets).toHaveLength(1));
    const url = gets[0] ?? new URL("http://localhost");
    expect(url.searchParams.get("laboratory_id")).toBe(LAB);
    expect(url.searchParams.get("date_from")).toBe("2026-11-01");
    expect(url.searchParams.get("date_to")).toBe("2026-11-30");
    // The server filename is used for the download.
    const anchor = downloadSpy.mock.contexts[0] as HTMLAnchorElement | undefined;
    expect(anchor?.download).toBe("Учёт_проб_Лаб_01.11.2026_30.11.2026.pdf");
    downloadSpy.mockRestore();
  });

  it("shows the busy label and disables both buttons during the request", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/samples/accounting/export.xlsx", async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return new HttpResponse(new Blob(["PK-x"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      }),
    );
    renderActions();
    await user.click(await screen.findByRole("button", { name: "Скачать XLSX" }));
    expect(await screen.findByRole("button", { name: "Формируем XLSX…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Скачать PDF" })).toBeDisabled();
  });

  it("a 403 Problem creates no Blob and no download, and offers «Повторить»", async () => {
    const user = userEvent.setup();
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:fake");
    server.use(
      http.get("*/api/v1/samples/accounting/export.pdf", () =>
        HttpResponse.json(
          { code: "ACCESS_DENIED", detail: "Нет полномочия чтения проб.", status: 403 },
          { status: 403, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderActions();
    await user.click(await screen.findByRole("button", { name: "Скачать PDF" }));
    expect(await screen.findByText(/ACCESS_DENIED/)).toBeVisible();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
    expect(downloadSpy).not.toHaveBeenCalled();
    downloadSpy.mockRestore();
    createObjectURLSpy.mockRestore();
  });

  it("a retry repeats the same kind and the same applied parameters", async () => {
    const user = userEvent.setup();
    const gets: URL[] = [];
    let failing = true;
    server.use(
      http.get("*/api/v1/samples/accounting/export.xlsx", ({ request }) => {
        gets.push(new URL(request.url));
        if (failing) {
          return HttpResponse.json(
            { code: "RENDERER_UNAVAILABLE", detail: "Движок рендера недоступен.", status: 503 },
            { status: 503, headers: { "content-type": "application/problem+json" } },
          );
        }
        return new HttpResponse(new Blob(["PK"]), {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        });
      }),
    );
    const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderActions("2026-11-01", "");
    await user.click(await screen.findByRole("button", { name: "Скачать XLSX" }));
    await screen.findByText(/RENDERER_UNAVAILABLE/);
    failing = false;
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(gets.length).toBe(2));
    expect(gets[1]?.searchParams.get("date_from")).toBe("2026-11-01");
    expect(gets[1]?.searchParams.has("date_to")).toBe(false);
    expect(downloadSpy).toHaveBeenCalled();
    downloadSpy.mockRestore();
  });

  it("a wrong content-type answers an honest error and downloads nothing", async () => {
    const user = userEvent.setup();
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fake");
    const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    server.use(
      http.get("*/api/v1/samples/accounting/export.pdf", () =>
        new HttpResponse('<html><body>not a pdf</body></html>', {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    renderActions();
    await user.click(await screen.findByRole("button", { name: "Скачать PDF" }));
    expect(
      await screen.findByText(/неожиданным типом/),
    ).toBeVisible();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
    expect(downloadSpy).not.toHaveBeenCalled();
    downloadSpy.mockRestore();
    createObjectURLSpy.mockRestore();
  });

  it("unmount aborts the in-flight request", async () => {
    let aborted = false;
    server.use(
      http.get("*/api/v1/samples/accounting/export.pdf", async ({ request }) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        aborted = request.signal.aborted;
        return new HttpResponse(new Blob(["%PDF-"]));
      }),
    );
    const client = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <SampleExportActions laboratoryId={LAB} dateFrom="" dateTo="" />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Скачать PDF" }));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(aborted).toBe(true);
  });
});
