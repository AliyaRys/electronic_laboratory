/**
 * F02 dialog acceptance (UX-03): a confirm dialog opens with the safe action
 * (cancel) focused, Escape closes it and focus returns to the trigger.
 * Built on Radix Dialog (ADR-007 pinned deps).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { Dialog } from "./Dialog";

function DialogHarness(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Удалить партию
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Удалить партию?"
        confirmLabel="Удалить"
        cancelLabel="Остаться"
        danger
        onConfirm={() => setOpen(false)}
      >
        Партия исчезнет из очереди «Ожидаемые».
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("test_dialog_focus_and_escape", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole("button", { name: "Удалить партию" }));

    // Safe cancel is focused first (UX-03: безопасная отмена первая).
    expect(screen.getByRole("button", { name: "Остаться" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Удалить партию?" })).toBeInTheDocument();

    // Escape closes the dialog…
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Удалить партию?" })).not.toBeInTheDocument();

    // …and focus returns to the trigger.
    expect(screen.getByRole("button", { name: "Удалить партию" })).toHaveFocus();
  });

  it("exposes the error text through aria-describedby (API-01 problem detail)", async () => {
    render(
      <Dialog
        open
        onOpenChange={() => undefined}
        title="Удалить пользователя?"
        confirmLabel="Удалить"
        error="Последний администратор лаборатории не может быть удалён."
        onConfirm={() => undefined}
      >
        У пользователя есть связи с записями.
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Удалить пользователя?" });
    const describedBy = dialog.getAttribute("aria-describedby") ?? "";
    const errorText = screen.getByText("Последний администратор лаборатории не может быть удалён.");
    expect(describedBy.split(" ")).toContain(errorText.id);
    expect(errorText.id).not.toBe("");
  });

  it("confirms with the explicit action and closes", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Удалить партию" }));
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(screen.queryByRole("dialog", { name: "Удалить партию?" })).not.toBeInTheDocument();
  });
});
