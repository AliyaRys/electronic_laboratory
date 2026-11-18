/**
 * ТЗ DR42 §4.3: the pricing table carries the per-line evaluation snapshot.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PricingSection, type PricingPreviewState } from "./PricingPreview";
import type { PricingSnapshotView } from "./api";

const snapshot: PricingSnapshotView = {
  lines: [
    {
      service_code: "72c55a55-4708-58d5-8d69-ec1c7ee2d1f9",
      name: "Микроскопия",
      unit_id: "RUB",
      quantity: "1",
      unit_price: "120.00",
      amount: "120.00",
      method_snapshot: {
        indicator_id: "72c55a55-4708-58d5-8d69-ec1c7ee2d1f9",
        method_version: 1,
        result_schema: "DECIMAL",
        unit_id: "RUB",
        rule: { type: "interval", lower: "0", upper: "5" },
        source: { name: "Ручная настройка справочника норм" },
      },
      evaluation: { status: "IN_NORM", rule_type: "interval", evaluation_mode: "CONFIGURABLE" },
    },
    {
      service_code: "e6be5304-d6d2-5f49-86a3-8e1308b344d4",
      name: "Бактериоскопия",
      unit_id: "RUB",
      quantity: "1",
      unit_price: "0.00",
      amount: "0.00",
      method_snapshot: null,
      evaluation: { status: "UNKNOWN", rule_type: "qualitative", evaluation_mode: "NONE" },
    },
  ],
  total: "120.00",
  currency: "RUB",
  fair: false,
};

const state: PricingPreviewState = { status: "success", snapshot };

// ТЗ DR42 §4.3: the per-line evaluation snapshot travelled in the invoice
// table until DR47. Per ТЗ DR47 §2.6 the live table keeps exactly four
// columns («Единица» and «Оценка» are gone from the invoice view), while the
// evaluation stays in the «Исследования ВСЭ» cards (ResearchFields tests).

// --- ТЗ DR47 §2.6: the live-examination variant of the shared renderer ---------

describe("PricingSection live table (DR47)", () => {
  it("renders exactly the four named columns with the external total and the waiver", () => {
    render(<PricingSection state={state} disabled={false} onRetry={() => {}} />);
    expect(screen.getByRole("columnheader", { name: "Исследование" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Количество" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Тариф" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Сумма" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Единица" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Оценка" })).toBeNull();
    // No tfoot: the total is the reconciliation-style row below the table.
    expect(screen.queryByText("Итого к оплате")).toBeNull();
    const total = document.querySelector("p.vse-rec-invoice-total");
    expect(total).not.toBeNull();
    expect(total?.querySelector("strong")?.textContent).toContain("120,00 ₽");
    expect(total?.closest("table")).toBeNull();
    // The live form keeps the readonly Ярмарка indicator.
    expect(document.querySelector('[data-testid="pricing-waiver"]')).not.toBeNull();
  });

  it("fair pricing keeps the honest zero total with the live waiver", () => {
    render(
      <PricingSection
        state={{ status: "success", snapshot: { ...snapshot, total: "0.00", fair: true } }}
        disabled={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getAllByText("0,00 ₽").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-testid="pricing-waiver"]')).not.toBeNull();
  });
});
