/**
 * Working-screen button (components/app/Button.js contract): variants
 * primary/secondary/danger, busy disables and labels the wait, icon-only
 * buttons keep an accessible name.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("defaults to the secondary working variant", () => {
    render(<Button>Продолжить</Button>);
    const button = screen.getByRole("button", { name: "Продолжить" });
    expect(button.className).toContain("app-button");
    expect(button.className).toContain("secondary");
  });

  it("busy blocks repeat submits and swaps the label", () => {
    render(<Button busy>Сохранить</Button>);
    const button = screen.getByRole("button", { name: "Выполняется…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("disabled keeps the visible label and does not fire", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Удалить
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Удалить" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("icon-only buttons take their accessible name from the label", () => {
    render(<Button iconOnly icon="admin-delete" label="Удалить" />);
    expect(screen.getByRole("button", { name: "Удалить" })).toBeInTheDocument();
  });
});
