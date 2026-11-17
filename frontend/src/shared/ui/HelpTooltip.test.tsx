/** HelpTooltip unit tests (ТЗ DR44 §3): hover + focus, Escape, describedby. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpTooltip } from "./HelpTooltip";

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

  it("the accessible name never depends on the tooltip text", () => {
    render(<HelpTooltip text={TEXT} accessibleName="Что входит в стоимость" />);
    expect(screen.getByRole("button", { name: "Что входит в стоимость" })).toBeTruthy();
  });
});
