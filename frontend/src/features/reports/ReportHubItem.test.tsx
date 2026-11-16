/**
 * ReportHubItem tests (DR37 §Task 4): the row is not a clickable container;
 * the single visible action is a keyboard-accessible link with an explicit
 * accessible name; a row without a target renders no action.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ReportHubItem } from "./ReportHubItem";

function renderItem(props: Parameters<typeof ReportHubItem>[0]): void {
  render(
    <MemoryRouter>
      <ReportHubItem {...props} />
    </MemoryRouter>,
  );
}

describe("ReportHubItem", () => {
  it("renders name, real meta and one action link with an explicit accessible name", () => {
    renderItem({
      name: "Операционные показатели",
      meta: "Показатели работы лаборатории за выбранный период.",
      to: "/labs/LAB/reports/operational",
      actionLabel: "Открыть: Операционные показатели",
    });
    expect(screen.getByText("Операционные показатели")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть: Операционные показатели" })).toHaveAttribute(
      "href",
      "/labs/LAB/reports/operational",
    );
  });

  it("a row without a target has no action and no clickable container", () => {
    renderItem({ name: "Форма 5-вет (раздел III)", meta: "Сохранённых отчётов пока нет." });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Форма 5-вет (раздел III)").tagName).toBe("DIV");
  });
});
