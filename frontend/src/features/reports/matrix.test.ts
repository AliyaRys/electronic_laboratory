/**
 * Matrix projection tests (R03): the client shows the saved payload as-is —
 * the bird columns merge for the printed shape, manual rows stay «Не
 * рассчитывается», empty cells show «—», and no recomputation happens.
 */
import { describe, expect, it } from "vitest";
import { buildMatrix, displayCell, BIRD_COLUMN, NOT_CALCULATED } from "./matrix";

const payload = {
  version: 1,
  classification_version: "2026-v1",
  columns: [
    "CATTLE",
    "PIG",
    "SHEEP_GOAT",
    "RABBIT_NUTRIA",
    "CHICKEN",
    "OTHER_BIRDS",
    "FISH",
    "OTHER_ANIMALS",
  ],
  matrix: [
    ["1", "0", "0", "0", "2", "3", "0", "0"],
    ["0", "2", "0", "0", "0", "0", "0", "0"],
    ["0", "1", "0", "0", "0", "0", "0", "0"],
    ["0", "3", "0", "0", "0", "0", "0", "0"],
    ["0", "1", "0", "0", "0", "0", "0", "0"],
    ["0", "3", "0", "0", "0", "0", "0", "0"],
    ["0", "0", "0", "0", "0", "0", "0", "0"],
    ["0.25", "0", "0", "0", "0", "0", "0", "0"],
    ["0.25", "0", "0", "0", "0", "0", "0", "0"],
    ["0", "0", "0", "0", "0", "0", "0", "0"],
  ],
};

describe("buildMatrix", () => {
  it("merges the two bird columns into one printed column", () => {
    const model = buildMatrix(payload, 1);
    expect(model.columns).toHaveLength(7);
    expect(model.columns).toContain(BIRD_COLUMN);
    expect(model.columns).not.toContain("Птица — куры");
    expect(model.columns).not.toContain("Птица — другие");
  });

  it("shows the payload values verbatim and sums the merged bird pair", () => {
    const model = buildMatrix(payload, 1);
    const row166 = model.rows[0]!;
    const birdIndex = model.columns.indexOf(BIRD_COLUMN);
    expect(displayCell(row166, 0)).toBe("1");
    // 2 (куры) + 3 (другие) = 5, exactly as saved — no recomputation of sources.
    expect(displayCell(row166, birdIndex)).toBe("5");
    const row240 = model.rows[7]!;
    expect(displayCell(row240, 0)).toBe("0.25");
  });

  it("appends the two manual rows as «Не рассчитывается» and keeps provenance", () => {
    const model = buildMatrix(payload, 4);
    const manual = model.rows.slice(-2);
    expect(manual.map((row) => row.code)).toEqual(["sickness_of_animals", "inspections_of_meat"]);
    for (const row of manual) {
      expect(row.automatic).toBe(false);
      for (let index = 0; index < model.columns.length; index += 1) {
        expect(displayCell(row, index)).toBe(NOT_CALCULATED);
      }
    }
    expect(model.versions.some((version) => version.includes("2026-v1"))).toBe(true);
    expect(model.sourceCount).toBe(4);
  });

  it("shows «—» for missing payload cells instead of a guess", () => {
    const model = buildMatrix({ columns: ["PIG"], matrix: [] }, 0);
    expect(model.columns).toEqual(["Свиньи"]);
    expect(displayCell(model.rows[0]!, 0)).toBe("—");
  });
});
