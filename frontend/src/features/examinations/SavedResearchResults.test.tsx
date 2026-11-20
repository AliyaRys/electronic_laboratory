/**
 * SavedResearchResults tests (ТЗ DR55 §5.1/§6.1): the saved card shows ONLY
 * the useful verdicts «Норма»/«Отклонение» — no hints, no norm criteria, no
 * service statuses — and a research without an applicable evaluation keeps
 * NO badge at all. The value stays visible and is programmatically named by
 * the research heading («Сохранённое значение» is gone).
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
const BACTERIOSCOPY = INDICATORS.find((item) => item.code === "VSE-F23") as (typeof INDICATORS)[number];
const MICROSCOPY = INDICATORS.find((item) => item.code === "VSE-F24") as (typeof INDICATORS)[number];
const UNKNOWN_ID = "00000000-0000-0000-0000-00000000dead";

interface LineOverrides {
  evaluation?: Record<string, unknown> | null;
  method_snapshot?: Record<string, unknown> | null;
}

function snapshotOf(lines: { service_code: string; overrides?: LineOverrides }[]): PricingSnapshotView {
  return {
    lines: lines.map(({ service_code, overrides }) => ({
      service_code,
      name: "line",
      unit_id: "service",
      quantity: "1",
      unit_price: "5.00",
      amount: "5.00",
      method_snapshot: overrides?.method_snapshot ?? null,
      evaluation: overrides?.evaluation === undefined ? null : (overrides.evaluation as never),
    })),
    total: "5.00",
    currency: "RUB",
    fair: false,
  };
}

function cardWith(
  researches: Record<string, { kind: string; value: unknown; otherText?: string | null }>,
  lines: { service_code: string; overrides?: LineOverrides }[] = [],
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
    vse_fair: false,
    reconciliation_fair: false,
    fair_source: "NONE",
    researches: Object.entries(researches).map(([indicatorId, item]) => ({
      indicatorId,
      kind: item.kind,
      value: item.value,
      ...(item.otherText !== undefined ? { otherText: item.otherText } : {}),
    })),
    invasive_findings: [],
    noncontagious_findings: [],
    pricing: snapshotOf(lines) as unknown as Record<string, unknown>,
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
  it("shows the exact verdict badges for IN_NORM and DEVIATION, nothing else", () => {
    render(
      <SavedResearchResults
        view={cardWith(
          {
            [ORGANOLEPTIC.id]: { kind: "ENUM", value: "MATCH" },
            [TEMPERATURE.id]: { kind: "DECIMAL", value: "12" },
          },
          [
            {
              service_code: ORGANOLEPTIC.id,
              overrides: { evaluation: { status: "IN_NORM", evaluation_mode: "FIXED" } },
            },
            {
              service_code: TEMPERATURE.id,
              overrides: {
                evaluation: { status: "DEVIATION", evaluation_mode: "CONFIGURABLE", hint: "пересохраните карточку" },
                method_snapshot: { rule: { type: "interval", lower: "0", upper: "10" } },
              },
            },
          ],
        )}
      />,
    );
    expect(screen.getByText("Норма")).toBeTruthy();
    const deviation = screen.getByText("Отклонение");
    // ТЗ DR55 §5.1: no hint, no range/criterion text next to the badge.
    expect(deviation.textContent).toBe("Отклонение");
    expect(screen.queryByText(/норма:/)).toBeNull();
    expect(screen.queryByText(/пересохраните карточку/)).toBeNull();
    expect(screen.queryByText(/от 0 до 10/)).toBeNull();
  });

  it("renders no badge for NOT_APPLICABLE, UNKNOWN, missing evaluation or NONE mode", () => {
    render(
      <SavedResearchResults
        view={cardWith(
          {
            [ORGANOLEPTIC.id]: { kind: "ENUM", value: "MATCH" },
            [TEMPERATURE.id]: { kind: "DECIMAL", value: "4.5" },
            [BACTERIOSCOPY.id]: { kind: "TEXT", value: "рост не обнаружен" },
            [MICROSCOPY.id]: { kind: "DECIMAL", value: "2.5" },
          },
          [
            {
              service_code: ORGANOLEPTIC.id,
              overrides: { evaluation: { status: "NOT_APPLICABLE", evaluation_mode: "FIXED" } },
            },
            {
              service_code: TEMPERATURE.id,
              overrides: { evaluation: { status: "UNKNOWN", evaluation_mode: "CONFIGURABLE" } },
            },
            {
              service_code: BACTERIOSCOPY.id,
              overrides: { evaluation: { status: "IN_NORM", evaluation_mode: "NONE" } },
            },
          ],
        )}
      />,
    );
    const articles = (id: string): Element | null => document.querySelector(`[data-indicator-id="${id}"]`);
    expect(articles(ORGANOLEPTIC.id)?.querySelector(".vse-research-evaluation")).toBeNull();
    expect(articles(TEMPERATURE.id)?.querySelector(".vse-research-evaluation")).toBeNull();
    expect(articles(BACTERIOSCOPY.id)?.querySelector(".vse-research-evaluation")).toBeNull();
    expect(articles(MICROSCOPY.id)?.querySelector(".vse-research-evaluation")).toBeNull();
    // A non-applicable verdict never colours the card either.
    expect(articles(ORGANOLEPTIC.id)?.getAttribute("data-evaluation")).toBeNull();
  });

  it("keeps the values visible and names them by the research heading", () => {
    render(
      <SavedResearchResults
        view={cardWith({
          [TEMPERATURE.id]: { kind: "DECIMAL", value: "4.5" },
          [COOKING.id]: { kind: "ENUM", value: "OTHER", otherText: "свой вариант" },
          [DOSIMETRY.id]: { kind: "DOSIMETRY", value: { first: "1.2", last: "3.4" } },
        })}
      />,
    );
    expect(screen.queryByText("Сохранённое значение")).toBeNull();
    // ТЗ DR55 fix-loop: the value is a semantic readonly output (not an
    // input), and long text wraps inside the card instead of clipping.
    const temperature = screen.getByText("4,5 °C");
    expect(temperature.tagName).toBe("OUTPUT");
    expect(temperature.querySelector("input")).toBeNull();
    expect(document.querySelector<HTMLInputElement>(".vse-research-value input")).toBeNull();
    const heading = temperature.getAttribute("aria-labelledby") ?? "";
    const label = document.getElementById(heading);
    expect(label?.textContent).toContain("Температура в толще мышц");
    expect(screen.getByText("Иное (свой вариант)")).toBeTruthy();
    expect(screen.getByText("1,2 / 3,4 мкЗв/ч")).toBeTruthy();
  });

  it("a very long value wraps inside the card (output, no input clipping)", () => {
    const long = "Очень длинное сохранённое значение исследования ".repeat(12);
    render(
      <SavedResearchResults
        view={cardWith({ [TEMPERATURE.id]: { kind: "TEXT", value: long } })}
      />,
    );
    const value = screen.getByText(
      (_, element) => (element?.getAttribute("class") ?? "").includes("vse-research-value"),
    );
    expect(value.tagName).toBe("OUTPUT");
    expect(value.textContent).toContain(long.trim());
  });

  it("an unknown legacy indicator keeps the value visible with a reserve label", () => {
    render(<SavedResearchResults view={cardWith({ [UNKNOWN_ID]: { kind: "DECIMAL", value: "7" } })} />);
    expect(screen.getByText("Исследование")).toBeTruthy();
    const value = screen.getByText("7");
    expect(value.tagName).toBe("OUTPUT");
    const heading = value.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(heading)?.textContent).toContain("Исследование");
    expect(screen.getByText(/Код показателя/).textContent).toContain(UNKNOWN_ID);
  });

  it("renders findings as readonly rows", () => {
    render(
      <SavedResearchResults
        view={cardWith(
          { [ORGANOLEPTIC.id]: { kind: "BOOLEAN", value: true } },
          [{ service_code: ORGANOLEPTIC.id, overrides: { evaluation: { status: "IN_NORM", evaluation_mode: "FIXED" } } }],
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

  it("marks required researches with the light-blue tone", () => {
    render(
      <SavedResearchResults
        view={cardWith(
          {
            [ORGANOLEPTIC.id]: { kind: "ENUM", value: "MATCH" },
            [MICROSCOPY.id]: { kind: "DECIMAL", value: "2.5" },
          },
          [{ service_code: ORGANOLEPTIC.id, overrides: { evaluation: { status: "IN_NORM", evaluation_mode: "FIXED" } } }],
        )}
      />,
    );
    expect(
      document.querySelector(`[data-indicator-id="${ORGANOLEPTIC.id}"].vse-research-required`),
    ).toBeTruthy();
    expect(document.querySelector(`[data-indicator-id="${MICROSCOPY.id}"].vse-research-required`)).toBeNull();
  });
});
