/**
 * ТЗ DR41-B §7.2: the research card highlight comes only from the typed
 * server evaluation of the preview; the text always travels with the colour
 * and UNKNOWN is never repainted as a norm.
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  render(<StatefulCards evaluations={evaluations} />);
}

/** Stateful harness: the add/remove actions go through the real onChange. */
function StatefulCards({ evaluations }: { evaluations: ReadonlyMap<string, ResearchEvaluation> }): React.ReactElement {
  const [values, setValues] = useState<ExaminationFormValues>(baseValues);
  return (
    <ResearchFields
      values={values}
      view={null}
      disabled={false}
      requiredResearchIds={new Set()}
      evaluations={evaluations}
      onChange={setValues}
    />
  );
}

describe("ResearchFields addzone and disease editors (ТЗ DR46 §3.5)", () => {
  it("keeps both disease add buttons in the common addzone with the dashed style", () => {
    renderCards(new Map());
    const addzone = document.querySelector('.vse-research-addzone[aria-label="Дополнительные исследования"]');
    expect(addzone).not.toBeNull();
    const buttons = Array.from(addzone?.querySelectorAll("button.vse-research-add") ?? []);
    const labels = buttons.map((button) => button.textContent);
    expect(labels.some((text) => text?.includes("Добавить инвазионные болезни"))).toBe(true);
    expect(labels.some((text) => text?.includes("Добавить незаразное заболевание"))).toBe(true);
    expect(buttons[0]?.className).toContain("vse-research-add");
  });

  it("opens the invasive editor above the addzone and focuses the new select", async () => {
    const act = userEvent.setup();
    renderCards(new Map());
    await act.click(screen.getByRole("button", { name: "Добавить инвазионные болезни" }));
    const editor = document.querySelector(".vse-findings");
    const addzone = document.querySelector(".vse-research-addzone");
    expect(editor).not.toBeNull();
    // DOM order: the active editor goes BEFORE the common addzone.
    expect(editor?.compareDocumentPosition(addzone as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const select = editor?.querySelector(".vse-finding-row select");
    expect(document.activeElement).toBe(select);
  });

  it("supports several rows and removes the last one without resetting the others", async () => {
    const act = userEvent.setup();
    renderCards(new Map());
    await act.click(screen.getByRole("button", { name: "Добавить инвазионные болезни" }));
    await act.click(screen.getByRole("button", { name: "Добавить инвазионные болезни" }));
    expect(document.querySelectorAll(".vse-findings .vse-finding-row").length).toBe(2);
    const selects = document.querySelectorAll(".vse-findings .vse-finding-row select");
    expect(selects.length).toBe(2);
    // Removing rows: the last remove button deletes only its own row.
    await act.click(screen.getByRole("button", { name: "Удалить инвазионную болезнь 2" }));
    expect(document.querySelectorAll(".vse-findings .vse-finding-row").length).toBe(1);
    expect(screen.getByRole("button", { name: "Добавить инвазионные болезни" })).toBeTruthy();
    // Deleting the last row hides the editor but keeps the add action.
    await act.click(screen.getByRole("button", { name: "Удалить инвазионную болезнь 1" }));
    expect(document.querySelector(".vse-findings")).toBeNull();
    expect(screen.getByRole("button", { name: "Добавить инвазионные болезни" })).toBeTruthy();
  });
});

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
