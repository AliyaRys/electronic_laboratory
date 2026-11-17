/** HelpTooltip unit tests (ТЗ DR44 §3): hover + focus, Escape, describedby. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HelpTooltip, Tooltip } from "./HelpTooltip";

const TEXT = "Стоимость сверки данных + стоимость ВСЭ";

describe("HelpTooltip", () => {
  it("is closed by default and opens on hover", async () => {
    const user = userEvent.setup();
    render(<HelpTooltip text={TEXT} accessibleName="Что входит в стоимость" />);
    const trigger = screen.getByRole("button", { name: "Что входит в стоимость" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.hover(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(TEXT);
    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on keyboard focus and closes on blur", async () => {
    const user = userEvent.setup();
    render(<HelpTooltip text={TEXT} accessibleName="Что входит в стоимость" />);
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(TEXT);
    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on Escape and keeps the trigger focused", async () => {
    const user = userEvent.setup();
    render(<HelpTooltip text={TEXT} accessibleName="Что входит в стоимость" />);
    await user.tab();
    expect(await screen.findByRole("tooltip")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Что входит в стоимость");
  });

  it("links the trigger to the popup with aria-describedby", async () => {
    const user = userEvent.setup();
    render(<HelpTooltip text={TEXT} accessibleName="Что входит в стоимость" />);
    const trigger = screen.getByRole("button", { name: "Что входит в стоимость" });
    await user.hover(trigger);
    const popup = await screen.findByRole("tooltip");
    expect(trigger.getAttribute("aria-describedby")).toBe(popup.getAttribute("id"));
  });

  it("a long hint wraps on a narrow screen: no nowrap, an honest max-width (DR44 fix-loop)", () => {
    // jsdom does not apply the stylesheet — the contract is asserted on the
    // CSS source of the shared popup class.
    const css = readFileSync(join(process.cwd(), "src", "shared", "ui", "ui.css"), "utf8");
    const block = /(\.app-help-tooltip-popup\s*\{[^}]*\})/.exec(css)?.[1] ?? "";
    expect(block).not.toMatch(/white-space:\s*nowrap/);
    expect(block).toMatch(/max-width/);
  });

  it("the accessible name never depends on the tooltip text", () => {
    render(<HelpTooltip text={TEXT} accessibleName="Что входит в стоимость" />);
    expect(screen.getByRole("button", { name: "Что входит в стоимость" })).toBeTruthy();
  });
});

describe("Tooltip wrapper (ТЗ DR46 §3.2 fix-loop)", () => {
  it("keeps the child's own focus handler and still opens the tooltip", async () => {
    const user = userEvent.setup();
    const customFocus = vi.fn();
    render(
      <Tooltip text="Редактировать ВСЭ">
        <button type="button" onFocus={customFocus}>
          Редактировать ВСЭ
        </button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Редактировать ВСЭ" });
    await user.click(trigger);
    // Both handlers ran: the child's own focus handler and the tooltip's.
    expect(customFocus).toHaveBeenCalledOnce();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Редактировать ВСЭ");
  });

  it("keeps the child's own mouse-leave handler while closing the popup", async () => {
    const user = userEvent.setup();
    const customLeave = vi.fn();
    render(
      <Tooltip text="Удалить ВСЭ">
        <button type="button" onMouseLeave={customLeave}>
          Удалить ВСЭ
        </button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Удалить ВСЭ" });
    await user.hover(trigger);
    expect(await screen.findByRole("tooltip")).toBeTruthy();
    await user.unhover(trigger);
    expect(customLeave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
