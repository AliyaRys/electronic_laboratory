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
  it("shows the frozen rows, tariff, amount, evaluation and total", () => {
    render(<SavedPricingTable snapshot={snapshot} />);
    expect(screen.getByRole("columnheader", { name: "Исследование" })).toBeTruthy();
    expect(screen.getByText("Органолептическое исследование")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("1 услуга")).toBeTruthy();
    expect(screen.getByText("5,00 ₽")).toBeTruthy();
    expect(screen.getAllByText("15,00 ₽").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Норма").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Итого к оплате")).toBeTruthy();
  });

  it("a zero frozen total stays data, never «—»", () => {
    render(<SavedPricingTable snapshot={{ ...snapshot, total: "0.00", fair: true }} />);
    expect(screen.getByText("0,00 ₽")).toBeTruthy();
  });

  it("a missing snapshot renders an honest absence, never a fabricated table", () => {
    render(<SavedPricingTable snapshot={null} />);
    expect(screen.getByText("Расчёт стоимости не сохранён.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
