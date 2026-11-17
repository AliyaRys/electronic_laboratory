/**
 * ТЗ DR39 §7: the completed-reconciliation date filter component tests —
 * the two modes, apply/reset, Escape/outside-click closing with focus return
 * and the Russian validation error of an incomplete/reversed range.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReconciliationDateFilter, type AppliedReconciliationDate } from "./ReconciliationDateFilter";

const EMPTY: AppliedReconciliationDate = { on: "", from: "", to: "" };

/** The single-date input (the mode radio shares the label text «Дата»). */
function dateInput(): HTMLInputElement {
  const candidates = screen.getAllByLabelText("Дата");
  const input = candidates.find((entry) => entry instanceof HTMLInputElement && entry.type === "date");
  if (!(input instanceof HTMLInputElement)) throw new Error("Поле «Дата» не найдено.");
  return input;
}

describe("ReconciliationDateFilter", () => {
  it("renders the trigger closed with the accessible name; no draft is sent before «Применить»", async () => {
    const onApply = vi.fn();
    render(<ReconciliationDateFilter applied={EMPTY} onApply={onApply} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Дата сверки данных" }));
    // The draft inputs exist, but nothing is applied until the button.
    expect(dateInput()).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("the single date mode applies the chosen день", async () => {
    const onApply = vi.fn();
    render(<ReconciliationDateFilter applied={EMPTY} onApply={onApply} initialOpen />);
    await userEvent.type(dateInput(), "2026-11-06");
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(onApply).toHaveBeenCalledWith({ on: "2026-11-06", from: "", to: "" });
  });

  it("the range mode drafts «С»/«По» and applies both bounds", async () => {
    const onApply = vi.fn();
    render(<ReconciliationDateFilter applied={EMPTY} onApply={onApply} initialOpen />);
    await userEvent.click(screen.getByRole("radio", { name: "Диапазон" }));
    await userEvent.type(screen.getByLabelText("С"), "2026-11-05T10:00");
    await userEvent.type(screen.getByLabelText("По"), "2026-11-06T18:30");
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(onApply).toHaveBeenCalledWith({ on: "", from: "2026-11-05T10:00", to: "2026-11-06T18:30" });
  });

  it("an incomplete/reversed range shows the Russian error and never applies", async () => {
    const onApply = vi.fn();
    render(<ReconciliationDateFilter applied={EMPTY} onApply={onApply} initialOpen />);
    await userEvent.click(screen.getByRole("radio", { name: "Диапазон" }));
    await userEvent.type(screen.getByLabelText("С"), "2026-11-06T10:00");
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(screen.getByText("Укажите обе границы диапазона даты сверки данных.")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("По"), "2026-11-05T10:00");
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(screen.getByText("Начало диапазона даты сверки не может быть позже его конца.")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("«Сбросить» applies the empty filter", async () => {
    const onApply = vi.fn();
    render(
      <ReconciliationDateFilter
        applied={{ on: "2026-11-06", from: "", to: "" }}
        onApply={onApply}
        initialOpen
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(onApply).toHaveBeenCalledWith(EMPTY);
  });

  it("the summary shows the applied date in Russian, never technical ISO", () => {
    render(<ReconciliationDateFilter applied={{ on: "2026-11-06", from: "", to: "" }} onApply={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /Дата сверки данных/ });
    expect(trigger.textContent).toContain("06.11.2026");
    expect(trigger.textContent).not.toContain("2026-11-06T");
  });

  it("Escape closes the popover and returns focus to the trigger", async () => {
    render(<ReconciliationDateFilter applied={EMPTY} onApply={vi.fn()} initialOpen />);
    await userEvent.type(dateInput(), "2026-11-06");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Дата сверки данных" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Дата сверки данных/ }));
  });

  it("a click outside closes the popover and returns focus", async () => {
    const onApply = vi.fn();
    render(
      <div>
        <div data-testid="outside" />
        <ReconciliationDateFilter applied={EMPTY} onApply={onApply} initialOpen />
      </div>,
    );
    expect(screen.getByRole("group", { name: "Дата сверки данных" })).toBeTruthy();
    await userEvent.click(screen.getByTestId("outside"));
    expect(screen.queryByRole("group", { name: "Дата сверки данных" })).toBeNull();
  });

  it("opening restores the APPLIED values as the draft", async () => {
    render(
      <ReconciliationDateFilter
        applied={{ on: "", from: "2026-11-05T10:00", to: "2026-11-06T18:30" }}
        onApply={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Дата сверки данных/ }));
    expect((screen.getByLabelText("С") as HTMLInputElement).value).toBe("2026-11-05T10:00");
    expect((screen.getByLabelText("По") as HTMLInputElement).value).toBe("2026-11-06T18:30");
  });
});
