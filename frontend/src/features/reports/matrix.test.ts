/**
 * Matrix projection tests (DR51 §2/§7): the client shows the full-form
 * payload as-is — the 47-row catalogue comes from the payload, the two bird
 * columns stay separate, BLANK cells stay empty and a calculated zero stays
 * visible — and no recomputation happens.
 */
import { describe, expect, it } from "vitest";
import { buildMatrix, displayCell } from "./matrix";

const COLUMNS = ["CATTLE", "PIG", "SHEEP_GOAT", "RABBIT_NUTRIA", "CHICKEN", "OTHER_BIRDS", "FISH", "OTHER_ANIMALS"];

const ROWS = [
  { code: "166", name: "1. Осмотрено (проведено ветеринарно-санитарных экспертиз), всего, единиц", mode: "AUTO" },
  { code: "167", name: "в том числе: микроскопических", mode: "AUTO" },
  { code: "173", name: "3. Выявлено случаев болезни при ВСЭ, единиц", mode: "BLANK" },
  { code: "210", name: "Незаразные болезни", mode: "AUTO" },
  { code: "240", name: "7. Направлено на уничтожение, тонн", mode: "AUTO" },
];

const payload = {
  form_version: "2",
  columns: COLUMNS,
  rows: ROWS,
  matrix: [
    ["1", "0", "0", "0", "2", "3", "0", "0"],
    ["0", "2", "0", "0", "0", "0", "0", "0"],
    [null, null, null, null, null, null, null, null],
    ["3", "0", "0", "0", "0", "0", "0", "0"],
    ["0.25", "0", "0", "0", "0", "0", "0", "0"],
  ],
};

describe("buildMatrix", () => {
  it("keeps the two bird columns separate under «Птица»", () => {
    const model = buildMatrix(payload);
    expect(model.columns).toEqual([
      "Крупный рогатый скот, яки, буйволы",
      "Свиньи",
      "Овцы, козы",
      "Кролики, нутрии",
      "Птица: куры",
      "Птица: другие виды",
      "Рыба",
      "Другие виды животных",
    ]);
  });

  it("takes the exact row catalogue from the payload, not a local list", () => {
    const model = buildMatrix(payload);
    expect(model.rows.map((row) => row.code)).toEqual(["166", "167", "173", "210", "240"]);
    expect(model.rows[0]?.name).toBe("1. Осмотрено (проведено ветеринарно-санитарных экспертиз), всего, единиц");
  });

  it("shows the payload values verbatim and never merges or dedups", () => {
    const model = buildMatrix(payload);
    const row166 = model.rows[0]!;
    expect(displayCell(row166, 0)).toBe("1");
    expect(displayCell(row166, 4)).toBe("2");
    expect(displayCell(row166, 5)).toBe("3");
    const row210 = model.rows[3]!;
    expect(displayCell(row210, 0)).toBe("3");
    expect(displayCell(row210, 1)).toBe("0"); // the calculated zero stays visible
  });

  it("keeps BLANK rows empty — never «Не рассчитывается», «—» or 0", () => {
    const model = buildMatrix(payload);
    const row173 = model.rows[2]!;
    expect(row173.automatic).toBe(false);
    for (let index = 0; index < model.columns.length; index += 1) {
      expect(displayCell(row173, index)).toBeNull();
    }
  });

  it("degrades missing payload cells to empty nulls, never a guess", () => {
    const model = buildMatrix({ columns: ["PIG"], rows: [{ code: "166", name: "x", mode: "AUTO" }], matrix: [] });
    expect(model.columns).toEqual(["Свиньи"]);
    expect(displayCell(model.rows[0]!, 0)).toBeNull();
  });

  it("parses exact decimals without float artifacts", async () => {
    const { toScaledUnits, formatScaled } = await import("./matrix");
    expect(formatScaled(toScaledUnits("0.07"))).toBe("0.07");
    expect(formatScaled(toScaledUnits("0.000000001"))).toBe("0");
    expect(formatScaled(toScaledUnits("100.25"))).toBe("100.25");
  });
});
