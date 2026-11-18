/**
 * DateRangePopover tests (DR48 §3.4): the minimal focus trap of the open
 * popover — Tab cycles inside the popover (inputs + actions, forward and
 * backward) and never reaches the page behind it; Escape closes and returns
 * the focus to the trigger.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DateRangePopover } from "./DateRangePopover";

function renderPopover(): void {
  render(
    <>
      <button type="button">Сторонняя кнопка</button>
      <DateRangePopover
        caption="Период отчёта"
        applied={{ from: "", to: "" }}
        onApply={() => undefined}
        onReset={() => undefined}
        idPrefix="trap-test"
      />
    </>,
  );
}

async function openPopover(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^Период отчёта/ }));
  await screen.findByText("Применить");
}

describe("DateRangePopover", () => {
  it("Tab cycles inside the open popover and never leaves it", async () => {
    const user = userEvent.setup();
    renderPopover();
    await openPopover(user);

    const from = screen.getByLabelText("С", { selector: "input" });
    const to = screen.getByLabelText("По", { selector: "input" });
    const reset = screen.getByRole("button", { name: "Сбросить" });
    const apply = screen.getByRole("button", { name: "Применить" });

    from.focus();
    await user.keyboard("{Tab}");
    expect(to).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(reset).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(apply).toHaveFocus();
    // The last element wraps back to the first — the page behind is not reached.
    await user.keyboard("{Tab}");
    expect(from).toHaveFocus();
    expect(screen.getByRole("button", { name: "Сторонняя кнопка" })).not.toHaveFocus();
  });

  it("Shift+Tab from the first element wraps to the last popover element", async () => {
    const user = userEvent.setup();
    renderPopover();
    await openPopover(user);

    const from = screen.getByLabelText("С", { selector: "input" });
    const apply = screen.getByRole("button", { name: "Применить" });
    from.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(apply).toHaveFocus();
  });

  it("Escape closes the popover and returns the focus to the trigger", async () => {
    const user = userEvent.setup();
    renderPopover();
    const trigger = screen.getByRole("button", { name: /^Период отчёта/ });
    await user.click(trigger);
    await screen.findByText("Сбросить");
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Сбросить")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("the applied range is passed to onApply and the focus returns to the trigger", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <DateRangePopover
        caption="Период отчёта"
        applied={{ from: "", to: "" }}
        onApply={onApply}
        onReset={() => undefined}
        idPrefix="apply-test"
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Период отчёта/ }));
    const from = screen.getByLabelText("С", { selector: "input" });
    const to = screen.getByLabelText("По", { selector: "input" });
    await user.type(from, "2026-01-01");
    await user.type(to, "2026-06-30");
    await user.click(screen.getByRole("button", { name: "Применить" }));
    expect(onApply).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-06-30" });
    expect(screen.getByRole("button", { name: /^Период отчёта/ })).toHaveFocus();
  });
});
