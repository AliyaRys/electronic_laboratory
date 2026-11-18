/**
 * DocumentComparisonField tests (ТЗ DR47 §2.4): in the accompanying-document
 * card the ✓/× pair is always ONE visual group on the right of
 * ``.vse-rec-document-head`` — even with a very long document name. The
 * radio semantics, accessible names and the mismatch reveal stay unchanged.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DocumentComparisonField, type DocumentComparisonValue } from "./DocumentComparisonField";
import type { AccompanyingDocument } from "./api";

const document: AccompanyingDocument = {
  key: "doc-1",
  sourceOrder: 0,
  typeCode: "1",
  typeLabel: "Ветеринарный сопроводительный документ на партию продукции",
  series: "АБ",
  number: "123456",
  seriesAndNumber: "АБ 123456",
  createdOn: "2026-11-05",
  relationshipType: "1",
};

const LONG_LABEL =
  "Ветеринарный сопроводительный документ на партию продукции, оформленный при отправке с предприятия-изготовителя по системе «Меркурий» в пределах региона";

const base: DocumentComparisonValue = { matches: null, reason: "" };

describe("DocumentComparisonField", () => {
  it("keeps the radiogroup with two named radios and honest checked state", () => {
    render(<DocumentComparisonField documentKey={document.key} document={document} value={base} onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: /Отметка сравнения/ });
    const radios = group.querySelectorAll("input[type=radio]");
    expect(radios.length).toBe(2);
    expect(screen.getByRole("radio", { name: `Соответствует: ${document.typeLabel}` })).toBeTruthy();
    expect(screen.getByRole("radio", { name: `Не соответствует: ${document.typeLabel}` })).toBeTruthy();
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
  });

  it("keeps the mark buttons as one real wrapper inside the document head", () => {
    render(<DocumentComparisonField documentKey={document.key} document={document} value={base} onChange={() => {}} />);
    const headEl = screen.getByRole("radiogroup").closest(".vse-rec-document-head");
    expect(headEl).not.toBeNull();
    const wrapper = screen.getByRole("radiogroup");
    expect(wrapper.classList.contains("vse-rec-check-buttons")).toBe(true);
    // The wrapper is a real grid child of the head (never display:contents —
    // that would drop the two buttons into separate grid tracks of the head).
    expect(getComputedStyle(wrapper).display).not.toBe("contents");
  });

  it("reveals the structured actual value and the reason input on mismatch", async () => {
    const user = userEvent.setup();
    let current = base;
    const { rerender } = render(
      <DocumentComparisonField
        documentKey={document.key}
        document={document}
        value={base}
        onChange={(next) => {
          current = next;
          rerender(
            <DocumentComparisonField
              documentKey={document.key}
              document={document}
              value={next}
              onChange={(more) => {
                current = more;
              }}
            />,
          );
        }}
      />,
    );
    await user.click(screen.getByRole("radio", { name: `Не соответствует: ${document.typeLabel}` }));
    expect(current.matches).toBe(false);
    expect(await screen.findByText("Фактическое значение")).toBeTruthy();
    expect(screen.getByLabelText("Причина несоответствия")).toBeTruthy();
  });

  it("keeps the two buttons in one right-side group with a very long document name (DR47)", () => {
    render(
      <DocumentComparisonField
        documentKey={document.key}
        document={{ ...document, typeLabel: LONG_LABEL }}
        value={base}
        onChange={() => {}}
      />,
    );
    const headEl = screen.getByRole("radiogroup").closest(".vse-rec-document-head");
    expect(headEl).not.toBeNull();
    // The head is a two-track grid: the name (minmax(0,1fr)) and the button
    // group (auto) — the buttons never fall into the name's text column.
    expect(getComputedStyle(headEl as Element).gridTemplateColumns.split(" ").length).toBe(2);
    const wrapper = screen.getByRole("radiogroup");
    expect(getComputedStyle(wrapper).display).not.toBe("contents");
    const nameEl = headEl?.querySelector(".vse-rec-document-name");
    expect(nameEl).not.toBeNull();
    expect(getComputedStyle(nameEl as Element).overflowWrap).toBe("anywhere");
  });
});
