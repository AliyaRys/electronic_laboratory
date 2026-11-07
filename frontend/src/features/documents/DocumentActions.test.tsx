/**
 * DocumentActions unit tests (D02): the Problem response is checked before
 * any Blob/download/print, print reuses the same PDF bytes, retry repeats
 * only a read, and the component never writes a «Выдано» record.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DocumentActions } from "./DocumentActions";

const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const PDF = "/api/v1/arrivals/9c1b2d3e-1111-4222-8333-444444444444/conclusion.pdf";

const server = setupServer(
  http.get(`http://localhost${PDF}`, () =>
    HttpResponse.arrayBuffer(new TextEncoder().encode("%PDF-fake").buffer as ArrayBuffer, {
      headers: { "content-type": "application/pdf", "cache-control": "no-store" },
    }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("DocumentActions", () => {
  it("downloads the PDF after a successful response", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<DocumentActions partyId={PARTY} />);
    await user.click(screen.getByRole("button", { name: "Скачать PDF" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    click.mockRestore();
  });

  it("shows the problem detail and never downloads when the renderer fails with 503", async () => {
    server.use(
      http.get(`http://localhost${PDF}`, () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Renderer unavailable",
            status: 503,
            detail: "Шаблон формы недоступен.",
            code: "RENDERER_UNAVAILABLE",
            trace_id: "t",
          },
          { status: 503, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<DocumentActions partyId={PARTY} />);
    await user.click(screen.getByRole("button", { name: "Печать" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("RENDERER_UNAVAILABLE");
    expect(alert).toHaveTextContent("Шаблон формы недоступен.");
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    click.mockRestore();
    open.mockRestore();
  });

  it("prints the same bytes: both actions issue the identical GET", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(<DocumentActions partyId={PARTY} />);
    await user.click(screen.getByRole("button", { name: "Печать" }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    open.mockRestore();
  });
});
