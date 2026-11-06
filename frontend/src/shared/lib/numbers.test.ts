/**
 * Strict decimal input parser (SPEC-05): comma/point normalize into a dotted
 * string, everything outside a finite non-negative decimal is rejected, and
 * numbers/identifiers are never converted to JS numbers.
 */
import { describe, expect, it } from "vitest";
import { parseDecimal } from "./numbers";

describe("parseDecimal", () => {
  it("accepts zero, comma and point input", () => {
    expect(parseDecimal("0")).toBe("0");
    expect(parseDecimal("0,5")).toBe("0.5");
    expect(parseDecimal("1.25")).toBe("1.25");
    expect(parseDecimal("1,5")).toBe("1.5");
    expect(parseDecimal(" 2 ")).toBe("2");
    expect(parseDecimal("12,06")).toBe("12.06");
  });

  it("rejects non-numbers, empty, negative, exponent and incomplete input", () => {
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("NaN")).toBeNull();
    expect(parseDecimal("Infinity")).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal("-1")).toBeNull();
    expect(parseDecimal("-0")).toBeNull();
    expect(parseDecimal("+5")).toBeNull();
    expect(parseDecimal("1e3")).toBeNull();
    expect(parseDecimal("1E3")).toBeNull();
    expect(parseDecimal("1.2.3")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal("1.")).toBeNull();
    expect(parseDecimal(".5")).toBeNull();
    expect(parseDecimal(",")).toBeNull();
    expect(parseDecimal("٣")).toBeNull();
  });

  it("empty input is not zero", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("")).not.toBe("0");
  });

  it("enforces supported precision (masses 6, money 2)", () => {
    expect(parseDecimal("0.123456", { maxFractionDigits: 6 })).toBe("0.123456");
    expect(parseDecimal("0.1234567", { maxFractionDigits: 6 })).toBeNull();
    expect(parseDecimal("10,99", { maxFractionDigits: 2 })).toBe("10.99");
    expect(parseDecimal("10,999", { maxFractionDigits: 2 })).toBeNull();
  });
});
