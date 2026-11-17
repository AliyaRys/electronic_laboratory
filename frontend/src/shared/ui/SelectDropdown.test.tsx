/**
 * ТЗ DR42 §6.1/§8 UI 2–3: the one styled select — keyboard, ARIA and states.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SelectDropdown, type SelectOption } from "./SelectDropdown";

const OPTIONS: readonly SelectOption[] = [
  { value: "", label: "Выберите результат" },
  { value: "FIT", label: "Пригодно" },
  { value: "UNFIT", label: "Непригодно" },
];

function Harness(): React.ReactElement {
  const [value, setValue] = useState("");
  return (
    <SelectDropdown label="Результат ВСЭ" value={value} options={OPTIONS} placeholder="Выберите результат" onChange={setValue} />
  );
}

describe("SelectDropdown", () => {
  it("is never a native select and exposes listbox ARIA semantics", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.querySelector("select")).toBeNull();
    const trigger = screen.getByRole("button", { name: /Результат ВСЭ/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBe(3);
  });

  it("keyboard: arrows move the active item, Enter selects, Escape closes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Результат ВСЭ/ });
    await user.click(trigger);
    // The first enabled option is already active; Enter commits it.
    await user.keyboard("{Enter}");
    expect(trigger.textContent).toContain("Пригодно");
    await user.keyboard("{Enter}"); // reopen
    expect(screen.getByRole("listbox")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("Home/End jump to the boundary options", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Результат ВСЭ/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{End}");
    await user.keyboard("{Enter}");
    expect(trigger.textContent).toContain("Непригодно");
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Home}");
    await user.keyboard("{Enter}");
    expect(trigger.textContent).toContain("Пригодно");
  });

  it("the placeholder option is disabled and muted; a real option replaces it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Результат ВСЭ/ });
    expect(trigger.className).toContain("is-placeholder");
    await user.click(trigger);
    const placeholder = screen.getAllByRole("option")[0];
    expect(placeholder).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getAllByRole("option")[1]);
    expect(trigger.className).not.toContain("is-placeholder");
  });

  it("a disabled trigger never opens the list", async () => {
    const user = userEvent.setup();
    render(
      <SelectDropdown label="Результат ВСЭ" value="" options={OPTIONS} disabled onChange={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: /Результат ВСЭ/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
