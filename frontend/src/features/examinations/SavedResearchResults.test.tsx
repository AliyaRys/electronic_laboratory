/**
 * SavedResearchResults tests (ТЗ DR44 §4.2, Task 5): the readonly saved
 * researches of the card — typed value formatting, Russian names from the
 * canonical INDICATORS registry, the frozen server evaluation, required tone
 * and the honest legacy fallback for an unknown indicator.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { INDICATORS } from "./indicators";
import { SavedResearchResults } from "./SavedResearchResults";
import type { ExaminationView, PricingSnapshotView } from "./api";

const ORGANOLEPTIC = INDICATORS.find((item) => item.code === "VSE-F18") as (typeof INDICATORS)[number];
const TEMPERATURE = INDICATORS.find((item) => item.code === "VSE-F20") as (typeof INDICATORS)[number];
const COOKING = INDICATORS.find((item) => item.code === "VSE-F26") as (typeof INDICATORS)[number];
const DOSIMETRY = INDICATORS.find((item) => item.code === "VSE-F29") as (typeof INDICATORS)[number];
const MICROSCOPY = INDICATORS.find((item) => item.code === "VSE-F24") as (typeof INDICATORS)[number];
const UNKNOWN_ID = "00000000-0000-0000-0000-00000000dead";

const snapshot: PricingSnapshotView = {
  lines: [
    {
      service_code: TEMPERATURE.id,
      name: "Температура в толще мышц",
      unit_id: "service",
      quantity: "1",
      unit_price: "5.00",
      amount: "5.00",
      method_snapshot: { rule: { type: "interval", lower: "0", upper: "10" } },
      evaluation: { status: "DEVIATION", hint: "пересохраните карточку" },
    },
    {
      service_code: ORGANOLEPTIC.id,
      name: "Органолептическое исследование",
      unit_id: "service",
      quantity: "1",
      unit_price: "5.00",
      amount: "5.00",
      method_snapshot: { rule: { type: "qualitative", accepted_values: ["true"] } },
      evaluation: { status: "IN_NORM" },
    },
  ],
  total: "10.00",
  currency: "RUB",
  fair: false,
};

function cardWith(
  researches: Record<string, { kind: string; value: unknown; otherText?: string | null }>,
  overrides: Partial<Pick<ExaminationView, "invasive_findings" | "noncontagious_findings">> = {},
): ExaminationView {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    party_id: "22222222-1111-4222-8333-444444444444",
    laboratory_id: "33333333-1111-4333-8333-444444444444",
    number: "Г-1024",
    stamp: "Клеймо-1",
    status: "COMPLETED",
    sent_to_lab: false,
    researches: Object.entries(researches).map(([indicatorId, item]) => ({
      indicatorId,
      kind: item.kind,
      value: item.value,
      ...(item.otherText !== undefined ? { otherText: item.otherText } : {}),
    })),
    invasive_findings: [],
    noncontagious_findings: [],
    pricing: snapshot as unknown as Record<string, unknown>,
    sample_collection_id: "44444444-4444-4444-8444-444444444444",
    sample: {
      id: "44444444-4444-4444-8444-444444444444",
      collected_on: "2026-11-05",
      mass_kg: "0.800000",
      revision: 1,
    },
    outcome: "FIT",
    direction: "SALE",
    reason: null,
    created_by: "55555555-1111-4555-8333-444444444444",
    specialist_id: "55555555-1111-4555-8333-444444444444",
    specialist_name: "Смирнова Ольга Ивановна",
    created_at: "2026-11-05T08:00:00Z",
    first_completed_at: "2026-11-05T09:00:00Z",
    revision: 1,
    ...overrides,
  };
}

describe("SavedResearchResults", () => {
  it("shows the Russian names, not «Показатель UUID»", () => {
    render(
      <SavedResearchResults
        view={cardWith({
          [ORGANOLEPTIC.id]: { kind: "ENUM", value: "MATCH" },
          [TEMPERATURE.id]: { kind: "DECIMAL", value: "4.5" },
        })}
      />,
    );
    expect(screen.getByText("Органолептическое исследование")).toBeTruthy();
    expect(screen.getByText("Температура в толще мышц")).toBeTruthy();
    expect(screen.queryByText(/Показатель /)).toBeNull();
  });

  it("formats the typed values: decimal with unit, enum option, other text", () => {
    render(
      <SavedResearchResults
        view={cardWith({
          [TEMPERATURE.id]: { kind: "DECIMAL", value: "4.5" },
          [ORGANOLEPTIC.id]: { kind: "ENUM", value: "MATCH" },
          [COOKING.id]: { kind: "ENUM", value: "OTHER", otherText: "свой вариант" },
          [MICROSCOPY.id]: { kind: "DECIMAL", value: "2.5" },
        })}
      />,
    );
    expect(screen.getByDisplayValue("4,5 °C")).toBeTruthy();
    expect(screen.getByDisplayValue("Соответствует")).toBeTruthy();
    expect(screen.getByDisplayValue("Иное (свой вариант)")).toBeTruthy();
    expect(screen.getByDisplayValue("2,5")).toBeTruthy();
  });

  it("formats BOOLEAN and DOSIMETRY values", () => {
    render(
      <SavedResearchResults
        view={cardWith({
          [ORGANOLEPTIC.id]: { kind: "BOOLEAN", value: false },
          [DOSIMETRY.id]: { kind: "DOSIMETRY", value: { first: "1.2", last: "3.4" } },
        })}
      />,
    );
    expect(screen.getByDisplayValue("Обнаружено")).toBeTruthy();
    expect(screen.getByDisplayValue("1,2 / 3,4 мкЗв/ч")).toBeTruthy();
  });

  it("shows the frozen server evaluation with the norm criterion", () => {
    render(
      <SavedResearchResults
        view={cardWith({
          [TEMPERATURE.id]: { kind: "DECIMAL", value: "12" },
          [ORGANOLEPTIC.id]: { kind: "BOOLEAN", value: true },
        })}
      />,
    );
    const deviation = screen.getAllByText(/Отклонение/)[0];
    expect(deviation.textContent).toContain("пересохраните карточку");
    expect(deviation.textContent).toContain("от 0 до 10");
    const norm = screen.getAllByText(/Норма/)[0];
    expect(norm.textContent).toContain("норма: true");
  });

  it("marks required researches with the light-blue tone", () => {
    render(
      <SavedResearchResults
        view={cardWith({
          [ORGANOLEPTIC.id]: { kind: "BOOLEAN", value: true },
          [MICROSCOPY.id]: { kind: "DECIMAL", value: "2.5" },
        })}
      />,
    );
    expect(
      document.querySelector(`[data-indicator-id="${ORGANOLEPTIC.id}"].vse-research-required`),
    ).toBeTruthy();
    expect(document.querySelector(`[data-indicator-id="${MICROSCOPY.id}"].vse-research-required`)).toBeNull();
  });

  it("renders findings as readonly rows", () => {
    render(
      <SavedResearchResults
        view={cardWith(
          { [ORGANOLEPTIC.id]: { kind: "BOOLEAN", value: true } },
          {
            invasive_findings: [{ disease: "Трихинеллёз", location: "мышцы" }],
            noncontagious_findings: [{ disease: "Пастереллёз", otherText: "уточнение" }],
          },
        )}
      />,
    );
    expect(screen.getByText("Трихинеллёз — мышцы")).toBeTruthy();
    expect(screen.getByText("Пастереллёз (уточнение)")).toBeTruthy();
  });

  it("an unknown legacy indicator keeps the value visible with a reserve label", () => {
    render(<SavedResearchResults view={cardWith({ [UNKNOWN_ID]: { kind: "DECIMAL", value: "7" } })} />);
    expect(screen.getByText("Исследование")).toBeTruthy();
    const extra = screen.getByDisplayValue("7");
    expect(extra).toBeTruthy();
    expect(screen.getByText(/Код показателя/).textContent).toContain(UNKNOWN_ID);
    expect(screen.queryByText(/Показатель /)).toBeNull();
  });
});
