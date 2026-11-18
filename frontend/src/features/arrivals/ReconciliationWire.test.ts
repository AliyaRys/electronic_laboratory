/**
 * ТЗ DR39 §3/§7 wire helper tests (fix-loop): the exact next-minute «По»
 * bound, the recovery of a foreign/stale deep link in the wire form and the
 * honest degradation of an unparsable filter (no TypeError/RangeError).
 */
import { describe, expect, it } from "vitest";
import {
  nextMinuteIso,
  normalizeReconciledLocal,
  reconciliationRangeError,
  reconciliationRangeQuery,
  reconciliationSummaryLabel,
} from "./api";

describe("reconciliation wire helpers (DR39 fix-loop)", () => {
  it("nextMinuteIso is the half-open next-minute bound of the «По» minute", () => {
    // 2026-11-05 10:00 Europe/Moscow (+03:00) → the next minute in UTC ISO.
    expect(nextMinuteIso("2026-11-05T10:00:00+03:00")).toBe("2026-11-05T07:01:00.000Z");
    expect(reconciliationRangeQuery("2026-11-05T10:00", "2026-11-05T10:00")).toEqual({
      reconciled_from: "2026-11-05T10:00:00+03:00",
      reconciled_to: "2026-11-05T07:01:00.000Z",
    });
  });

  it("normalizeReconciledLocal recovers the wire form into datetime-local", () => {
    expect(normalizeReconciledLocal("2026-11-05T10:00:00+03:00")).toBe("2026-11-05T10:00");
    expect(normalizeReconciledLocal("2026-11-05T07:00:00Z")).toBe("2026-11-05T10:00");
    expect(normalizeReconciledLocal("2026-11-05T10:00")).toBe("2026-11-05T10:00");
    expect(normalizeReconciledLocal("")).toBe("");
    expect(normalizeReconciledLocal("не дата")).toBe("");
  });

  it("a foreign deep-link range in the wire form never breaks the query", () => {
    // The old bug: «+03:00» appended twice → Invalid Date → TypeError.
    expect(reconciliationRangeQuery("2026-11-05T10:00:00+03:00", "2026-11-05T18:00:00+03:00")).toEqual({
      reconciled_from: "2026-11-05T10:00:00+03:00",
      reconciled_to: "2026-11-05T15:01:00.000Z",
    });
    // An unparsable value honestly resets the filter — nothing is sent.
    expect(reconciliationRangeQuery("мусор", "2026-11-05T10:00")).toEqual({});
  });

  it("the summary and the validation degrade honestly, never with a thrown error", () => {
    expect(
      reconciliationSummaryLabel({
        on: "",
        from: "2026-11-05T10:00:00+03:00",
        to: "2026-11-06T18:00:00+03:00",
      }),
    ).toBe("с 05.11.2026, 10:00 по 06.11.2026, 18:00");
    expect(reconciliationSummaryLabel({ on: "", from: "мусор", to: "2026-11-06T18:00" })).toBe("");
    expect(reconciliationSummaryLabel({ on: "2026-13-40", from: "", to: "" })).toBe("");
    expect(reconciliationRangeError("мусор", "2026-11-05T10:00")).toBe(
      "Укажите обе границы диапазона даты сверки данных.",
    );
    expect(reconciliationRangeError("2026-11-05T10:00:00+03:00", "2026-11-06T18:00:00+03:00")).toBeNull();
  });
});
