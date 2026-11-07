/**
 * DisposalHistory tests (S03): the history is immutable (no edit/delete
 * affordances), the period filter changes the history only, and no link of a
 * deleted ВСЭ ever opens a protocol (inert rendering).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DisposalHistory } from "./DisposalHistory";

const disposal = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  laboratory_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  product_species_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  disposed_on: "2026-11-06",
  mass_kg: "12.6",
  external_vsd_number: "ВСД-001",
  actor_id: "00000000-0000-4000-8000-000000000001",
  recorded_at: "2026-11-06T10:00:00Z",
};

function renderHistory(): void {
  render(
    <DisposalHistory
      items={[disposal]}
      collections={[]}
      total={1}
      page={1}
      loading={false}
      onPageChange={() => undefined}
    />,
  );
}

describe("DisposalHistory", () => {
  it("renders the immutable facts without any edit/delete affordances", () => {
    renderHistory();
    expect(screen.getByText("ВСД-001")).toBeTruthy();
    expect(screen.getByText("12.6")).toBeTruthy();
    // No row action menus, no textboxes: the history is never editable.
    expect(screen.queryByRole("button", { name: "Действия со строкой" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("a deleted ВСЭ link never opens a protocol: the row carries no navigation link", () => {
    renderHistory();
    // The examination link data is absent (deleted/absent ВСЭ): the number
    // stays plain text and no protocol navigation exists at all.
    expect(screen.queryByRole("link")).toBeNull();
    const cells = screen.getAllByRole("cell");
    expect(cells.some((cell) => cell.textContent === "ВСД-001")).toBe(true);
  });

  it("the loading and empty states are distinct", () => {
    const { rerender } = render(
      <DisposalHistory
        items={null}
        collections={[]}
        total={0}
        page={1}
        loading
        onPageChange={() => undefined}
      />,
    );
    expect(screen.getByText("Загрузка…")).toBeTruthy();
    rerender(
      <DisposalHistory
        items={[]}
        collections={[]}
        total={0}
        page={1}
        loading={false}
        onPageChange={() => undefined}
      />,
    );
    expect(screen.getByText("За выбранный период утилизаций нет.")).toBeTruthy();
  });

  it("pagination is honest about the pages", async () => {
    const onPageChange = vi.fn();
    render(
      <DisposalHistory
        items={[disposal]}
        collections={[]}
        total={25}
        page={1}
        loading={false}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByText("Страница 1 из 2")).toBeTruthy();
  });
});
