/**
 * OutcomeFields tests (E04): the outcome matrix with NO auto outcome, no
 * «условно-пригодно» option, FIT locked to SALE and UNFIT requiring a reason.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { OutcomeFields } from "./OutcomeFields";
import { emptyOutcome } from "./formValues";

describe("OutcomeFields", () => {
  it("starts empty — no outcome is ever prefilled", () => {
    render(<OutcomeFields value={emptyOutcome()} disabled={false} onChange={() => undefined} />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.every((radio) => !radio.checked)).toBe(true);
    expect(
      (screen.getByRole("combobox", { name: "Направление по результатам ВСЭ *" }) as HTMLSelectElement)
        .disabled,
    ).toBe(true);
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
    await user.click(screen.getByRole("radio", { name: "Пригодно" }));
    expect(value).toMatchObject({ outcome: "FIT", direction: "SALE", reason: "" });
    const select = screen.getByRole("combobox", {
      name: "Направление по результатам ВСЭ *",
    }) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect([...select.options].map((option) => option.value)).toEqual(["", "SALE"]);
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
    await user.click(screen.getByRole("radio", { name: "Непригодно" }));
    expect(value).toMatchObject({ outcome: "UNFIT", direction: "DISPOSAL" });
    const select = screen.getByRole("combobox", {
      name: "Направление по результатам ВСЭ *",
    }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["", "DISPOSAL", "DESTRUCTION"]);
    expect(screen.getByRole("textbox", { name: "Причина направления *" })).toBeTruthy();
  });
});
