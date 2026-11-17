/**
 * OutcomeFields tests (E04, ТЗ DR42 §6): the outcome matrix with NO auto
 * outcome, no «условно-пригодно» option, FIT locked to SALE and UNFIT
 * requiring a reason; the selects are the styled dropdown, never native.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { OutcomeFields } from "./OutcomeFields";
import { emptyOutcome, type OutcomeEntry } from "./formValues";

function Harness({
  initial,
  onChange,
}: {
  initial: OutcomeEntry;
  onChange?: (value: OutcomeEntry) => void;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <OutcomeFields
      value={value}
      disabled={false}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("OutcomeFields", () => {
  it("starts empty — no outcome is ever prefilled", () => {
    render(<OutcomeFields value={emptyOutcome()} disabled={false} onChange={() => undefined} />);
    expect(document.querySelector("select")).toBeNull();
    const resultTrigger = screen.getByRole("button", { name: /Результат ВСЭ/ });
    expect(resultTrigger.textContent).toContain("Выберите результат");
    const directionTrigger = screen.getByRole("button", { name: /Направление по результатам ВСЭ/ });
    expect(directionTrigger).toBeDisabled();
    expect(screen.queryByText("Условно-пригодно")).toBeNull();
  });

  it("FIT allows only «В реализацию без ограничений» and clears the reason", async () => {
    const user = userEvent.setup();
    let value = { ...emptyOutcome(), reason: "старая причина" };
    const View = (): React.ReactElement => (
      <OutcomeFields
        value={value}
        disabled={false}
        onChange={(next) => {
          value = next;
          rerender(<View />);
        }}
      />
    );
    const { rerender } = render(<View />);
    const resultTrigger = screen.getByRole("button", { name: /Результат ВСЭ/ });
    await user.click(resultTrigger);
    await user.click(screen.getByRole("option", { name: "Пригодно" }));
    rerender(<View />);
    expect(value).toMatchObject({ outcome: "FIT", direction: "SALE", reason: "" });
    const directionTrigger = screen.getByRole("button", { name: /Направление по результатам ВСЭ/ });
    expect(directionTrigger).not.toBeDisabled();
    await user.click(directionTrigger);
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Выберите направление", "В реализацию без ограничений"]);
    expect(screen.queryByRole("textbox", { name: "Причина направления *" })).toBeNull();
  });

  it("UNFIT offers disposal/destruction only and requires a reason", async () => {
    const user = userEvent.setup();
    let value = emptyOutcome();
    const View = (): React.ReactElement => (
      <OutcomeFields
        value={value}
        disabled={false}
        onChange={(next) => {
          value = next;
          rerender(<View />);
        }}
      />
    );
    const { rerender } = render(<View />);
    const resultTrigger = screen.getByRole("button", { name: /Результат ВСЭ/ });
    await user.click(resultTrigger);
    await user.click(screen.getByRole("option", { name: "Непригодно" }));
    rerender(<View />);
    expect(value).toMatchObject({ outcome: "UNFIT", direction: "DISPOSAL" });
    const directionTrigger = screen.getByRole("button", { name: /Направление по результатам ВСЭ/ });
    await user.click(directionTrigger);
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Выберите направление", "На утилизацию", "На уничтожение"]);
    expect(screen.getByRole("textbox", { name: "Причина направления *" })).toBeTruthy();
  });

  it("an explicit user action is the only way to change the result (Harness state)", async () => {
    const user = userEvent.setup();
    const seen: OutcomeEntry[] = [];
    render(<Harness initial={emptyOutcome()} onChange={(next) => seen.push(next)} />);
    const resultTrigger = screen.getByRole("button", { name: /Результат ВСЭ/ });
    await user.click(resultTrigger);
    await user.click(screen.getByRole("option", { name: "Непригодно" }));
    expect(seen).toEqual([{ outcome: "UNFIT", direction: "DISPOSAL", reason: "" }]);
  });
});
