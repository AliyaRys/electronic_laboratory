/**
 * Balances tests (S03): the disposal affordance exists for VET/HEAD only —
 * ANALYST is read-only and sees no disposal action at all; the shown weight
 * stays readonly.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Balances } from "./Balances";

const SPECIES = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const balances = [{ product_species_id: SPECIES, mass_kg: "12.6", revision: 3, product_name: "Говядина" }];

describe("Balances", () => {
  it("a VET sees the ONE direct dispose icon action (no row menu)", async () => {
    const onDispose = vi.fn();
    render(
      <Balances
        balances={balances}
        loading={false}
        emptyMessage="Положительных остатков нет."
        canDispose
        onDispose={onDispose}
      />,
    );
    expect(await screen.findByText("12.6")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    // DR48 §4.4: a direct icon action, no ⋯ menu anywhere.
    expect(screen.queryByRole("button", { name: "Действия со строкой" })).toBeNull();
    const action = screen.getByRole("button", { name: "Утилизировать остаток" });
    expect(action.getAttribute("data-vse-icon") ?? action.querySelector("[data-vse-icon]")?.getAttribute("data-vse-icon")).toBe(
      "admin-dispose",
    );
    await userEvent.click(action);
    expect(onDispose).toHaveBeenCalledWith(balances[0]);
  });

  it("ANALYST sees no disposal affordance at all (read-only)", () => {
    render(
      <Balances
        balances={balances}
        loading={false}
        emptyMessage="Положительных остатков нет."
        canDispose={false}
        onDispose={() => undefined}
      />,
    );
    expect(screen.getByText("12.6")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Действия со строкой" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Утилизировать остаток" })).toBeNull();
  });

  it("the empty and loading states are distinct", () => {
    const views = [
      <Balances
        key="empty"
        balances={[]}
        loading={false}
        emptyMessage="Положительных остатков нет."
        canDispose={false}
        onDispose={() => undefined}
      />,
      <Balances
        key="loading"
        balances={[]}
        loading
        emptyMessage="Положительных остатков нет."
        canDispose={false}
        onDispose={() => undefined}
      />,
    ];
    const { rerender } = render(views[0]!);
    expect(screen.getByText("Положительных остатков нет.")).toBeTruthy();
    rerender(views[1]!);
    expect(screen.getByText("Загрузка…")).toBeTruthy();
  });
});
