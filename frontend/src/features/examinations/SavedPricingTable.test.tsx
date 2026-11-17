/**
 * SavedPricingTable tests (ТЗ DR44 §4.2/§6, Task 5): the readonly frozen
 * pricing snapshot of the card — same rows/units/money/evaluation markup as
 * the live preview, footer with the frozen total, never a recalculation.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PricingSnapshotView } from "./api";
import { SavedPricingTable } from "./SavedPricingTable";

const snapshot: PricingSnapshotView = {
  lines: [
    {
      service_code: "ORG",
      name: "Органолептическое исследование",
      unit_id: "service",
      quantity: "3",
      unit_price: "5.00",
      amount: "15.00",
      method_snapshot: null,
      evaluation: { status: "IN_NORM" },
    },
  ],
  total: "15.00",
  currency: "RUB",
  fair: false,
};

describe("SavedPricingTable", () => {
  it("shows the frozen rows with the four readonly columns and the total row", () => {
    render(<SavedPricingTable snapshot={snapshot} />);
    expect(screen.getByRole("columnheader", { name: "Исследование" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Количество" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Тариф" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Сумма" })).toBeTruthy();
    // ТЗ DR46 §3.4: «Единица» and «Оценка» are NOT rendered in the readonly
    // variant (not hidden by CSS); the evaluation stays in «Исследования ВСЭ».
    expect(screen.queryByRole("columnheader", { name: "Единица" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Оценка" })).toBeNull();
    expect(screen.getByText("Органолептическое исследование")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("5,00 ₽")).toBeTruthy();
    expect(screen.getAllByText("15,00 ₽").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Норма")).toBeNull();
    // No tfoot: the total is the reconciliation-style row below the table.
    expect(screen.queryByText("Итого к оплате")).toBeNull();
    const total = document.querySelector("p.vse-rec-invoice-total");
    expect(total).not.toBeNull();
    expect(total?.querySelector("strong")?.textContent).toContain("15,00 ₽");
    expect(total?.closest("table")).toBeNull();
  });

  it("a zero frozen total stays data, never «—»", () => {
    render(<SavedPricingTable snapshot={{ ...snapshot, total: "0.00", fair: true }} />);
    expect(screen.getByText("0,00 ₽")).toBeTruthy();
    // The saved fair flag keeps the honest Ярмарка explanation.
    expect(document.querySelector('[data-testid="pricing-waiver"]')).not.toBeNull();
  });

  it("a missing snapshot renders an honest absence, never a fabricated table", () => {
    render(<SavedPricingTable snapshot={null} />);
    expect(screen.getByText("Расчёт стоимости не сохранён.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("a long research name wraps without breaking the numeric columns", () => {
    render(
      <SavedPricingTable
        snapshot={{
          ...snapshot,
          lines: [
            {
              ...snapshot.lines[0],
              name:
                "Определение антибиотиков и сульфаниламидных препаратов в пробах мясной продукции методом жидкостной хроматографии",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Определение антибиотиков/)).toBeTruthy();
  });
});
