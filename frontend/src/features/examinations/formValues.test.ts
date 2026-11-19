/**
 * ТЗ DR42 §5: the decimal research values of the form value model.
 *
 * The client mirrors the server's decimal grammar: comma input is normalised
 * to a dot before the API, intermediate typing («2,») never breaks the form
 * and negatives, NaN/Infinity, exponent forms and empty performed values are
 * rejected without parseFloat/toFixed/binary float.
 */
import { describe, expect, it } from "vitest";
import {
  emptyResearch,
  normalizeDecimalInput,
  researchErrors,
  toWritePayload,
  type ExaminationFormValues,
} from "./formValues";
import { INDICATORS } from "./indicators";

const MICROSCOPY = INDICATORS.find((def) => def.code === "VSE-F24");
const PH = INDICATORS.find((def) => def.code === "VSE-F25");
const TEMPERATURE = INDICATORS.find((def) => def.code === "VSE-F20");
const DOSIMETRY = INDICATORS.find((def) => def.code === "VSE-F29");

if (MICROSCOPY === undefined || PH === undefined || TEMPERATURE === undefined || DOSIMETRY === undefined) {
  throw new Error("the FT numeric indicators must exist");
}

function valuesWith(researches: ExaminationFormValues["researches"]): ExaminationFormValues {
  // Universally mandatory FT researches are always performed in these fixtures.
  for (const def of INDICATORS) {
    if (def.mandatory && researches[def.id] === undefined) {
      researches[def.id] = emptyResearch({
        performed: true,
        value: def.kind === "DECIMAL" ? "4" : (def.options?.[0]?.value ?? ""),
      });
    }
  }
  return {
    number: "1",
    stamp: "клеймо",
    sentToLab: false,
    vseFair: false,
    sample: {
      mode: "NEW",
      collectedOn: "2026-11-17",
      massKg: "0.8",
      collectionId: "",
      expectedRevision: "",
    },
    researches,
    invasive: [],
    noncontagious: [],
    outcome: { outcome: "", direction: "", reason: "" },
    specialistId: "",
  };
}

describe("normalizeDecimalInput", () => {
  it.each([
    ["2", "2"],
    ["2.5", "2.5"],
    ["2,5", "2.5"],
    [" 2,5 ", "2.5"],
    ["0", "0"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normalizeDecimalInput(input)).toBe(expected);
  });

  it.each(["-1", "abc", "NaN", "Infinity", "2e1", "", " "])("rejects %s", (input) => {
    expect(normalizeDecimalInput(input)).toBeNull();
  });
});

describe("microscopy (VSE-F24) accepts decimals", () => {
  it.each([
    ["2.5", "2.5"],
    ["2,5", "2.5"],
    ["0", "0"],
    ["2", "2"],
  ])("%s passes the client mirror", (value, wire) => {
    const values = valuesWith({
      [MICROSCOPY.id]: emptyResearch({ performed: true, value }),
      [TEMPERATURE.id]: emptyResearch({ performed: true, value: "4.2" }),
    });
    expect(researchErrors(values)).toEqual([]);
    const payload = toWritePayload(values, "WAITING");
    const row = payload?.researches.find((item) => item.indicatorId === MICROSCOPY.id);
    expect(row).toEqual({ indicatorId: MICROSCOPY.id, kind: "DECIMAL", value: wire });
  });

  it.each(["-1", "abc", "Infinity", ""])("%s is rejected with a readable message", (value) => {
    const values = valuesWith({
      [MICROSCOPY.id]: emptyResearch({ performed: true, value }),
      [TEMPERATURE.id]: emptyResearch({ performed: true, value: "4.2" }),
    });
    const errors = researchErrors(values);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain(MICROSCOPY.name);
  });
});

describe("other numeric fields stay decimal", () => {
  it("pH accepts 7,4 and 14,5 without a blocking error (DR52 §2)", () => {
    const ok = valuesWith({
      [PH.id]: emptyResearch({ performed: true, value: "7,4" }),
    });
    expect(researchErrors(ok)).toEqual([]);
    const deviation = valuesWith({
      [PH.id]: emptyResearch({ performed: true, value: "14,5" }),
    });
    expect(researchErrors(deviation)).toEqual([]);
  });

  it("pH still rejects a non-decimal shape", () => {
    const bad = valuesWith({
      [PH.id]: emptyResearch({ performed: true, value: "abc" }),
    });
    expect(researchErrors(bad).some((message) => message.includes("десятичное"))).toBe(true);
  });

  it("temperature and dosimetry accept fractional readings", () => {
    const values = valuesWith({
      [TEMPERATURE.id]: emptyResearch({ performed: true, value: "4,25" }),
      [DOSIMETRY.id]: emptyResearch({ performed: true, first: "0,5", last: "0,75" }),
    });
    expect(researchErrors(values)).toEqual([]);
    const payload = toWritePayload(values, "WAITING");
    const temperature = payload?.researches.find((item) => item.indicatorId === TEMPERATURE.id);
    expect(temperature).toEqual({ indicatorId: TEMPERATURE.id, kind: "DECIMAL", value: "4.25" });
  });

  it("the shared registry has no INTEGER research kind any more", () => {
    for (const def of INDICATORS) {
      expect(def.kind).not.toBe("INTEGER");
    }
  });
});
