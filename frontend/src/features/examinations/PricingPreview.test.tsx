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

describe("PricingSection evaluation display", () => {
  it("shows the norm criterion next to the evaluation", () => {
    render(<PricingSection state={state} disabled={false} onRetry={() => {}} />);
    const inNorm = screen.getAllByText("Норма");
    expect(inNorm.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/от 0 до 5/)).toBeTruthy();
  });

  it("UNKNOWN with no norm is never shown as an in-norm verdict", () => {
    render(<PricingSection state={state} disabled={false} onRetry={() => {}} />);
    expect(screen.getByText("Нет оценки нормы")).toBeTruthy();
  });
});
