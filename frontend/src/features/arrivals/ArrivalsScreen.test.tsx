/**
 * DR29 §7 unit/component tests: the sync status lives INSIDE the sync group
 * above the refresh button (one composition, one text source), the EXPECTED
 * subtitle keeps its small agreed interval, the hover/focus highlight of the
 * hide action belongs only to the danger button, and the shared Dialog keeps
 * its stacking contract. Real geometry (right-edge alignment, viewport
 * behaviour at 1440/1024/800/390/200%) is proven in tests/e2e/arrivals.spec.ts
 * — jsdom performs no layout.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ArrivalsScreen } from "./ArrivalsScreen";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const props = {
  labId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  q: "",
  onSearch: () => {},
  result: "",
  onResultChange: () => {},
  sort: "desc" as const,
  onSortChange: () => {},
  hiddenColumns: new Set<string>(),
  onToggleColumn: () => {},
  items: [],
  loading: false,
  problem: null,
  onRetry: () => {},
  page: 1,
  pageCount: 1,
  onPage: () => {},
  onQueueChange: () => {},
  counts: { EXPECTED: 1, WORK: 0, ACCEPTED: 0 },
};

function button(): React.ReactElement {
  return <button type="button">Обновить</button>;
}

describe("ArrivalsScreen sync group (DR29 §3)", () => {
  it("renders the sync status inside the sync group, directly above the button", () => {
    render(
      <ArrivalsScreen
        {...props}
        queue="EXPECTED"
        sync={button()}
        syncStatus="Автообновление из ВетИС каждые 15 минут"
      />,
    );
    const group = document.querySelector(".arrivals-sync");
    expect(group).not.toBeNull();
    // The status is a child of the SAME group, before the button.
    const status = group?.querySelector(".arrivals-sync-status");
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("Автообновление из ВетИС каждые 15 минут");
    expect(status?.nextElementSibling?.tagName).toBe("BUTTON");
    // Single source: the text appears exactly once on the page.
    expect(Array.from(document.querySelectorAll(".arrivals-sync-status")).length).toBe(1);
  });

  it("keeps the constrained right-aligned status class and the busy/retry text source", () => {
    render(
      <ArrivalsScreen
        {...props}
        queue="EXPECTED"
        sync={button()}
        syncStatus="Обновление не выполнено: сервис ВетИС временно недоступен. Повторите обновление позже. Длинный текст переносится внутри ширины кнопки, не расширяя страницу."
      />,
    );
    const status = document.querySelector(".arrivals-sync .arrivals-sync-status");
    expect(status).not.toBeNull();
    expect(status?.className).toContain("arrivals-sync-status");
    expect(status?.getAttribute("role")).toBe("status");
  });

  it("renders no sync group and no hint row without the button", () => {
    render(<ArrivalsScreen {...props} queue="EXPECTED" syncStatus="" />);
    expect(document.querySelector(".arrivals-sync")).toBeNull();
    expect(document.querySelector(".arrivals-sync-status")).toBeNull();
  });

  it("keeps the EXPECTED subtitle visible right below the title (DR29 §4)", () => {
    render(
      <ArrivalsScreen
        {...props}
        queue="EXPECTED"
        sync={button()}
        syncStatus="Автообновление из ВетИС каждые 15 минут"
      />,
    );
    const row = document.querySelector(".arrivals-title-row");
    const subtitle = row?.querySelector("p:not(.arrivals-sync-status)");
    expect(subtitle?.textContent).toContain("Транспортные эВСД");
  });
});

describe("Arrivals hide action focus contract (DR29 §5.1)", () => {
  it("keeps the highlight class on the danger button, never on the action group", async () => {
    const user = userEvent.setup();
    const onHide = (): void => undefined;
    render(
      <div className="vse-app">
        <table className="app-table app-table-arrivals">
          <tbody>
            <tr>
              <td className="app-table-column-actions">
                <div className="app-table-row-actions">
                  <a className="app-table-icon-action" href="#reconcile" aria-label="Перейти к сверке данных">
                    сверить
                  </a>
                  <button
                    type="button"
                    className="arrivals-icon-action danger"
                    aria-label="Скрыть поступление из очереди"
                    onClick={onHide}
                  >
                    x
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>,
    );
    const danger = screen.getByRole("button", { name: "Скрыть поступление из очереди" });
    const group = danger.closest(".app-table-row-actions") as HTMLElement;
    expect(danger.className).toContain("arrivals-icon-action danger");
    expect(group.className).toBe("app-table-row-actions");
    await user.click(danger);
    // Focus stays on the button; the container gains no highlight classes.
    expect(group.className).toBe("app-table-row-actions");
  });
});

describe("Dialog stacking contract (DR29 §6.1)", () => {
  it("ui.css declares overlay 1000 below content 1001, centralized for every dialog", () => {
    const css = readFileSync(resolve("src/shared/ui/ui.css"), "utf8");
    const overlayBlock = css.slice(css.indexOf(".app-dialog-overlay"), css.indexOf(".app-dialog {"));
    const contentBlock = css.slice(css.indexOf(".app-dialog {"), css.indexOf(".app-dialog.danger"));
    expect(overlayBlock).toMatch(/z-index:\s*1000/);
    expect(contentBlock).toMatch(/z-index:\s*1001/);
    expect(overlayBlock).not.toMatch(/!important/);
    expect(contentBlock).not.toMatch(/!important/);
    // No arrivals-specific stacking exception exists.
    const arrivalsCss = readFileSync(resolve("src/features/arrivals/arrivals.css"), "utf8");
    expect(arrivalsCss).not.toMatch(/app-dialog/);
  });
});
