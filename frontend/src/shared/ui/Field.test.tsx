/**
 * Working field (auth TextField contract adapted to app tokens): the error is
 * linked through aria-describedby/aria-invalid, announced politely and cleared
 * when the user corrects the input.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./Field";

describe("Field", () => {
  it("links label, hint and error through ids", () => {
    render(
      <Field
        id="reception-note"
        label="Комментарий"
        hint="Необязательное поле"
        error="Слишком длинный комментарий"
        value="x"
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText("Комментарий");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy).toContain("reception-note-hint");
    expect(describedBy).toContain("reception-note-error");
    expect(screen.getByText("Слишком длинный комментарий")).toBeInTheDocument();
  });

  it("clears the error as soon as the input is corrected", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Field id="login" label="Логин" error="Укажите логин." value="" onChange={() => undefined} />,
    );
    expect(screen.getByText("Укажите логин.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Логин"), "a");
    // Error disappears while typing without waiting for the next validation.
    expect(screen.queryByText("Укажите логин.")).toBeNull();
    expect(screen.getByLabelText("Логин")).not.toHaveAttribute("aria-invalid");
    rerender(<Field id="login" label="Логин" error="Укажите логин." value="" onChange={() => undefined} />);
  });

  it("disabled and password fields keep their semantics", () => {
    const onChange = vi.fn();
    render(<Field id="pass" label="Пароль" type="password" disabled value="secret" onChange={onChange} />);
    const input = screen.getByLabelText("Пароль");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toBeDisabled();
  });
});
