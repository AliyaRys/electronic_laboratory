/**
 * ТЗ DR41-B §7.2: the research card highlight comes only from the typed
 * server evaluation of the preview; the text always travels with the colour
 * and UNKNOWN is never repainted as a norm.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { emptyResearch, type ExaminationFormValues } from "./formValues";
import { ResearchFields, type ResearchEvaluation } from "./ResearchFields";

const F18 = "c8d1e50e-bf49-5475-bb82-860f6fc47e74";
const F23 = "e6be5304-d6d2-5f49-86a3-8e1308b344d4";
const F24 = "72c55a55-4708-58d5-8d69-ec1c7ee2d1f9";

function baseValues(): ExaminationFormValues {
  return {
    number: "",
    stamp: "",
    sentToLab: false,
    sample: { mode: "NEW", collectedOn: "", massKg: "", collectionId: "", expectedRevision: "" },
    researches: {
      [F18]: emptyResearch({ performed: true, value: "MATCH" }),
      [F23]: emptyResearch({ performed: true, value: "рост не обнаружен" }),
      [F24]: emptyResearch({ performed: true, value: "2" }),
    },
    invasive: [],
    noncontagious: [],
    outcome: { outcome: "", direction: "", reason: "" },
    specialistId: "",
  };
}

function renderCards(evaluations: ReadonlyMap<string, ResearchEvaluation>): void {
  render(
    <ResearchFields
      values={baseValues()}
      view={null}
      disabled={false}
      requiredResearchIds={new Set()}
      evaluations={evaluations}
      onChange={() => {}}
    />,
  );
}

describe("ResearchFields evaluation highlight", () => {
  it("shows the green norm verdict with its text", () => {
    renderCards(new Map([[F18, { status: "IN_NORM" }]]));
    const badge = screen.getByText("Норма");
    expect(badge.closest("span")).toHaveAttribute("data-evaluation", "IN_NORM");
    expect(badge.closest("article")).toHaveAttribute("data-evaluated", "true");
  });

  it("shows the red deviation verdict with its text", () => {
    renderCards(new Map([[F18, { status: "DEVIATION" }]]));
    expect(screen.getByText("Отклонение")).toHaveAttribute("data-evaluation", "DEVIATION");
  });

  it("NOT_APPLICABLE keeps the neutral wording", () => {
    renderCards(new Map([[F23, { status: "NOT_APPLICABLE" }]]));
    expect(screen.getByText("Оценка по норме не применяется")).toHaveAttribute(
      "data-evaluation",
      "NOT_APPLICABLE",
    );
  });

  it("UNKNOWN is never painted as a norm and carries the legacy hint", () => {
    renderCards(
      new Map([
        [
          F24,
          {
            status: "UNKNOWN",
            hint: "Норма сохранена в устаревшем целочисленном формате: пересохраните норму показателя в справочнике.",
          },
        ],
      ]),
    );
    const badge = screen.getByText("Оценка не определена");
    expect(badge).toHaveAttribute("data-evaluation", "UNKNOWN");
    expect(screen.getByText(/пересохраните норму/i)).toBeInTheDocument();
  });
});
