/**
 * DocumentComparisonField tests (ТЗ DR47 §2.4): in the accompanying-document
 * card the ✓/× pair is always ONE visual group on the right of
 * ``.vse-rec-document-head`` — even with a very long document name. The
 * radio semantics, accessible names and the mismatch reveal stay unchanged.
 *
 * vitest runs with ``css: false`` (see the raw-CSS note below).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DocumentComparisonField, type DocumentComparisonValue } from "./DocumentComparisonField";
import type { AccompanyingDocument } from "./api";

// vitest runs with ``css: false`` (computed layout belongs to the real
// browser), so the stylesheet contract is verified against the raw CSS text
// of ``reconciliation.css`` and the DOM against the composed classes.
const reconciliationCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "reconciliation.css"),
  "utf8",
);

const documentRow: AccompanyingDocument = {
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
    render(
      <DocumentComparisonField documentKey={documentRow.key} document={documentRow} value={base} onChange={() => {}} />,
    );
    const group = screen.getByRole("radiogroup", { name: /Отметка сравнения/ });
    const radios = group.querySelectorAll("input[type=radio]");
    expect(radios.length).toBe(2);
    expect(screen.getByRole("radio", { name: `Соответствует: ${documentRow.typeLabel}` })).toBeTruthy();
    expect(screen.getByRole("radio", { name: `Не соответствует: ${documentRow.typeLabel}` })).toBeTruthy();
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
  });

  it("keeps the mark buttons as one real wrapper inside the document head", () => {
    render(
      <DocumentComparisonField documentKey={documentRow.key} document={documentRow} value={base} onChange={() => {}} />,
    );
    const headEl = screen.getByRole("radiogroup").closest(".vse-rec-document-head");
    expect(headEl).not.toBeNull();
    const wrapper = screen.getByRole("radiogroup");
    // The wrapper is a real element in the head (the two buttons are its
    // children, not separate grid tracks of the head).
    expect(wrapper.classList.contains("vse-rec-check-buttons")).toBe(true);
    expect(wrapper.querySelectorAll("label.vse-rec-check").length).toBe(2);
    expect(headEl?.contains(wrapper)).toBe(true);
  });

  it("on mismatch reveals ONLY the reason input (no duplicate actual block, DR53 Task 2)", async () => {
    const user = userEvent.setup();
    let current = base;
    const { rerender } = render(
      <DocumentComparisonField
        documentKey={documentRow.key}
        document={documentRow}
        value={base}
        onChange={(next) => {
          current = next;
          rerender(
            <DocumentComparisonField
              documentKey={documentRow.key}
              document={documentRow}
              value={next}
              onChange={(more) => {
                current = more;
              }}
            />,
          );
        }}
      />,
    );
    await user.click(screen.getByRole("radio", { name: `Не соответствует: ${documentRow.typeLabel}` }));
    expect(current.matches).toBe(false);
    expect(await screen.findByLabelText("Причина несоответствия")).toBeTruthy();
    // ТЗ DR53 Task 2: the fabricated «Фактическое значение» block is gone
    // from the DOM and accessibility tree; the source facts stay printed once.
    expect(screen.queryByText("Фактическое значение")).toBeNull();
    const factDls = document.querySelectorAll(".vse-rec-document-facts");
    expect(factDls.length).toBe(1);
    const typeDds = document.querySelectorAll(".vse-rec-document-fact dt");
    expect(typeDds.length).toBe(3);
    // The mark buttons stay in place: the head keeps its two children.
    expect(document.querySelector(".vse-rec-document-head .vse-rec-check-buttons")).not.toBeNull();
  });

  it("the stylesheet keeps the scoped right-side group rule (DR47 §2.4)", () => {
    // The generic ``display: contents`` stays for the ordinary compare rows…
    expect(reconciliationCss).toContain(".vse-rec-check-buttons {\n  display: contents;\n}");
    // …while the document head owns a REAL flex group on the right.
    const scopedRule = reconciliationCss
      .split("}")
      .find((chunk) => chunk.includes(".vse-rec-document-head .vse-rec-check-buttons"));
    expect(scopedRule).toBeDefined();
    expect(scopedRule).toContain("display: flex");
    expect(scopedRule).toContain("gap: 6px");
    expect(scopedRule).toContain("justify-self: end");
    // The head stays a two-track grid: name column + button group.
    const headRule = reconciliationCss.split("}").find((chunk) => chunk.includes(".vse-rec-document-head {"));
    expect(headRule).toBeDefined();
    expect(headRule).toContain("grid-template-columns: minmax(0, 1fr) auto");
  });

  it("keeps the buttons grouped with a very long document name (DR47)", () => {
    render(
      <DocumentComparisonField
        documentKey={documentRow.key}
        document={{ ...documentRow, typeLabel: LONG_LABEL }}
        value={base}
        onChange={() => {}}
      />,
    );
    const headEl = screen.getByRole("radiogroup").closest(".vse-rec-document-head");
    expect(headEl).not.toBeNull();
    // Both mark buttons stay inside the single head wrapper (never dropped
    // into the head grid as separate children by display:contents).
    const wrapper = headEl?.querySelector(".vse-rec-check-buttons");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelectorAll("label.vse-rec-check").length).toBe(2);
    // The name keeps its own min-width:0 column (overflow-wrap from CSS).
    const nameEl = headEl?.querySelector(".vse-rec-document-name");
    expect(nameEl).not.toBeNull();
    expect(nameEl?.textContent).toBe(LONG_LABEL);
  });
});
