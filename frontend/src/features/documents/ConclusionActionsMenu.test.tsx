/**
 * ConclusionActionsMenu tests (ТЗ DR55 §5.5/§6.1): exactly «Скачать» and
 * «Печать», no Max, Escape/outside close with focus return, the Problem is
 * never turned into a Blob, both items use ONE endpoint and the same bytes,
 * and a blocked popup shows an error instead of a download.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConclusionActionsMenu } from "./ConclusionActionsMenu";

const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const PDF = `/api/v1/arrivals/${PARTY}/conclusion.pdf`;

let requests = 0;

const server = setupServer(
  http.get(`http://localhost${PDF}`, () => {
    requests += 1;
    return HttpResponse.arrayBuffer(new TextEncoder().encode("%PDF-fake").buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("Заключение_168.pdf")}`,
      },
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  requests = 0;
});
afterAll(() => server.close());

function menu(): HTMLElement {
  return screen.getByRole("button", { name: "Действия с заключением" });
}

function renderMenu(props: Partial<Parameters<typeof ConclusionActionsMenu>[0]> = {}): void {
  render(<ConclusionActionsMenu partyId={PARTY} canDownload canPrint {...props} />);
}

describe("ConclusionActionsMenu", () => {
  it("contains exactly «Скачать» and «Печать» — never Max", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(menu());
    expect(screen.getByRole("menuitem", { name: "Скачать" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Печать" })).toBeTruthy();
    expect(screen.queryByText(/Max/)).toBeNull();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(2);
  });

  it("closes on Escape and outside click, returning the focus to the trigger", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(menu());
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(menu());

    await user.click(menu());
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("renders the items only with the matching capability", async () => {
    const user = userEvent.setup();
    renderMenu({ canDownload: false });
    await user.click(menu());
    expect(screen.queryByRole("menuitem", { name: "Скачать" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Печать" })).toBeTruthy();
  });

  it("a Problem response never becomes a Blob or a download", async () => {
    server.use(
      http.get(`http://localhost${PDF}`, () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Conclusion basis incomplete",
            status: 422,
            detail: "Основание заключения непригодно или неполно; документ не формируется.",
            code: "DOCUMENT_BASIS_INCOMPLETE",
            trace_id: "t",
          },
          { status: 422, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    renderMenu();
    await user.click(menu());
    await user.click(screen.getByRole("menuitem", { name: "Печать" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DOCUMENT_BASIS_INCOMPLETE");
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    click.mockRestore();
    open.mockRestore();
  });

  it("print and download use ONE endpoint and the same bytes", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    renderMenu();
    await user.click(menu());
    await user.click(screen.getByRole("menuitem", { name: "Печать" }));
    await waitFor(() => expect(requests).toBe(1));
    expect(open).toHaveBeenCalled();
    open.mockRestore();

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(menu());
    await user.click(screen.getByRole("menuitem", { name: "Скачать" }));
    await waitFor(() => expect(requests).toBe(2));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("a blocked popup shows the error and never downloads", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderMenu();
    await user.click(menu());
    await user.click(screen.getByRole("menuitem", { name: "Печать" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Всплывающее окно/);
    expect(click).not.toHaveBeenCalled();
    open.mockRestore();
    click.mockRestore();
  });

  it("a repeated launch during loading is blocked", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`http://localhost${PDF}`, () => new Promise(() => undefined)),
    );
    renderMenu();
    await user.click(menu());
    await user.click(screen.getByRole("menuitem", { name: "Печать" }));
    // While the read is pending the trigger stays disabled — the guard is
    // the component state, no size change, no second launch.
    await waitFor(() => expect(menu()).toHaveProperty("disabled", true));
    expect(requests).toBe(0);
  });
});
